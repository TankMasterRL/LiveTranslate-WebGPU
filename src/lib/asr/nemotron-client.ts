import type { NemotronChunkSetting } from './nemotron/chunk-size';
import { AsrWorkerClient, type AsrWorkerLike } from './worker-asr-client';

export interface NemotronClientOptions {
  /**
   * Spoken-language hint: a locale ("de-DE") or bare code ("de") from the
   * model's prompt dictionary. Undefined or "auto" lets the model detect the
   * language itself.
   */
  language?: string;
  /**
   * Streaming chunk size: one of the model's operating points in ms, or
   * 'auto' (the default) to follow the utterance backlog at runtime.
   */
  chunkMs?: NemotronChunkSetting;
}

/**
 * Both options travel with every `transcribe` message rather than the `load`:
 * changing them must never cost a reload of the ~790MB model.
 */
const transcribeExtras = ({ language, chunkMs }: NemotronClientOptions) => ({ language, chunkMs });

/**
 * Main-thread handle to the Nemotron 3.5 ASR streaming Web Worker (shared
 * ASR protocol). The worker runs the cache-aware FastConformer-RNNT export
 * on onnxruntime-web directly — transformers.js has no support for this
 * architecture.
 */
export class NemotronClient extends AsrWorkerClient {
  constructor(
    options: NemotronClientOptions = {},
    createWorker: () => AsrWorkerLike = () =>
      new Worker(new URL('./nemotron-worker.ts', import.meta.url), { type: 'module' })
  ) {
    super({ createWorker, transcribeExtras: transcribeExtras(options) });
  }

  /** Change the language hint and chunk size from the next transcription on. */
  configure(options: NemotronClientOptions): void {
    this.setTranscribeExtras(transcribeExtras(options));
  }
}
