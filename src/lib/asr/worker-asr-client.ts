import type { AsrBackend, AsrEngine } from '../pipeline.svelte';
import type { AsrResult, AsrSegment } from './transcript';

/**
 * The ASR worker postMessage protocol, shared by the Whisper and Nemotron
 * workers (and mirrored by the translation worker pair): `load` / work
 * message with `id` / `progress` / `ready` / `result` / `error`. Load
 * failures are an `error` with no `id` and must reject the pending `load()`
 * promise — a silent hang here was a real bug once already.
 */
export type AsrWorkerOutbound =
  | { type: 'progress'; info: { progress?: number; status?: string } }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string; segments?: AsrSegment[]; notice?: string }
  | { type: 'error'; id?: number; message: string };

/** The slice of Worker the client uses (injectable for tests). */
export interface AsrWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<AsrWorkerOutbound>) => void) | null;
  terminate(): void;
}

export interface AsrWorkerClientOptions {
  /**
   * Builds the worker. Callers must keep the `new Worker(new URL(...))`
   * expression syntactically intact inside this closure so Vite can bundle
   * the worker entry.
   */
  createWorker: () => AsrWorkerLike;
  /** Extra fields merged into the `load` message (e.g. Whisper's model id). */
  loadExtras?: Record<string, unknown>;
  /** Extra fields merged into every `transcribe` message (e.g. language). */
  transcribeExtras?: Record<string, unknown>;
}

/**
 * Main-thread handle to an ASR Web Worker. Keeps heavy inference off the UI
 * thread; each transcribe call is matched to its result by id.
 */
export class AsrWorkerClient implements AsrEngine {
  readonly #worker: AsrWorkerLike;
  readonly #loadExtras: Record<string, unknown>;
  readonly #transcribeExtras: Record<string, unknown>;
  #seq = 0;
  #pending = new Map<
    number,
    { resolve: (result: AsrResult) => void; reject: (e: Error) => void }
  >();
  #readyResolvers: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  #progress?: (fraction: number) => void;

  constructor(options: AsrWorkerClientOptions) {
    this.#loadExtras = options.loadExtras ?? {};
    this.#transcribeExtras = options.transcribeExtras ?? {};
    this.#worker = options.createWorker();
    this.#worker.onmessage = (event: MessageEvent<AsrWorkerOutbound>) =>
      this.#onMessage(event.data);
  }

  onProgress(callback: (fraction: number) => void): void {
    this.#progress = callback;
  }

  load(backend: AsrBackend): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#readyResolvers.push({ resolve, reject });
      this.#worker.postMessage({ type: 'load', backend, ...this.#loadExtras });
    });
  }

  transcribe(audio: Float32Array): Promise<AsrResult> {
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      // Transfer the buffer to avoid copying the PCM into the worker.
      this.#worker.postMessage({ type: 'transcribe', id, audio, ...this.#transcribeExtras }, [
        audio.buffer
      ]);
    });
  }

  dispose(): void {
    this.#worker.terminate();
    this.#pending.clear();
  }

  #onMessage(message: AsrWorkerOutbound): void {
    switch (message.type) {
      case 'progress':
        if (typeof message.info?.progress === 'number')
          this.#progress?.(message.info.progress / 100);
        break;
      case 'ready':
        this.#readyResolvers.shift()?.resolve();
        break;
      case 'result':
        this.#pending
          .get(message.id)
          ?.resolve({ text: message.text, segments: message.segments, notice: message.notice });
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
