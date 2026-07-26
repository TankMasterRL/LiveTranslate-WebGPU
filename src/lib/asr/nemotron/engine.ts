import type { AsrResult } from '../transcript';
import { ChunkSizeController, type NemotronChunkSetting } from './chunk-size';
import { NEMOTRON, nemotronLangId, type NemotronChunkSize } from './model';
import { LogMelExtractor } from './features';
import { decodeUtterance, type EmittedToken } from './tokenizer';

/**
 * Cache-aware streaming RNN-T greedy decoding for Nemotron 3.5 ASR. The
 * pipeline hands us one VAD utterance at a time (the AsrEngine seam), and we
 * run the model's native streaming interface *within* the utterance: fresh
 * caches per utterance, then encoder steps that reuse the attention and conv
 * caches from the previous step, exactly as the export was optimized for. The
 * step size is one of the model's streaming operating points, fixed by
 * setting or picked from the utterance backlog (see ChunkSizeController). The
 * three ONNX sessions are injected as typed step functions so this whole file
 * is unit-testable without onnxruntime.
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
  /** [chunk.encoderInputFrames, nMels] row-major; invalid rows zeroed. */
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

/** Silent utterances tolerated before the engine reports itself as stuck. */
const SILENT_UTTERANCES_BEFORE_NOTICE = 3;

export interface NemotronEngineOptions {
  /**
   * Streaming chunk size: a fixed operating point in milliseconds, or 'auto'
   * to follow the utterance backlog. Defaults to 'auto'.
   */
  chunkSetting?: NemotronChunkSetting;
}

export class NemotronEngine {
  readonly #sessions: NemotronSessions;
  readonly #vocab: string[];
  readonly #extractor: Pick<LogMelExtractor, 'frames'>;
  readonly #chunks: ChunkSizeController;
  #silentUtterances = 0;

  constructor(
    sessions: NemotronSessions,
    vocab: string[],
    extractor: Pick<LogMelExtractor, 'frames'> = new LogMelExtractor(),
    options: NemotronEngineOptions = {}
  ) {
    this.#sessions = sessions;
    this.#vocab = vocab;
    this.#extractor = extractor;
    this.#chunks = new ChunkSizeController(options.chunkSetting);
  }

  /** The chunk size the next utterance will be decoded at. */
  get chunkMs(): number {
    return this.#chunks.current.ms;
  }

  /**
   * Decode one VAD utterance. `backlog` is how many utterances were already
   * waiting behind this one when it was handed over — the pipeline's "we are
   * not keeping up" signal, which in 'auto' picks the chunk size for this and
   * later utterances.
   */
  async transcribe(
    audio: Float32Array,
    language: string | undefined,
    backlog = 0
  ): Promise<AsrResult> {
    this.#chunks.observe(backlog);

    const mel = this.#extractor.frames(audio);
    if (mel.length === 0) return { text: '', segments: [] };

    const langId = nemotronLangId(language);
    let fallbackNotice: string | undefined;
    let emitted: EmittedToken[];
    try {
      emitted = await this.#decode(mel, langId, this.#chunks.current);
    } catch (err) {
      // Only a non-native chunk size can fail for reasons a retry fixes: the
      // export could refuse a time axis it was not traced with, or a longer
      // step's activations could exceed what the device will allocate. Both
      // fail on the very first step, so re-running the utterance at the size
      // the export ships for costs one wasted step and keeps the engine
      // usable; a native-size failure is real and propagates.
      const failedMs = this.#chunks.current.ms;
      if (!this.#chunks.pinToNative()) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      fallbackNotice =
        `Nemotron's ${failedMs} ms streaming chunk failed (${detail}) — ` +
        `falling back to ${this.#chunks.current.ms} ms for the rest of this session.`;
      emitted = await this.#decode(mel, langId, this.#chunks.current);
    }

    const { text, segments } = decodeUtterance(emitted, this.#vocab);
    // Diagnose unconditionally — it carries the silent-utterance count — but
    // let the fallback speak first when both have something to say.
    const diagnosis = this.#diagnoseEmptyDecode(text, emitted.length);
    const notice = fallbackNotice ?? diagnosis;
    return notice ? { text, segments, notice } : { text, segments };
  }

  /**
   * Run the cache-aware streaming loop over one utterance's mel frames at
   * `chunk`. Caches are local to the call, so a failed run leaves no state
   * behind and the utterance can simply be re-run at another chunk size.
   */
  async #decode(
    mel: Float32Array[],
    langId: number,
    chunk: NemotronChunkSize
  ): Promise<EmittedToken[]> {
    const {
      nMels,
      preEncodeCacheFrames,
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
    const { newFrames, encoderInputFrames } = chunk;

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
      // zeros before the utterance starts) followed by the chunk's new ones.
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
    return emitted;
  }

  /**
   * An empty decode commits no cue and raises no error, so a persistently
   * failing engine looks exactly like silence in the UI. Two signatures are
   * worth surfacing: a flood of emissions that all decode to nothing (e.g.
   * <unk> from degenerate joint logits — corrupted encoder output), and
   * ordinary blank decodes repeating across several VAD utterances.
   */
  #diagnoseEmptyDecode(text: string, emittedCount: number): string | undefined {
    if (text) {
      this.#silentUtterances = 0;
      return undefined;
    }
    this.#silentUtterances++;
    if (emittedCount >= NEMOTRON.maxSymbolsPerStep) {
      return (
        `Nemotron emitted ${emittedCount} tokens but none decoded to text — ` +
        'the model output looks corrupted. If this persists, the WebGPU ' +
        'backend may be misbehaving; try the Whisper engine.'
      );
    }
    if (this.#silentUtterances >= SILENT_UTTERANCES_BEFORE_NOTICE) {
      return (
        `Nemotron recognized no text in the last ${this.#silentUtterances} ` +
        'utterances — check the audio source and the spoken-language ' +
        'setting, or try the Whisper engine.'
      );
    }
    return undefined;
  }
}
