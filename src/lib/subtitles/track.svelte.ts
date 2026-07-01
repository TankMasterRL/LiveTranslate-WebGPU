import type { SubtitleCue } from './cue';
import { selectActiveCue } from './select';

export interface SubtitleTrackOptions {
  /** Maximum number of finalized cues to retain (oldest are pruned). */
  maxCues?: number;
}

/**
 * Reactive store of subtitle cues (Svelte 5 runes). Holds a rolling list of
 * finalized cues plus a single in-progress `partial` cue that the overlay shows
 * while ASR streams — the browser analog of LiveTranslate's live overlay.
 */
export class SubtitleTrack {
  #cues = $state<SubtitleCue[]>([]);
  #partial = $state<SubtitleCue | null>(null);
  readonly #maxCues: number;

  constructor(options: SubtitleTrackOptions = {}) {
    this.#maxCues = options.maxCues ?? 200;
  }

  /** Finalized cues, oldest first. */
  get cues(): readonly SubtitleCue[] {
    return this.#cues;
  }

  /** The current in-progress cue, or null. */
  get partial(): SubtitleCue | null {
    return this.#partial;
  }

  /** Finalized cues followed by the partial (if any). */
  get all(): SubtitleCue[] {
    return this.#partial ? [...this.#cues, this.#partial] : [...this.#cues];
  }

  /** Set/replace the in-progress cue shown while ASR is still streaming. */
  setPartial(cue: SubtitleCue | null): void {
    this.#partial = cue ? { ...cue, partial: true } : null;
  }

  /** Commit a finalized cue, prune to `maxCues`, and clear the partial. */
  commit(cue: SubtitleCue): void {
    this.#cues.push({ ...cue, partial: false });
    const overflow = this.#cues.length - this.#maxCues;
    if (overflow > 0) this.#cues.splice(0, overflow);
    this.#partial = null;
  }

  /** Remove all cues and the partial. */
  clear(): void {
    this.#cues = [];
    this.#partial = null;
  }

  /** The cue to display at `currentTimeMs` (including the partial). */
  activeAt(currentTimeMs: number, windowMs = 0): SubtitleCue | undefined {
    return selectActiveCue(this.all, currentTimeMs, windowMs);
  }
}
