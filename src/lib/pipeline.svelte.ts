import { AudioCapture } from './audio/capture';
import { SpeechChunker, type SpeechChunkerOptions } from './audio/chunker';
import { requestAudioStream, type CaptureKind } from './audio/source';
import { EnergyVad, rms, type EnergyVadOptions } from './audio/vad';
import { detectWebGPU, type WebGPUSupport } from './asr/webgpu';
import { cleanTranscript } from './asr/transcript';
import { makeCue, type SubtitleCue } from './subtitles/cue';
import type { SubtitleTrack } from './subtitles/track.svelte';
import type { Translator } from './translate/translator';

export type PipelineStatus = 'idle' | 'loading' | 'listening' | 'error';
export type AsrBackend = 'webgpu' | 'wasm';

/** The ASR seam the pipeline drives (implemented by the Whisper worker client). */
export interface AsrEngine {
  load(backend: AsrBackend): Promise<void>;
  transcribe(audio: Float32Array): Promise<string>;
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
  /** How long a finalized cue stays on screen. */
  displayMs?: number;
  vadOptions?: EnergyVadOptions;
  chunkerOptions?: SpeechChunkerOptions;
  // Seams — overridden in tests, defaulted for the browser.
  detect?: () => Promise<WebGPUSupport>;
  requestStream?: (kind: CaptureKind) => Promise<MediaStream>;
  createCapture?: (onFrame: (frame: Float32Array) => void) => CaptureLike;
}

/**
 * Turn one audio chunk into a cue: transcribe → clean → optionally translate.
 * Returns null when the transcript is blank. Pure (deps injected) and tested.
 */
export async function transcribeChunkToCue(
  chunk: Float32Array,
  timing: { startMs: number; endMs: number },
  deps: {
    transcribe: (audio: Float32Array) => Promise<string>;
    translate?: (text: string) => Promise<string>;
  }
): Promise<SubtitleCue | null> {
  const text = cleanTranscript(await deps.transcribe(chunk));
  if (!text) return null;
  const translation = deps.translate ? await deps.translate(text) : undefined;
  return makeCue({ text, translation, startMs: timing.startMs, endMs: timing.endMs });
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
  readonly #displayMs: number;
  #vad: EnergyVad;
  #chunker: SpeechChunker;
  #capture: CaptureLike | null = null;

  constructor(deps: PipelineDeps) {
    this.#deps = deps;
    this.#displayMs = deps.displayMs ?? 4000;
    this.#vad = new EnergyVad(deps.vadOptions);
    this.#chunker = new SpeechChunker(deps.chunkerOptions ?? { sampleRate: 16_000 });
  }

  async start(kind: CaptureKind): Promise<void> {
    if (this.status === 'listening' || this.status === 'loading') return;
    this.error = null;
    this.notice = null;
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
    const startMs = this.#deps.nowMs();
    const timing = { startMs, endMs: startMs + this.#displayMs };
    try {
      const cue = await transcribeChunkToCue(chunk, timing, {
        transcribe: (audio) => this.#deps.asr.transcribe(audio),
        translate: this.#deps.translator
          ? (text) => this.#deps.translator!.translate(text)
          : undefined
      });
      if (cue) this.#deps.track.commit(cue);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
}
