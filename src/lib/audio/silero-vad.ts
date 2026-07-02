import type { Vad } from './vad';

/** State tensor data; ORT may back it with a SharedArrayBuffer. */
export type SileroState = Float32Array<ArrayBufferLike>;

/** One inference step of the Silero VAD model (see silero-session.ts). */
export interface SileroSession {
  run(frame: Float32Array, state: SileroState): Promise<{ probability: number; state: SileroState }>;
}

export interface SileroVadOptions {
  /** Speech probability above which a frame counts as speech. */
  threshold?: number;
  /** Frames of silence tolerated before speech is considered ended. */
  hangoverFrames?: number;
}

const STATE_SIZE = 2 * 1 * 128; // Silero v5 LSTM state [2, 1, 128]

/**
 * Neural VAD backed by the Silero v5 ONNX model. Model inference is async, so
 * `process` returns the decision as of the previous frame (one 32ms frame of
 * lag — irrelevant next to the hangover window) while queueing this frame's
 * inference; runs are serialized so the LSTM state threads correctly.
 * Inference failures deactivate rather than throw, and the queue keeps going.
 */
export class SileroVad implements Vad {
  readonly #session: SileroSession;
  readonly #threshold: number;
  readonly #hangoverFrames: number;
  #state: SileroState = new Float32Array(STATE_SIZE);
  #queue: Promise<void> = Promise.resolve();
  #active = false;
  #countdown = 0;

  constructor(session: SileroSession, options: SileroVadOptions = {}) {
    this.#session = session;
    this.#threshold = options.threshold ?? 0.5;
    this.#hangoverFrames = options.hangoverFrames ?? 8;
  }

  process(frame: Float32Array): boolean {
    const copy = frame.slice(); // the caller may reuse/transfer the buffer
    this.#queue = this.#queue.then(async () => {
      try {
        const { probability, state } = await this.#session.run(copy, this.#state);
        this.#state = state;
        if (probability >= this.#threshold) {
          this.#active = true;
          this.#countdown = this.#hangoverFrames;
        } else {
          this.#active = this.#countdown > 0;
          if (this.#countdown > 0) this.#countdown--;
        }
      } catch {
        this.#active = false;
      }
    });
    return this.#active;
  }

  reset(): void {
    this.#state = new Float32Array(STATE_SIZE);
    this.#active = false;
    this.#countdown = 0;
  }
}
