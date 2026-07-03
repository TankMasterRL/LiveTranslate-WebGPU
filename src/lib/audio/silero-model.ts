import { applyModelHost } from '../model-host';

/**
 * URL of the Silero VAD v5 ONNX model (MIT, ~2.3MB) on the Hugging Face hub —
 * no model files are stored in this repo; the browser downloads them into the
 * Cache Storage model cache on first use (see model-cache.ts). Pass
 * `import.meta.env.VITE_MODEL_HOST` so a configured HF-compatible mirror is
 * honored exactly like the Whisper/translation workers (same
 * `/{model}/resolve/{revision}/…` layout, same host normalization).
 * `scripts/fetch-silero.mjs` mirrors this URL for the node/e2e test cache —
 * keep them in sync.
 */
export function sileroModelUrl(modelHost?: string | null): string {
  const target = { remoteHost: 'https://huggingface.co' };
  applyModelHost(target, modelHost);
  return `${target.remoteHost}/onnx-community/silero-vad/resolve/main/onnx/model.onnx`;
}
