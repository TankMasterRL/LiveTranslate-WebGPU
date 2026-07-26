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
  /**
   * Serialize transcriptions: onnxruntime-web can't `run()` a session
   * concurrently, and the worker's async `onmessage` would otherwise let a
   * second transcribe interleave with the first — the pipeline dispatches
   * chunks fire-and-forget, so utterances overlap whenever the model runs
   * slower than real time, and overlapping runs corrupt the shared sessions
   * (garbage/empty decodes, "a few lines then nothing"). We post at most one
   * transcribe to the worker and hold the rest — buffers included, so a queued
   * chunk isn't transferred early — until its result/error returns.
   */
  #busy = false;
  #queued: Array<() => void> = [];

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
      // Transfer the buffer to avoid copying the PCM into the worker. The post
      // is deferred (buffer untransferred) while the worker is busy.
      //
      // `backlog` is how many utterances are still waiting behind this one at
      // the moment it is handed over: captured speech the engine had no slot
      // for, i.e. the pipeline running slower than real time. Advisory — the
      // Whisper worker ignores it; Nemotron sizes its streaming chunk by it.
      const post = () =>
        this.#worker.postMessage(
          {
            type: 'transcribe',
            id,
            audio,
            backlog: this.#queued.length,
            ...this.#transcribeExtras
          },
          [audio.buffer]
        );
      if (this.#busy) this.#queued.push(post);
      else {
        this.#busy = true;
        post();
      }
    });
  }

  dispose(): void {
    this.#worker.terminate();
    this.#pending.clear();
    this.#queued = [];
    this.#busy = false;
  }

  /** A transcription finished (result or error): post the next queued one. */
  #advance(): void {
    const post = this.#queued.shift();
    if (post) post();
    else this.#busy = false;
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
      case 'result': {
        const settled = this.#pending.get(message.id);
        if (settled) {
          settled.resolve({
            text: message.text,
            segments: message.segments,
            notice: message.notice
          });
          this.#pending.delete(message.id);
          this.#advance();
        }
        break;
      }
      case 'error':
        if (message.id != null) {
          const settled = this.#pending.get(message.id);
          if (settled) {
            settled.reject(new Error(message.message));
            this.#pending.delete(message.id);
            this.#advance();
          }
        } else {
          // Model load failed: reject pending load() calls instead of hanging.
          this.#readyResolvers.shift()?.reject(new Error(message.message));
        }
        break;
    }
  }
}
