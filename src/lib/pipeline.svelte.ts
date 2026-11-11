import { AudioCapture } from './audio/capture';
import { SpeechChunker, type SpeechChunkerOptions } from './audio/chunker';
import { requestAudioStream, type CaptureKind } from './audio/source';
import { EnergyVad, rms, type EnergyVadOptions, type Vad } from './audio/vad';
import { detectWebGPU, type WebGPUSupport } from './asr/webgpu';
import { segmentsToCues, utteranceToCue } from './asr/align';
import type { AsrResult } from './asr/transcript';
import { displayText } from './subtitles/cue';
import { cueDisplayMs } from './subtitles/duration';
import type { SubtitleTrack } from './subtitles/track.svelte';
import { SerialQueue } from './translate/serial-queue';
import type { Translator } from './translate/translator';

export type PipelineStatus = 'idle' | 'loading' | 'listening' | 'error';

/** Default for {@link PipelineDeps.maxTranslationWaitMs}. */
export const DEFAULT_MAX_TRANSLATION_WAIT_MS = 3000;

const TRANSLATION_BEHIND_NOTICE =
  'Translation is falling behind the speech — some lines are shown untranslated.';
export type AsrBackend = 'webgpu' | 'wasm';

/** The ASR seam the pipeline drives (implemented by the Whisper worker client). */
export interface AsrEngine {
  load(backend: AsrBackend): Promise<void>;
  transcribe(audio: Float32Array): Promise<AsrResult>;
  onProgress?(callback: (fraction: number) => void): void;
  dispose?(): void;
  /**
   * True once the engine can never work again (its worker crashed or was
   * disposed). Engines are pooled across pipelines (see AsrEnginePool), and a
   * defunct one is rebuilt rather than handed out again.
   */
  readonly defunct?: boolean;
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
  /**
   * How long (media-timeline ms) a transcribed line may wait for the
   * translator before it is committed untranslated instead. Bounds how far
   * subtitles lag the speech when translation runs slower than real time.
   */
  maxTranslationWaitMs?: number;
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
  /** One translation at a time; lines that wait too long are skipped. */
  readonly #translations = new SerialQueue();
  readonly #maxTranslationWaitMs: number;
  /** The notice the ASR engine set, so recovery clears only that notice. */
  #asrNotice: string | null = null;
  /** Likewise for the translation-is-behind notice. */
  #translationNotice: string | null = null;

  readonly #sampleRate: number;

  constructor(deps: PipelineDeps) {
    this.#deps = deps;
    this.#fixedDisplayMs = deps.displayMs;
    this.#vad = deps.vad ?? new EnergyVad(deps.vadOptions);
    this.#chunker = new SpeechChunker(deps.chunkerOptions ?? { sampleRate: 16_000 });
    this.#translator = deps.translator ?? null;
    this.#maxTranslationWaitMs = deps.maxTranslationWaitMs ?? DEFAULT_MAX_TRANSLATION_WAIT_MS;
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
    this.#translationNotice = null;
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

    // With a translator the utterance becomes one cue, translated as a
    // whole: models translate sentences, not Whisper's timestamp fragments.
    const align = { utteranceStartMs: emissionMs - durationMs, utteranceDurationMs: durationMs };
    const translating = this.#translator !== null;
    const whole = translating ? utteranceToCue(result, align) : null;
    const cues = translating ? (whole ? [whole] : []) : segmentsToCues(result, align);
    if (cues.length === 0) return;

    // Recognition recovered: retract a stale engine diagnostic (but never a
    // notice someone else owns, like the WASM-fallback message).
    if (this.#asrNotice !== null && this.notice === this.#asrNotice) {
      this.notice = null;
      this.#asrNotice = null;
    }

    if (whole) whole.translation = await this.#translate(whole.text);

    // Earlier segments keep their true (past) spans for the transcript; the
    // last one also stays on screen long enough to read — sized by what is
    // actually shown (the translation when present), and measured from now,
    // when it is committed: ASR and translation latency must not eat into
    // the reading time, or a slow enough line is committed already expired
    // and never appears on the overlay at all.
    const committedMs = this.#deps.nowMs();
    const last = cues[cues.length - 1];
    last.endMs =
      this.#fixedDisplayMs !== undefined
        ? committedMs + this.#fixedDisplayMs
        : Math.max(last.endMs, committedMs + cueDisplayMs(displayText(last)));

    for (const cue of cues) this.#deps.track.commit(cue);
  }

  /**
   * Translate one line through the one-at-a-time queue. Best-effort: a
   * failure surfaces as an error, a line that waited longer than
   * maxTranslationWaitMs is skipped with a notice, and translation turned off
   * meanwhile just yields nothing — the transcription is never lost.
   */
  async #translate(text: string): Promise<string | undefined> {
    // Work arriving at an idle queue means the translator is keeping up.
    const keepingUp = this.#translations.idle;
    const queuedMs = this.#deps.nowMs();
    try {
      const outcome = await this.#translations.run(
        async () => this.#translator?.translate(text),
        () => this.#deps.nowMs() - queuedMs > this.#maxTranslationWaitMs
      );
      if (outcome.skipped) {
        this.notice = this.#translationNotice = TRANSLATION_BEHIND_NOTICE;
        return undefined;
      }
      if (keepingUp && this.#translationNotice !== null) {
        if (this.notice === this.#translationNotice) this.notice = null;
        this.#translationNotice = null;
      }
      return outcome.value;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return undefined;
    }
  }
}
