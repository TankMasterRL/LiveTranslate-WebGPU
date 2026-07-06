import type { AsrSegment } from '../transcript';
import { NEMOTRON } from './model';

/**
 * Detokenization for the Nemotron RNN-T output: sentencepiece pieces from
 * vocab.txt (one piece per line, id = line index) where ▁ marks a word
 * boundary. In auto-detect mode the model also emits a locale tag like
 * <en-US> after the terminal punctuation; tags are stripped from the text
 * and surfaced separately.
 */

/** vocab.txt → piece table (id = line index); tolerates a trailing newline. */
export function parseVocab(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** One emitted token with its position on the utterance's timeline. */
export interface EmittedToken {
  id: number;
  /** Emission time relative to the utterance start (encoder frame time). */
  timeMs: number;
}

export interface DecodedUtterance {
  text: string;
  /** Sentence-level segments with true (frame-derived) times. */
  segments: AsrSegment[];
  /** Locale tag the model appended in auto-detect mode, e.g. "en-US". */
  language: string | null;
}

const LOCALE_TAG = /^<[a-z]{2,3}-[A-Za-z]{2,3}>$/;
// Sentence-final punctuation (ASCII + full-width CJK). Splitting here keeps
// long utterances from becoming one giant cue.
const TERMINAL_PUNCTUATION = /[.?!…。？！]$/;

/**
 * Turn greedy-decode emissions into display text plus sentence segments.
 * Segment times come from token emission frames, so cues get true
 * within-utterance timing just like Whisper's return_timestamps path.
 */
export function decodeUtterance(tokens: EmittedToken[], vocab: string[]): DecodedUtterance {
  const segments: AsrSegment[] = [];
  let language: string | null = null;
  let raw = '';
  let startMs: number | null = null;
  let lastMs = 0;

  const close = (endMs: number) => {
    const text = raw.replace(/▁/g, ' ').replace(/\s+/g, ' ').trim();
    raw = '';
    const segmentStart = startMs;
    startMs = null;
    if (!text || segmentStart === null) return;
    segments.push({ text, startMs: segmentStart, endMs: Math.max(endMs, segmentStart) });
  };

  for (const { id, timeMs } of tokens) {
    const piece = vocab[id];
    if (piece === undefined || piece === '<unk>') continue;
    if (LOCALE_TAG.test(piece)) {
      language = piece.slice(1, -1);
      continue;
    }
    startMs ??= timeMs;
    raw += piece;
    lastMs = timeMs;
    if (TERMINAL_PUNCTUATION.test(piece)) close(timeMs + NEMOTRON.encodedFrameMs);
  }
  close(lastMs + NEMOTRON.encodedFrameMs);

  return { text: segments.map((s) => s.text).join(' '), segments, language };
}
