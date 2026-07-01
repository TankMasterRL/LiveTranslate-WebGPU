import { describe, expect, it } from 'vitest';
import { parseVideoId } from './url';

describe('parseVideoId', () => {
  it('accepts a bare 11-character video id', () => {
    expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a standard watch URL', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a youtu.be short URL', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
  });

  it('parses an embed URL', () => {
    expect(parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a shorts URL', () => {
    expect(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(parseVideoId('https://example.com/watch?v=nope')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseVideoId('   ')).toBeNull();
  });
});
