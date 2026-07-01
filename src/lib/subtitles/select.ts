import type { SubtitleCue } from './cue';

/**
 * All cues active at `currentTimeMs`, i.e. whose `[startMs, endMs]` span
 * contains the time. `windowMs` pads the span on both sides so a cue can linger
 * slightly before/after its exact bounds (useful for live captions).
 */
export function selectActiveCues(
  cues: readonly SubtitleCue[],
  currentTimeMs: number,
  windowMs = 0
): SubtitleCue[] {
  return cues.filter(
    (c) => currentTimeMs >= c.startMs - windowMs && currentTimeMs <= c.endMs + windowMs
  );
}

/**
 * The single cue to display at `currentTimeMs`. When multiple cues overlap the
 * most recently started one wins, matching the "show the newest line" feel of a
 * live transcript.
 */
export function selectActiveCue(
  cues: readonly SubtitleCue[],
  currentTimeMs: number,
  windowMs = 0
): SubtitleCue | undefined {
  const active = selectActiveCues(cues, currentTimeMs, windowMs);
  if (active.length === 0) return undefined;
  return active.reduce((best, c) => (c.startMs >= best.startMs ? c : best));
}
