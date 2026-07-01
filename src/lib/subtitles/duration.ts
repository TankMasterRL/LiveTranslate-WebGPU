export interface DisplayDurationOptions {
  minMs?: number;
  maxMs?: number;
  msPerChar?: number;
}

/**
 * How long a subtitle line should stay on screen, based on reading speed
 * (~70ms per character ≈ 14 chars/sec), clamped to sane bounds.
 */
export function cueDisplayMs(text: string, options: DisplayDurationOptions = {}): number {
  const minMs = options.minMs ?? 1800;
  const maxMs = options.maxMs ?? 7000;
  const msPerChar = options.msPerChar ?? 70;
  const raw = Math.round(text.trim().length * msPerChar);
  return Math.min(maxMs, Math.max(minMs, raw));
}
