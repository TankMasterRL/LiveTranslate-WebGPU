import * as ort from 'onnxruntime-web';
import type { SileroSession } from './silero-vad';

/** Vendored Silero VAD v5 model (MIT, from snakers4/silero-vad), ~2.3MB. */
export const SILERO_MODEL_URL = '/models/silero_vad_v5.onnx';

/**
 * Create a Silero v5 inference session with onnxruntime-web (WASM backend —
 * the model is tiny, so no WebGPU needed). Contract verified against the real
 * model in silero-session.integration.test.ts:
 * inputs `input` [1,512] f32, `state` [2,1,128] f32, `sr` int64;
 * outputs `output` [1,1] speech probability, `stateN` [2,1,128].
 */
export async function createSileroSession(
  source: string | Uint8Array = SILERO_MODEL_URL
): Promise<SileroSession> {
  // Single-threaded: we run one 512-sample frame at a time, and this avoids
  // needing cross-origin isolation (which would break the YouTube embed).
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(source as string, {
    executionProviders: ['wasm']
  });
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), [1]);

  return {
    async run(frame, state) {
      const feeds = {
        input: new ort.Tensor('float32', frame, [1, frame.length]),
        state: new ort.Tensor('float32', state, [2, 1, 128]),
        sr
      };
      const output = await session.run(feeds);
      return {
        probability: (output.output.data as Float32Array)[0],
        state: output.stateN.data as Float32Array
      };
    }
  };
}
