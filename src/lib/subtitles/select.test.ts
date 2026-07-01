import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from './cue';
import { selectActiveCue, selectActiveCues } from './select';

const cue = (id: string, startMs: number, endMs: number): SubtitleCue => ({
  id,
  text: id,
  startMs,
  endMs
});

const cues: SubtitleCue[] = [cue('a', 0, 1000), cue('b', 1000, 2000), cue('c', 1500, 2500)];

describe('selectActiveCues', () => {
  it('returns cues whose span contains the current time (inclusive)', () => {
    expect(selectActiveCues(cues, 500).map((c) => c.id)).toEqual(['a']);
    expect(selectActiveCues(cues, 1800).map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('returns an empty array when nothing is active', () => {
    expect(selectActiveCues(cues, 5000)).toEqual([]);
  });

  it('respects a window padding around the cue span', () => {
    // 2200 is past b's end (2000) but within a 300ms window.
    expect(selectActiveCues([cue('b', 1000, 2000)], 2200, 300).map((c) => c.id)).toEqual(['b']);
    expect(selectActiveCues([cue('b', 1000, 2000)], 2200, 100)).toEqual([]);
  });
});

describe('selectActiveCue', () => {
  it('returns the most recently started cue among overlaps', () => {
    expect(selectActiveCue(cues, 1800)?.id).toBe('c');
  });

  it('returns undefined when no cue is active', () => {
    expect(selectActiveCue(cues, 5000)).toBeUndefined();
  });
});
