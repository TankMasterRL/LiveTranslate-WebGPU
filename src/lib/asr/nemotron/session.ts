import * as ort from 'onnxruntime-web';
import type { AsrBackend } from '../../pipeline.svelte';
import { NEMOTRON } from './model';
import type {
  DecoderState,
  EncoderCache,
  EncoderStepInput,
  EncoderStepOutput,
  NemotronSessions
} from './engine';

/**
 * onnxruntime-web plumbing for the three Nemotron graphs, reduced to the
 * typed step calls the engine consumes. Tensor names and shapes follow the
 * export's genai_config.json:
 *   encoder: audio_signal [1,65,128] f32, length [1] i64,
 *            cache_last_channel [1,24,56,1024] f32,
 *            cache_last_time [1,24,1024,8] f32,
 *            cache_last_channel_len [1] i64, lang_id [1] i64
 *         →  outputs [1,T,1024], encoded_lengths [1],
 *            cache_last_channel_next / cache_last_time_next /
 *            cache_last_channel_len_next
 *   decoder: targets [1,1] i64, h_in/c_in [2,1,640] f32
 *         →  decoder_output [.,640], h_out, c_out
 *   joint:   encoder_output [1,1,1024] f32, decoder_output [1,1,640] f32
 *         →  joint_output logits (13088)
 */

export interface NemotronModelBytes {
  encoder: { model: Uint8Array; data: Uint8Array };
  decoder: { model: Uint8Array; data: Uint8Array };
  joint: { model: Uint8Array; data: Uint8Array };
}

const f32 = (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims);
const i64 = (value: number) => new ort.Tensor('int64', BigInt64Array.from([BigInt(value)]), [1]);

export async function createNemotronSessions(
  bytes: NemotronModelBytes,
  backend: AsrBackend
): Promise<NemotronSessions> {
  // Single-threaded WASM: cross-origin isolation would break the YouTube
  // embed, so there is no SharedArrayBuffer (same constraint as Silero).
  ort.env.wasm.numThreads = 1;

  const create = (
    source: { model: Uint8Array; data: Uint8Array },
    dataPath: string,
    providers: AsrBackend[]
  ) =>
    ort.InferenceSession.create(source.model, {
      executionProviders: providers,
      // Weights live in an external-data file; the path must match the
      // reference embedded in the graph (the export's own filename).
      externalData: [{ path: dataPath, data: source.data }]
    });

  // The encoder (the heavy ~690MB graph) follows the pipeline's chosen
  // backend. The decoder and joint stay on WASM deliberately: the greedy
  // RNN-T loop runs them once per emitted token, and per-call GPU
  // dispatch/readback latency would dwarf their tiny compute.
  const [encoder, decoder, joint] = await Promise.all([
    create(bytes.encoder, 'encoder.onnx.data', [backend]),
    create(bytes.decoder, 'decoder.onnx.data', ['wasm']),
    create(bytes.joint, 'joint.onnx.data', ['wasm'])
  ]);

  const {
    encoderInputFrames,
    nMels,
    encoderLayers,
    attentionCacheFrames,
    convCacheFrames,
    dModel,
    decoderLayers,
    decoderHidden
  } = NEMOTRON;

  return {
    async encode(input: EncoderStepInput): Promise<EncoderStepOutput> {
      const result = await encoder.run({
        audio_signal: f32(input.mel, [1, encoderInputFrames, nMels]),
        length: i64(input.validFrames),
        cache_last_channel: f32(input.cache.channel, [
          1,
          encoderLayers,
          attentionCacheFrames,
          dModel
        ]),
        cache_last_time: f32(input.cache.time, [1, encoderLayers, dModel, convCacheFrames]),
        cache_last_channel_len: i64(input.cache.channelLen),
        lang_id: i64(input.langId)
      });
      const frames = result.outputs.data as Float32Array;
      const encodedLength = Number((result.encoded_lengths.data as BigInt64Array)[0]);
      const cache: EncoderCache = {
        channel: result.cache_last_channel_next.data as Float32Array,
        time: result.cache_last_time_next.data as Float32Array,
        channelLen: Number((result.cache_last_channel_len_next.data as BigInt64Array)[0])
      };
      return {
        frames,
        // The graph may pad the time axis; encoded_lengths marks the frames
        // that are real (mirrors onnxruntime-genai's min(shape, length)).
        frameCount: Math.min(result.outputs.dims[1], encodedLength),
        cache
      };
    },

    async decode(token: number, state: DecoderState) {
      const result = await decoder.run({
        targets: new ort.Tensor('int64', BigInt64Array.from([BigInt(token)]), [1, 1]),
        h_in: f32(state.h, [decoderLayers, 1, decoderHidden]),
        c_in: f32(state.c, [decoderLayers, 1, decoderHidden])
      });
      return {
        output: result.decoder_output.data as Float32Array,
        state: {
          h: result.h_out.data as Float32Array,
          c: result.c_out.data as Float32Array
        }
      };
    },

    async joint(encoderFrame: Float32Array, decoderOutput: Float32Array) {
      const result = await joint.run({
        encoder_output: f32(encoderFrame, [1, 1, dModel]),
        decoder_output: f32(decoderOutput, [1, 1, decoderHidden])
      });
      return result.joint_output.data as Float32Array;
    }
  };
}
