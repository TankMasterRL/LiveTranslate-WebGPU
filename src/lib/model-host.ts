/**
 * Point transformers.js at an alternate Hugging Face-compatible host (mirror
 * or self-hosted weights) when one is configured — the moebius-web
 * VITE_MODEL_BASE pattern. Blank/undefined leaves the default hub untouched.
 *
 * Workers call this with `import.meta.env.VITE_MODEL_HOST` before building
 * their pipelines; the host must serve the hub URL layout
 * (`/{model}/resolve/{revision}/…`).
 */
export function applyModelHost(
  target: { remoteHost: string },
  host: string | undefined | null
): void {
  const trimmed = host?.trim().replace(/\/+$/, '');
  if (trimmed) target.remoteHost = trimmed;
}
