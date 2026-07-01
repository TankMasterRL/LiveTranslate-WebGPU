import type { AsrBackend, AsrEngine } from '../pipeline.svelte';

export interface WhisperClientOptions {
  /** Hugging Face model id. Defaults to a multilingual whisper-base. */
  model?: string;
  /** Language hint passed to Whisper (undefined = auto-detect). */
  language?: string;
}

type OutboundMessage =
  | { type: 'progress'; info: { progress?: number; status?: string } }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

/**
 * Main-thread handle to the Whisper Web Worker. Keeps heavy inference off the
 * UI thread; each transcribe call is matched to its result by id.
 */
export class WhisperClient implements AsrEngine {
  readonly #worker: Worker;
  readonly #model?: string;
  readonly #language?: string;
  #seq = 0;
  #pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
  #readyResolvers: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  #progress?: (fraction: number) => void;

  constructor(options: WhisperClientOptions = {}) {
    this.#model = options.model;
    this.#language = options.language;
    this.#worker = new Worker(new URL('./whisper-worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = (event: MessageEvent<OutboundMessage>) => this.#onMessage(event.data);
  }

  onProgress(callback: (fraction: number) => void): void {
    this.#progress = callback;
  }

  load(backend: AsrBackend): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#readyResolvers.push({ resolve, reject });
      this.#worker.postMessage({ type: 'load', model: this.#model, backend });
    });
  }

  transcribe(audio: Float32Array): Promise<string> {
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      // Transfer the buffer to avoid copying the PCM into the worker.
      this.#worker.postMessage({ type: 'transcribe', id, audio, language: this.#language }, [
        audio.buffer
      ]);
    });
  }

  dispose(): void {
    this.#worker.terminate();
    this.#pending.clear();
  }

  #onMessage(message: OutboundMessage): void {
    switch (message.type) {
      case 'progress':
        if (typeof message.info?.progress === 'number') this.#progress?.(message.info.progress / 100);
        break;
      case 'ready':
        this.#readyResolvers.shift()?.resolve();
        break;
      case 'result':
        this.#pending.get(message.id)?.resolve(message.text);
        this.#pending.delete(message.id);
        break;
      case 'error':
        if (message.id != null) {
          this.#pending.get(message.id)?.reject(new Error(message.message));
          this.#pending.delete(message.id);
        } else {
          // Model load failed: reject pending load() calls instead of hanging.
          this.#readyResolvers.shift()?.reject(new Error(message.message));
        }
        break;
    }
  }
}
