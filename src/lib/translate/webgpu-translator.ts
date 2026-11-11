import { detectWebGPU, type WebGPUSupport } from '../asr/webgpu';
import { chooseTranslationRuntime } from './inference';
import type { LocalModelChoice } from './lang';
import type { TranslateOptions, Translator } from './translator';

export type TranslateWorkerOutbound =
  | { type: 'progress'; info: { progress?: number; status?: string } }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

/** The slice of Worker the client uses (injectable for tests). */
export interface TranslateWorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<TranslateWorkerOutbound>) => void) | null;
  terminate(): void;
}

export interface WebGpuTranslatorOptions {
  /**
   * Builds the worker. The default keeps the `new Worker(new URL(...))`
   * expression syntactically intact so Vite can bundle the worker entry.
   */
  createWorker?: () => TranslateWorkerLike;
  /** WebGPU capability probe, deciding the backend and weight precision. */
  detect?: () => Promise<WebGPUSupport>;
}

/**
 * Translator running a transformers.js translation model in a Web Worker on
 * WebGPU (WASM fallback). Mirrors WhisperClient: id-matched requests, model
 * load on demand (or ahead of time via load()), download progress callback.
 */
export class WebGpuTranslator implements Translator {
  readonly #worker: TranslateWorkerLike;
  readonly #choice: Extract<LocalModelChoice, { ok: true }>;
  readonly #detect: () => Promise<WebGPUSupport>;
  #seq = 0;
  #pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
  #loaded: Promise<void> | null = null;
  #readyResolve: (() => void) | null = null;
  #readyReject: ((e: Error) => void) | null = null;
  #progress?: (fraction: number) => void;

  constructor(
    choice: Extract<LocalModelChoice, { ok: true }>,
    options: WebGpuTranslatorOptions = {}
  ) {
    this.#choice = choice;
    this.#detect = options.detect ?? (() => detectWebGPU());
    this.#worker = (
      options.createWorker ??
      (() => new Worker(new URL('./translate-worker.ts', import.meta.url), { type: 'module' }))
    )();
    this.#worker.onmessage = (event: MessageEvent<TranslateWorkerOutbound>) =>
      this.#onMessage(event.data);
  }

  onProgress(callback: (fraction: number) => void): void {
    this.#progress = callback;
  }

  /**
   * Download and initialize the model. Idempotent; translate() calls it
   * implicitly, but calling it up front keeps the first utterances from
   * waiting out the whole download.
   */
  load(): Promise<void> {
    this.#loaded ??= (async () => {
      const { backend, dtype } = chooseTranslationRuntime(await this.#detect());
      await new Promise<void>((resolve, reject) => {
        this.#readyResolve = resolve;
        this.#readyReject = reject;
        this.#worker.postMessage({ type: 'load', model: this.#choice.model, backend, dtype });
      });
    })();
    return this.#loaded;
  }

  async translate(text: string, _options: TranslateOptions = {}): Promise<string> {
    await this.load();
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({
        type: 'translate',
        id,
        text,
        srcCode: this.#choice.srcCode,
        tgtCode: this.#choice.tgtCode
      });
    });
  }

  dispose(): void {
    this.#worker.terminate();
    const cancelled = new Error('Translator disposed');
    for (const { reject } of this.#pending.values()) reject(cancelled);
    this.#pending.clear();
  }

  #onMessage(message: TranslateWorkerOutbound): void {
    switch (message.type) {
      case 'progress':
        if (typeof message.info?.progress === 'number') {
          this.#progress?.(message.info.progress / 100);
        }
        break;
      case 'ready':
        this.#readyResolve?.();
        this.#readyResolve = null;
        this.#readyReject = null;
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
          // Model load failed: fail the pending load so translate() rejects
          // instead of hanging.
          this.#readyReject?.(new Error(message.message));
          this.#readyResolve = null;
          this.#readyReject = null;
        }
        break;
    }
  }
}
