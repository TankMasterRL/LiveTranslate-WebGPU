import { AsrWorkerClient } from './worker-asr-client';

export interface NemotronClientOptions {
  /**
   * Spoken-language hint: a locale ("de-DE") or bare code ("de") from the
   * model's prompt dictionary. Undefined or "auto" lets the model detect the
   * language itself.
   */
  language?: string;
}

/**
 * Main-thread handle to the Nemotron 3.5 ASR streaming Web Worker (shared
 * ASR protocol). The worker runs the cache-aware FastConformer-RNNT export
 * on onnxruntime-web directly — transformers.js has no support for this
 * architecture.
 */
export class NemotronClient extends AsrWorkerClient {
  constructor(options: NemotronClientOptions = {}) {
    super({
      createWorker: () =>
        new Worker(new URL('./nemotron-worker.ts', import.meta.url), { type: 'module' }),
      transcribeExtras: { language: options.language }
    });
  }
}
