import * as ort from 'onnxruntime-web';
import { cachedFetch } from '../model-cache';
import type { SileroSession } from './silero-vad';

/**
 * Create a Silero v5 inference session with onnxruntime-web (WASM backend —
 * the model is tiny, so no WebGPU needed). Contract verified against the real
 * model in silero-session.integration.test.ts:
 * inputs `input` [1,N] f32 (N = 64 context + 512 fresh samples — SileroVad
 * threads the context), `state` [2,1,128] f32, `sr` int64;
 * outputs `output` [1,1] speech probability, `stateN` [2,1,128].
 */
export async function createSileroSession(
  source: string | Uint8Array,
  options: { sha256?: string } = {}
): Promise<SileroSession> {
  // Single-threaded: we run one 512-sample frame at a time, and this avoids
  // needing cross-origin isolation (which would break the YouTube embed).
  ort.env.wasm.numThreads = 1;
  // URLs go through the Cache Storage API so repeat loads skip the network;
  // when a sha256 pin is given, cachedFetch refuses bytes that don't match.
  const model =
    typeof source === 'string' ? await cachedFetch(source, { sha256: options.sha256 }) : source;
  const session = await ort.InferenceSession.create(model, {
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
