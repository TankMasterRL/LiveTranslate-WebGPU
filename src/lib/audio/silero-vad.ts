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
// Samples of trailing audio carried into the next window. Silero v5 expects
// every 512-sample chunk to be prefixed with the previous chunk's last 64
// samples (upstream keeps this "context" outside the ONNX graph, in its
// wrapper); feeding bare 512-sample windows degrades the probabilities until
// real speech no longer crosses the threshold.
const CONTEXT_SIZE = 64;

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
  #context = new Float32Array(CONTEXT_SIZE);
  #queue: Promise<void> = Promise.resolve();
  #active = false;
  #countdown = 0;

  constructor(session: SileroSession, options: SileroVadOptions = {}) {
    this.#session = session;
    this.#threshold = options.threshold ?? 0.5;
    this.#hangoverFrames = options.hangoverFrames ?? 8;
  }

  process(frame: Float32Array): boolean {
    // [context | frame] — copied, as the caller may reuse/transfer the buffer.
    const window = new Float32Array(CONTEXT_SIZE + frame.length);
    window.set(this.#context);
    window.set(frame, CONTEXT_SIZE);
    this.#context = window.slice(window.length - CONTEXT_SIZE);
    this.#queue = this.#queue.then(async () => {
      try {
        const { probability, state } = await this.#session.run(window, this.#state);
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
    this.#context = new Float32Array(CONTEXT_SIZE);
    this.#active = false;
    this.#countdown = 0;
  }
}
