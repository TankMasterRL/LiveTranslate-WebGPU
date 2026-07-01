import { describe, expect, it } from 'vitest';
import { displayText, makeCue, type SubtitleCue } from './cue';

describe('displayText', () => {
  it('returns the translation when present', () => {
    const cue: SubtitleCue = {
      id: '1',
      text: 'hola mundo',
      translation: 'hello world',
      startMs: 0,
      endMs: 1000
    };
    expect(displayText(cue)).toBe('hello world');
  });

  it('falls back to source text when translation is missing', () => {
    const cue: SubtitleCue = { id: '1', text: 'hola mundo', startMs: 0, endMs: 1000 };
    expect(displayText(cue)).toBe('hola mundo');
  });

  it('falls back to source text when translation is an empty string', () => {
    const cue: SubtitleCue = {
      id: '1',
      text: 'hola',
      translation: '   ',
      startMs: 0,
      endMs: 1000
    };
    expect(displayText(cue)).toBe('hola');
  });
});

describe('makeCue', () => {
  it('creates a cue with a unique id and default partial=false', () => {
    const a = makeCue({ text: 'one', startMs: 0, endMs: 500 });
    const b = makeCue({ text: 'two', startMs: 500, endMs: 1000 });
    expect(a.id).not.toBe(b.id);
    expect(a.partial).toBe(false);
    expect(a.text).toBe('one');
  });

  it('honours an explicit partial flag and id', () => {
    const cue = makeCue({ id: 'x', text: 'live', startMs: 0, endMs: 100, partial: true });
    expect(cue.id).toBe('x');
    expect(cue.partial).toBe(true);
  });
});
