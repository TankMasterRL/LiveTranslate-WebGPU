import { detectWebGPU } from '../asr/webgpu';
import type { LocalModelChoice } from './lang';
import type { TranslateOptions, Translator } from './translator';

type OutboundMessage =
  | { type: 'progress'; info: { progress?: number; status?: string } }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

/**
 * Translator running a transformers.js translation model in a Web Worker on
 * WebGPU (WASM fallback). Mirrors WhisperClient: id-matched requests, lazy
 * model load on first translate, download progress callback.
 */
export class WebGpuTranslator implements Translator {
  readonly #worker: Worker;
  readonly #choice: Extract<LocalModelChoice, { ok: true }>;
  #seq = 0;
  #pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
  #loaded: Promise<void> | null = null;
  #readyResolve: (() => void) | null = null;
  #readyReject: ((e: Error) => void) | null = null;
  #progress?: (fraction: number) => void;

  constructor(choice: Extract<LocalModelChoice, { ok: true }>) {
    this.#choice = choice;
    this.#worker = new Worker(new URL('./translate-worker.ts', import.meta.url), {
      type: 'module'
    });
    this.#worker.onmessage = (event: MessageEvent<OutboundMessage>) => this.#onMessage(event.data);
  }

  onProgress(callback: (fraction: number) => void): void {
    this.#progress = callback;
  }

  async translate(text: string, _options: TranslateOptions = {}): Promise<string> {
    await this.#ensureLoaded();
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

  #ensureLoaded(): Promise<void> {
    this.#loaded ??= (async () => {
      const support = await detectWebGPU();
      await new Promise<void>((resolve, reject) => {
        this.#readyResolve = resolve;
        this.#readyReject = reject;
        this.#worker.postMessage({
          type: 'load',
          model: this.#choice.model,
          backend: support.supported ? 'webgpu' : 'wasm'
        });
      });
    })();
    return this.#loaded;
  }

  #onMessage(message: OutboundMessage): void {
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
