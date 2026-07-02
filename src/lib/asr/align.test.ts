import { describe, expect, it } from 'vitest';
import { segmentsToCues } from './align';
import type { AsrResult } from './transcript';

const opts = { utteranceStartMs: 1000, utteranceDurationMs: 500 };

describe('segmentsToCues', () => {
  it('maps segments to cues offset from the utterance start, cleaning text', () => {
    const result: AsrResult = {
      text: ' one two',
      segments: [
        { text: '<|0.00|> one', startMs: 0, endMs: 200 },
        { text: ' two', startMs: 200, endMs: 450 }
      ]
    };
    const cues = segmentsToCues(result, opts);
    expect(cues.map((c) => c.text)).toEqual(['one', 'two']);
    expect(cues[0]).toMatchObject({ startMs: 1200 - 200, endMs: 1200 });
    expect(cues[1]).toMatchObject({ startMs: 1200, endMs: 1450 });
  });

  it('falls back to the utterance end for a null segment end', () => {
    const result: AsrResult = {
      text: 'tail',
      segments: [{ text: 'tail', startMs: 100, endMs: null }]
    };
    const cues = segmentsToCues(result, opts);
    expect(cues[0]).toMatchObject({ startMs: 1100, endMs: 1500 });
  });

  it('never produces a cue ending before it starts', () => {
    const result: AsrResult = {
      text: 'x',
      segments: [{ text: 'x', startMs: 600, endMs: null }]
    };
    const [cue] = segmentsToCues(result, opts);
    expect(cue.endMs).toBeGreaterThanOrEqual(cue.startMs);
  });

  it('drops blank segments but keeps the rest', () => {
    const result: AsrResult = {
      text: 'kept',
      segments: [
        { text: '<|endoftext|>', startMs: 0, endMs: 100 },
        { text: 'kept', startMs: 100, endMs: 200 }
      ]
    };
    expect(segmentsToCues(result, opts).map((c) => c.text)).toEqual(['kept']);
  });

  it('builds a single full-span cue when there are no segments', () => {
    const cues = segmentsToCues({ text: '<|0.00|> whole utterance' }, opts);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ text: 'whole utterance', startMs: 1000, endMs: 1500 });
  });

  it('returns nothing for blank results', () => {
    expect(segmentsToCues({ text: '<|endoftext|>' }, opts)).toEqual([]);
    expect(segmentsToCues({ text: '  ', segments: [] }, opts)).toEqual([]);
  });
});
