/**
 * URL of the vendored Silero VAD v5 model (MIT, from snakers4/silero-vad,
 * ~2.3MB) for a given SvelteKit base path. Static assets are served under the
 * base path, so a subpath deployment (e.g. GitHub Pages at /repo/) must prefix
 * it — a bare '/models/…' 404s there. Callers resolve the base from
 * `$app/paths` (kept out of this module so node-environment tests can import
 * the audio stack without SvelteKit's client runtime).
 */
export function sileroModelUrl(basePath: string): string {
  return `${basePath}/models/silero_vad_v5.onnx`;
}
