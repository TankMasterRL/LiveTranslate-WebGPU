export interface SpeechChunkerOptions {
  sampleRate: number;
  /** Force-emit a chunk once it reaches this length (default 30s). */
  maxDurationMs?: number;
  /** Discard chunks shorter than this on close (default 300ms). */
  minSpeechMs?: number;
}

/**
 * Accumulates voiced frames into utterance-sized chunks for the ASR model,
 * emitting on a speech→silence transition or when the max length is hit, and
 * dropping chunks too short to be meaningful.
 */
export class SpeechChunker {
  #frames: Float32Array[] = [];
  #length = 0;
  #collecting = false;
  readonly #maxSamples: number;
  readonly #minSamples: number;

  constructor(options: SpeechChunkerOptions) {
    const { sampleRate } = options;
    this.#maxSamples = Math.round(((options.maxDurationMs ?? 30_000) / 1000) * sampleRate);
    this.#minSamples = Math.round(((options.minSpeechMs ?? 300) / 1000) * sampleRate);
  }

  /** Push a frame with its VAD verdict; returns a chunk when one is ready. */
  push(frame: Float32Array, speech: boolean): Float32Array | null {
    if (speech) {
      this.#frames.push(frame);
      this.#length += frame.length;
      this.#collecting = true;
      if (this.#length >= this.#maxSamples) return this.#emit();
      return null;
    }
    // Silence: close an open segment, ignore otherwise.
    return this.#collecting ? this.#emit() : null;
  }

  /** Emit any in-progress chunk (e.g. when capture stops). */
  flush(): Float32Array | null {
    return this.#collecting ? this.#emit() : null;
  }

  #emit(): Float32Array | null {
    const frames = this.#frames;
    const total = this.#length;
    this.#frames = [];
    this.#length = 0;
    this.#collecting = false;

    if (total < this.#minSamples) return null;

    const out = new Float32Array(total);
    let offset = 0;
    for (const frame of frames) {
      out.set(frame, offset);
      offset += frame.length;
    }
    return out;
  }
}
