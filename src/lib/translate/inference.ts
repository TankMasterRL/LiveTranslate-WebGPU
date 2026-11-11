import type { WebGPUSupport } from '../asr/webgpu';
import type { AsrBackend } from '../pipeline.svelte';

export interface TranslationRuntime {
  backend: AsrBackend;
  dtype: 'fp16' | 'q8';
}

/**
 * Where and at what precision to run the local translation model.
 *
 * fp16 on WebGPU when the adapter supports `shader-f16`; otherwise q8 on WASM
 * — never q8 on WebGPU. The q8 (`*_quantized.onnx`) exports are dynamically
 * quantized: their MatMulInteger/DynamicQuantizeLinear nodes have no WebGPU
 * kernels in onnxruntime-web, so on the webgpu device every matmul falls back
 * to the (single-threaded, no COOP/COEP) CPU with a GPU↔CPU copy around it,
 * for every generated token — far slower than plain WASM. fp32 (the Whisper
 * worker's WebGPU choice) is impractical here: NLLB-600M is ~3.5 GB in fp32.
 */
export function chooseTranslationRuntime(support: WebGPUSupport): TranslationRuntime {
  return support.supported && support.fp16
    ? { backend: 'webgpu', dtype: 'fp16' }
    : { backend: 'wasm', dtype: 'q8' };
}

/** Hard ceiling on generated tokens, whatever the source length. */
const MAX_NEW_TOKENS = 256;

/**
 * Output-length cap for a source of `inputTokens` tokens. Decoding is greedy
 * (transformers.js doesn't branch beams) and nothing else stops a
 * degenerate output short of the model's own limit, so a garbled input could
 * otherwise decode hundreds of tokens and hold the translator for seconds.
 * A subtitle line's translation is rarely more than twice its source.
 */
export function maxNewTokens(inputTokens: number): number {
  return Math.min(MAX_NEW_TOKENS, Math.ceil(inputTokens * 2) + 16);
}

/**
 * Ban any repeated 4-gram in the output: stops repetition loops ("I'm, I'm,
 * I'm, …") outright while leaving ordinary repeated words alone — unlike a
 * repetition penalty, which would also penalize every reused article or comma.
 */
export const NO_REPEAT_NGRAM_SIZE = 4;
