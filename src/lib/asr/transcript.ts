/** One Whisper segment with times relative to the transcribed chunk's start. */
export interface AsrSegment {
  text: string;
  startMs: number | null;
  /** Whisper sometimes leaves the final segment's end open. */
  endMs: number | null;
}

/** Output of one ASR run over an utterance chunk. */
export interface AsrResult {
  text: string;
  segments?: AsrSegment[];
  /**
   * Engine diagnostic worth showing to the user (e.g. repeated empty
   * decodes). Empty results commit no cue and raise no error, so without
   * this a persistently failing engine is indistinguishable from silence.
   */
  notice?: string;
}

// Whisper special/timestamp tokens, e.g. <|startoftranscript|>, <|en|>, <|0.00|>.
const SPECIAL_TOKEN = /<\|[^|]*\|>/g;

/** Strip Whisper special/timestamp tokens and normalise whitespace. */
export function cleanTranscript(raw: string): string {
  return raw.replace(SPECIAL_TOKEN, ' ').replace(/\s+/g, ' ').trim();
}

/** True when a transcript carries no real text (blank or token-only). */
export function isBlank(raw: string): boolean {
  return cleanTranscript(raw).length === 0;
}
