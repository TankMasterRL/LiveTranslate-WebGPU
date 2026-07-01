import { makeCue, type SubtitleCue } from '../subtitles/cue';
import { cleanTranscript, type AsrResult } from './transcript';

export interface AlignOptions {
  /** When the utterance actually began on the media timeline. */
  utteranceStartMs: number;
  /** Length of the transcribed audio chunk. */
  utteranceDurationMs: number;
}

/**
 * Turn an ASR result into cues with true media-timeline times: each Whisper
 * segment becomes its own cue offset from the utterance start; without
 * segments the whole utterance becomes a single full-span cue. Blank text is
 * dropped. (Keeping the last cue on screen for reading time is the pipeline's
 * concern, not alignment's.)
 */
export function segmentsToCues(result: AsrResult, options: AlignOptions): SubtitleCue[] {
  const { utteranceStartMs, utteranceDurationMs } = options;
  const utteranceEndMs = utteranceStartMs + utteranceDurationMs;

  const segments = (result.segments ?? [])
    .map((segment) => ({ ...segment, text: cleanTranscript(segment.text) }))
    .filter((segment) => segment.text.length > 0);

  if (segments.length === 0) {
    const text = cleanTranscript(result.text);
    if (!text) return [];
    return [makeCue({ text, startMs: utteranceStartMs, endMs: utteranceEndMs })];
  }

  return segments.map((segment) => {
    const startMs = utteranceStartMs + (segment.startMs ?? 0);
    const rawEndMs = segment.endMs != null ? utteranceStartMs + segment.endMs : utteranceEndMs;
    return makeCue({ text: segment.text, startMs, endMs: Math.max(rawEndMs, startMs) });
  });
}
