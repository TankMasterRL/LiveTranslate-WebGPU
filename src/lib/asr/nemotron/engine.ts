import type { AsrResult } from '../transcript';
import { NEMOTRON, nemotronLangId } from './model';
import { LogMelExtractor } from './features';
import { decodeUtterance, type EmittedToken } from './tokenizer';

/**
 * Cache-aware streaming RNN-T greedy decoding for Nemotron 3.5 ASR. The
 * pipeline hands us one VAD utterance at a time (the AsrEngine seam), and we
 * run the model's native streaming interface *within* the utterance: fresh
 * caches per utterance, then 560ms encoder steps that reuse the attention and
 * conv caches from the previous step, exactly as the export was optimized
 * for. The three ONNX sessions are injected as typed step functions so this
 * whole file is unit-testable without onnxruntime.
 */

export interface EncoderCache {
  /** cache_last_channel, flattened [layers, attentionCacheFrames, dModel]. */
  channel: Float32Array;
  /** cache_last_time, flattened [layers, dModel, convCacheFrames]. */
  time: Float32Array;
  /** cache_last_channel_len (valid frames in the attention cache). */
  channelLen: number;
}

export interface EncoderStepInput {
  /** [encoderInputFrames, nMels] row-major; invalid rows zeroed. */
  mel: Float32Array;
  /** Rows actually populated (pre-encode cache + new frames). */
  validFrames: number;
  cache: EncoderCache;
  langId: number;
}

export interface EncoderStepOutput {
  /** Encoded frames, flattened [frameCount, dModel]. */
  frames: Float32Array;
  frameCount: number;
  cache: EncoderCache;
}

export interface DecoderState {
  h: Float32Array;
  c: Float32Array;
}

/** The three ONNX sessions, reduced to typed single-step calls. */
export interface NemotronSessions {
  encode(input: EncoderStepInput): Promise<EncoderStepOutput>;
  decode(
    token: number,
    state: DecoderState
  ): Promise<{ output: Float32Array; state: DecoderState }>;
  /** Joint network: one encoded frame + decoder output → vocab logits. */
  joint(encoderFrame: Float32Array, decoderOutput: Float32Array): Promise<Float32Array>;
}

function argmax(logits: Float32Array): number {
  let best = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
  return best;
}

export class NemotronEngine {
  readonly #sessions: NemotronSessions;
  readonly #vocab: string[];
  readonly #extractor: Pick<LogMelExtractor, 'frames'>;

  constructor(
    sessions: NemotronSessions,
    vocab: string[],
    extractor: Pick<LogMelExtractor, 'frames'> = new LogMelExtractor()
  ) {
    this.#sessions = sessions;
    this.#vocab = vocab;
    this.#extractor = extractor;
  }

  async transcribe(audio: Float32Array, language: string | undefined): Promise<AsrResult> {
    const {
      nMels,
      newFrames,
      preEncodeCacheFrames,
      encoderInputFrames,
      attentionCacheFrames,
      convCacheFrames,
      encoderLayers,
      dModel,
      decoderLayers,
      decoderHidden,
      blankId,
      maxSymbolsPerStep,
      encodedFrameMs
    } = NEMOTRON;

    const mel = this.#extractor.frames(audio);
    if (mel.length === 0) return { text: '', segments: [] };

    const langId = nemotronLangId(language);
    let cache: EncoderCache = {
      channel: new Float32Array(encoderLayers * attentionCacheFrames * dModel),
      time: new Float32Array(encoderLayers * dModel * convCacheFrames),
      channelLen: 0
    };
    // The RNN-T predictor starts from blank (its start-of-sequence symbol).
    let decoderState: DecoderState = {
      h: new Float32Array(decoderLayers * decoderHidden),
      c: new Float32Array(decoderLayers * decoderHidden)
    };
    let decoded = await this.#sessions.decode(blankId, decoderState);
    decoderState = decoded.state;
    let decoderOutput = decoded.output;

    const emitted: EmittedToken[] = [];
    let globalFrame = 0;

    const steps = Math.ceil(mel.length / newFrames);
    for (let step = 0; step < steps; step++) {
      const base = step * newFrames;
      // Every step re-feeds the previous 9 mel frames (the pre-encode cache;
      // zeros before the utterance starts) followed by up to 56 new ones.
      const buffer = new Float32Array(encoderInputFrames * nMels);
      for (let row = 0; row < encoderInputFrames; row++) {
        const melIndex = base - preEncodeCacheFrames + row;
        if (melIndex >= 0 && melIndex < mel.length) buffer.set(mel[melIndex], row * nMels);
      }
      const validNew = Math.min(newFrames, mel.length - base);

      const encodedStep = await this.#sessions.encode({
        mel: buffer,
        validFrames: preEncodeCacheFrames + validNew,
        cache,
        langId
      });
      cache = encodedStep.cache;

      for (let t = 0; t < encodedStep.frameCount; t++) {
        const frame = encodedStep.frames.subarray(t * dModel, (t + 1) * dModel);
        for (let symbol = 0; symbol < maxSymbolsPerStep; symbol++) {
          const logits = await this.#sessions.joint(frame, decoderOutput);
          const token = argmax(logits);
          if (token === blankId) break;
          emitted.push({ id: token, timeMs: globalFrame * encodedFrameMs });
          decoded = await this.#sessions.decode(token, decoderState);
          decoderState = decoded.state;
          decoderOutput = decoded.output;
        }
        globalFrame++;
      }
    }

    const { text, segments } = decodeUtterance(emitted, this.#vocab);
    return { text, segments };
  }
}
