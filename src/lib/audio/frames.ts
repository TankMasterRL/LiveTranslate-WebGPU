/**
 * Slices an arbitrary stream of samples into fixed-size frames, buffering any
 * leftover remainder until the next push completes a frame. This decouples the
 * audio graph's render-quantum size from the frame size the VAD/chunker want.
 */
export class FrameAccumulator {
  #buffer: Float32Array;
  #fill = 0;
  readonly #frameSize: number;

  constructor(frameSize: number) {
    if (frameSize <= 0) throw new Error('frameSize must be > 0');
    this.#frameSize = frameSize;
    this.#buffer = new Float32Array(frameSize);
  }

  /** Append samples, returning every complete frame produced. */
  push(samples: Float32Array): Float32Array[] {
    const frames: Float32Array[] = [];
    let offset = 0;

    while (offset < samples.length) {
      const need = this.#frameSize - this.#fill;
      const take = Math.min(need, samples.length - offset);
      this.#buffer.set(samples.subarray(offset, offset + take), this.#fill);
      this.#fill += take;
      offset += take;

      if (this.#fill === this.#frameSize) {
        frames.push(this.#buffer.slice(0, this.#frameSize));
        this.#fill = 0;
      }
    }
    return frames;
  }

  /** Discard any buffered remainder. */
  reset(): void {
    this.#fill = 0;
  }
}
