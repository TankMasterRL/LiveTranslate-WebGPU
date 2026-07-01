/**
 * A single subtitle line on the media timeline.
 *
 * Mirrors the streaming behaviour of the original LiveTranslate overlay: cues
 * carry the source-language transcription plus an optional translation, and can
 * be in-progress (`partial`) while ASR is still streaming.
 */
export interface SubtitleCue {
  /** Stable identifier, used as a keyed-each key in the overlay. */
  id: string;
  /** Source-language transcription text. */
  text: string;
  /** Translated text, if a translator has run. Falls back to `text`. */
  translation?: string;
  /** Start time in milliseconds on the media timeline. */
  startMs: number;
  /** End time in milliseconds on the media timeline. */
  endMs: number;
  /** True while ASR is still refining this cue (not yet finalized). */
  partial?: boolean;
}

/** Text to render for a cue: the translation when available, else the source. */
export function displayText(cue: SubtitleCue): string {
  const translation = cue.translation?.trim();
  return translation ? translation : cue.text;
}

let counter = 0;

/** Create a cue, filling in a unique id and `partial: false` by default. */
export function makeCue(init: Omit<SubtitleCue, 'id' | 'partial'> & Partial<Pick<SubtitleCue, 'id' | 'partial'>>): SubtitleCue {
  return {
    id: init.id ?? `cue-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    text: init.text,
    translation: init.translation,
    startMs: init.startMs,
    endMs: init.endMs,
    partial: init.partial ?? false
  };
}
