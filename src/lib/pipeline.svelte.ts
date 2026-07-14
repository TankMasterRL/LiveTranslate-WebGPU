import { AudioCapture } from './audio/capture';
import { SpeechChunker, type SpeechChunkerOptions } from './audio/chunker';
import { requestAudioStream, type CaptureKind } from './audio/source';
import { EnergyVad, rms, type EnergyVadOptions, type Vad } from './audio/vad';
import { detectWebGPU, type WebGPUSupport } from './asr/webgpu';
import { segmentsToCues } from './asr/align';
import type { AsrResult } from './asr/transcript';
import { displayText } from './subtitles/cue';
import { cueDisplayMs } from './subtitles/duration';
import type { SubtitleTrack } from './subtitles/track.svelte';
import type { Translator } from './translate/translator';

export type PipelineStatus = 'idle' | 'loading' | 'listening' | 'error';
export type AsrBackend = 'webgpu' | 'wasm';

/** The ASR seam the pipeline drives (implemented by the Whisper worker client). */
export interface AsrEngine {
  load(backend: AsrBackend): Promise<void>;
  transcribe(audio: Float32Array): Promise<AsrResult>;
  onProgress?(callback: (fraction: number) => void): void;
  dispose?(): void;
}

interface CaptureLike {
  start(stream: MediaStream): Promise<void>;
  stop(): Promise<void>;
}

export interface PipelineDeps {
  track: SubtitleTrack;
  asr: AsrEngine;
  translator?: Translator;
  /** Playback clock used to timestamp cues (e.g. () => player.currentMs). */
  nowMs: () => number;
  /**
   * Fixed on-screen duration override for cues. When omitted, the duration
   * adapts to the displayed text's length (reading speed).
   */
  displayMs?: number;
  /** VAD engine to use; defaults to an EnergyVad built from vadOptions. */
  vad?: Vad;
  vadOptions?: EnergyVadOptions;
  chunkerOptions?: SpeechChunkerOptions;
  // Seams — overridden in tests, defaulted for the browser.
  detect?: () => Promise<WebGPUSupport>;
  requestStream?: (kind: CaptureKind) => Promise<MediaStream>;
  createCapture?: (onFrame: (frame: Float32Array) => void) => CaptureLike;
}

/**
 * Reactive orchestrator wiring capture → VAD → chunker → Whisper → translator →
 * subtitle track. This is the browser port of LiveTranslate's pipeline loop.
 */
export class TranscriptionPipeline {
  status = $state<PipelineStatus>('idle');
  backend = $state<AsrBackend | null>(null);
  level = $state(0);
  progress = $state(0);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);

  readonly #deps: PipelineDeps;
  readonly #fixedDisplayMs: number | undefined;
  #vad: Vad;
  #chunker: SpeechChunker;
  #capture: CaptureLike | null = null;
  #translator: Translator | null;
  /** The notice the ASR engine set, so recovery clears only that notice. */
  #asrNotice: string | null = null;

  readonly #sampleRate: number;

  constructor(deps: PipelineDeps) {
    this.#deps = deps;
    this.#fixedDisplayMs = deps.displayMs;
    this.#vad = deps.vad ?? new EnergyVad(deps.vadOptions);
    this.#chunker = new SpeechChunker(deps.chunkerOptions ?? { sampleRate: 16_000 });
    this.#translator = deps.translator ?? null;
    this.#sampleRate = deps.chunkerOptions?.sampleRate ?? 16_000;
  }

  /** Swap the translator at runtime without touching capture or the ASR. */
  setTranslator(translator: Translator | null): void {
    this.#translator = translator;
  }

  /** Swap the VAD engine at runtime (e.g. energy ↔ Silero). */
  setVad(vad: Vad): void {
    this.#vad = vad;
    this.#vad.reset();
  }

  async start(kind: CaptureKind): Promise<void> {
    if (this.status === 'listening' || this.status === 'loading') return;
    this.error = null;
    this.notice = null;
    this.#asrNotice = null;
    this.status = 'loading';
    this.#vad.reset();
    this.#chunker = new SpeechChunker(this.#deps.chunkerOptions ?? { sampleRate: 16_000 });

    try {
      const support = await (this.#deps.detect ?? detectWebGPU)();
      this.backend = support.supported ? 'webgpu' : 'wasm';
      if (!support.supported) this.notice = support.reason ?? 'Falling back to WASM.';

      this.#deps.asr.onProgress?.((fraction) => (this.progress = fraction));
      await this.#deps.asr.load(this.backend);

      const stream = await (this.#deps.requestStream ?? requestAudioStream)(kind);
      const create = this.#deps.createCapture ?? ((onFrame) => new AudioCapture({ onFrame }));
      this.#capture = create((frame) => this.#onFrame(frame));
      await this.#capture.start(stream);

      this.status = 'listening';
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async stop(): Promise<void> {
    const tail = this.#chunker.flush();
    await this.#capture?.stop();
    this.#capture = null;
    this.#vad.reset();
    this.level = 0;
    this.status = 'idle';
    if (tail) void this.#handleChunk(tail);
  }

  #onFrame(frame: Float32Array): void {
    this.level = rms(frame);
    const active = this.#vad.process(frame);
    const chunk = this.#chunker.push(frame, active);
    if (chunk) void this.#handleChunk(chunk);
  }

  async #handleChunk(chunk: Float32Array): Promise<void> {
    // The chunk was captured over the preceding durationMs, so the utterance
    // began that far before "now" on the media timeline.
    const emissionMs = this.#deps.nowMs();
    const durationMs = Math.round((chunk.length / this.#sampleRate) * 1000);

    let result: AsrResult;
    try {
      result = await this.#deps.asr.transcribe(chunk);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }

    // Diagnostics from the engine (e.g. repeated empty decodes) show as a
    // notice — an empty result commits no cue and raises no error, so this
    // is the only way a failing engine becomes visible.
    if (result.notice) {
      this.notice = result.notice;
      this.#asrNotice = result.notice;
    }

    const cues = segmentsToCues(result, {
      utteranceStartMs: emissionMs - durationMs,
      utteranceDurationMs: durationMs
    });
    if (cues.length === 0) return;

    // Recognition recovered: retract a stale engine diagnostic (but never a
    // notice someone else owns, like the WASM-fallback message).
    if (this.#asrNotice !== null && this.notice === this.#asrNotice) {
      this.notice = null;
      this.#asrNotice = null;
    }

    // Translation is best-effort: a failure surfaces as an error but never
    // loses the transcription.
    if (this.#translator) {
      for (const cue of cues) {
        try {
          cue.translation = await this.#translator.translate(cue.text);
        } catch (err) {
          this.error = err instanceof Error ? err.message : String(err);
        }
      }
    }

    // Earlier segments keep their true (past) spans for the transcript; the
    // last one also stays on screen long enough to read — sized by what is
    // actually shown (the translation when present).
    const last = cues[cues.length - 1];
    last.endMs =
      this.#fixedDisplayMs !== undefined
        ? emissionMs + this.#fixedDisplayMs
        : Math.max(last.endMs, emissionMs + cueDisplayMs(displayText(last)));

    for (const cue of cues) this.#deps.track.commit(cue);
  }
}
