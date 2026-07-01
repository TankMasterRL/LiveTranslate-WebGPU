/** Root-mean-square amplitude of a frame (0 for an empty frame). */
export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export interface EnergyVadOptions {
  /** RMS amplitude above which a frame counts as speech. */
  threshold?: number;
  /** Frames of silence tolerated before speech is considered ended. */
  hangoverFrames?: number;
}

/**
 * Simple energy-based voice activity detector with a hangover tail, mirroring
 * the adaptive-silence idea in LiveTranslate's VAD. A Silero-ONNX VAD (e.g.
 * `@ricky0123/vad-web`) is a drop-in upgrade behind the same `process` shape.
 */
export class EnergyVad {
  readonly #threshold: number;
  readonly #hangoverFrames: number;
  #countdown = 0;
  #active = false;

  constructor(options: EnergyVadOptions = {}) {
    this.#threshold = options.threshold ?? 0.01;
    this.#hangoverFrames = options.hangoverFrames ?? 8;
  }

  /** Feed one frame; returns whether speech is currently active. */
  process(frame: Float32Array): boolean {
    if (rms(frame) >= this.#threshold) {
      this.#active = true;
      this.#countdown = this.#hangoverFrames;
    } else {
      this.#active = this.#countdown > 0;
      if (this.#countdown > 0) this.#countdown--;
    }
    return this.#active;
  }

  get active(): boolean {
    return this.#active;
  }

  reset(): void {
    this.#countdown = 0;
    this.#active = false;
  }
}
