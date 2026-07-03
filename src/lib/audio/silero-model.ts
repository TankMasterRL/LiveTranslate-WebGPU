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

/**
 * SHA-256 (lowercase hex) of the model bytes, enforced by cachedFetch on
 * every load — a download or cached copy that doesn't match is rejected, so
 * the model can't silently drift under the un-pinned `main` revision (Silero
 * has already shipped v6 models upstream). This is the canonical Silero VAD
 * v5 file: byte-identical copies ship in the silero-vad 5.1 and 5.1.2 PyPI
 * releases. When deliberately upgrading the model, refetch and re-pin here
 * and in scripts/fetch-silero.mjs (the integration test enforces they agree).
 */
export const sileroModelSha256 = '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f';
