import { AsrWorkerClient } from './worker-asr-client';

export interface WhisperClientOptions {
  /** Hugging Face model id. Defaults to a multilingual whisper-base. */
  model?: string;
  /** Language hint passed to Whisper (undefined = auto-detect). */
  language?: string;
}

/** Main-thread handle to the Whisper Web Worker (shared ASR protocol). */
export class WhisperClient extends AsrWorkerClient {
  constructor(options: WhisperClientOptions = {}) {
    super({
      createWorker: () =>
        new Worker(new URL('./whisper-worker.ts', import.meta.url), { type: 'module' }),
      loadExtras: { model: options.model },
      transcribeExtras: { language: options.language }
    });
  }
}
