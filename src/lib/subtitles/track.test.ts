import { describe, expect, it } from 'vitest';
import { makeCue } from './cue';
import { SubtitleTrack } from './track.svelte';

describe('SubtitleTrack', () => {
  it('starts empty', () => {
    const track = new SubtitleTrack();
    expect(track.cues).toHaveLength(0);
    expect(track.partial).toBeNull();
    expect(track.all).toEqual([]);
  });

  it('commits finalized cues and clears the partial', () => {
    const track = new SubtitleTrack();
    track.setPartial(makeCue({ text: 'typing…', startMs: 0, endMs: 100 }));
    expect(track.partial?.partial).toBe(true);

    track.commit(makeCue({ text: 'done', startMs: 0, endMs: 100 }));
    expect(track.cues).toHaveLength(1);
    expect(track.cues[0].text).toBe('done');
    expect(track.cues[0].partial).toBe(false);
    expect(track.partial).toBeNull();
  });

  it('exposes the partial last in `all`', () => {
    const track = new SubtitleTrack();
    track.commit(makeCue({ text: 'first', startMs: 0, endMs: 100 }));
    track.setPartial(makeCue({ text: 'live', startMs: 100, endMs: 200 }));
    expect(track.all.map((c) => c.text)).toEqual(['first', 'live']);
  });

  it('prunes to maxCues, dropping the oldest', () => {
    const track = new SubtitleTrack({ maxCues: 2 });
    track.commit(makeCue({ text: '1', startMs: 0, endMs: 1 }));
    track.commit(makeCue({ text: '2', startMs: 1, endMs: 2 }));
    track.commit(makeCue({ text: '3', startMs: 2, endMs: 3 }));
    expect(track.cues.map((c) => c.text)).toEqual(['2', '3']);
  });

  it('selects the active cue at a given time', () => {
    const track = new SubtitleTrack();
    track.commit(makeCue({ text: 'a', startMs: 0, endMs: 1000 }));
    track.commit(makeCue({ text: 'b', startMs: 1000, endMs: 2000 }));
    expect(track.activeAt(1500)?.text).toBe('b');
    expect(track.activeAt(9000)).toBeUndefined();
  });

  it('clears all state', () => {
    const track = new SubtitleTrack();
    track.commit(makeCue({ text: 'a', startMs: 0, endMs: 1 }));
    track.setPartial(makeCue({ text: 'p', startMs: 1, endMs: 2 }));
    track.clear();
    expect(track.cues).toHaveLength(0);
    expect(track.partial).toBeNull();
  });
});
