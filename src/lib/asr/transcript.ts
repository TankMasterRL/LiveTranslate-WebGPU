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
