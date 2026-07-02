import { FrameAccumulator } from './frames';
import { resampleLinear } from './resample';
import workletUrl from './pcm-worklet.js?url';

export interface AudioCaptureOptions {
  /** Sample rate the ASR model expects (Whisper = 16000). */
  targetSampleRate?: number;
  /** Frame size in samples at the target rate (512 @16k ≈ 32ms). */
  frameSize?: number;
  /** Called for every fixed-size 16k mono frame. */
  onFrame: (frame: Float32Array) => void;
}

/**
 * Pulls PCM from a MediaStream through an AudioWorklet, downmixes to mono,
 * resamples to 16 kHz, and emits fixed-size frames — the browser analog of
 * LiveTranslate's 32ms WASAPI chunking. Requires a real AudioContext, so it is
 * exercised via manual/e2e verification rather than unit tests.
 */
export class AudioCapture {
  #ctx: AudioContext | null = null;
  #node: AudioWorkletNode | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #sink: GainNode | null = null;
  readonly #accumulator: FrameAccumulator;
  readonly #targetRate: number;
  readonly #onFrame: (frame: Float32Array) => void;

  constructor(options: AudioCaptureOptions) {
    this.#targetRate = options.targetSampleRate ?? 16_000;
    this.#accumulator = new FrameAccumulator(options.frameSize ?? 512);
    this.#onFrame = options.onFrame;
  }

  async start(stream: MediaStream): Promise<void> {
    const ctx = new AudioContext();
    this.#ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    if (ctx.state === 'suspended') await ctx.resume();

    const inputRate = ctx.sampleRate;
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-worklet');

    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const resampled = resampleLinear(event.data, inputRate, this.#targetRate);
      for (const frame of this.#accumulator.push(resampled)) this.#onFrame(frame);
    };

    // A muted sink keeps the graph pulling without any audible output.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);

    this.#source = source;
    this.#node = node;
    this.#sink = sink;
  }

  async stop(): Promise<void> {
    this.#source?.disconnect();
    this.#node?.disconnect();
    this.#sink?.disconnect();
    if (this.#node) this.#node.port.onmessage = null;
    this.#accumulator.reset();
    await this.#ctx?.close();
    this.#ctx = null;
    this.#node = null;
    this.#source = null;
    this.#sink = null;
  }
}
