import { describe, expect, it } from 'vitest';
import { decodeUtterance, parseVocab } from './tokenizer';

// A miniature vocab shaped like the real one: sentencepiece pieces with ▁
// word-boundary markers, plus locale-tag and <unk> specials.
const VOCAB = [
  '<unk>', // 0
  '▁hello', // 1
  '▁world', // 2
  '.', // 3
  '▁how', // 4
  '▁are', // 5
  '▁you', // 6
  '?', // 7
  '<en-US>', // 8
  'ing', // 9
  '▁go', // 10
  '！', // 11 (full-width terminal punctuation)
  '<ja-JP>' // 12
];

const at = (id: number, timeMs: number) => ({ id, timeMs });

describe('parseVocab', () => {
  it('splits lines and keeps ids aligned, ignoring a trailing newline', () => {
    const vocab = parseVocab('<unk>\n▁a\nb\n');
    expect(vocab).toEqual(['<unk>', '▁a', 'b']);
  });
});

describe('decodeUtterance', () => {
  it('joins pieces, turning ▁ markers into word boundaries', () => {
    const { text, segments } = decodeUtterance(
      [at(1, 0), at(2, 80), at(10, 160), at(9, 240)],
      VOCAB
    );
    expect(text).toBe('hello world going');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ text: 'hello world going', startMs: 0 });
    expect(segments[0].endMs).toBeGreaterThan(240);
  });

  it('splits segments after terminal punctuation with true times', () => {
    const { text, segments } = decodeUtterance(
      [at(1, 100), at(2, 200), at(3, 250), at(4, 800), at(5, 880), at(6, 960), at(7, 1000)],
      VOCAB
    );
    expect(text).toBe('hello world. how are you?');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ text: 'hello world.', startMs: 100 });
    expect(segments[1]).toMatchObject({ text: 'how are you?', startMs: 800 });
    expect(segments[0].endMs).toBeLessThanOrEqual(segments[1].startMs!);
  });

  it('recognizes full-width terminal punctuation', () => {
    const { segments } = decodeUtterance([at(1, 0), at(11, 80), at(2, 500)], VOCAB);
    expect(segments).toHaveLength(2);
  });

  it('strips locale tags anywhere and reports the last one as the language', () => {
    const { text, language, segments } = decodeUtterance(
      [at(1, 0), at(2, 80), at(3, 160), at(8, 240)],
      VOCAB
    );
    expect(text).toBe('hello world.');
    expect(language).toBe('en-US');
    expect(segments).toHaveLength(1);
  });

  it('drops <unk> pieces', () => {
    const { text } = decodeUtterance([at(1, 0), at(0, 80), at(2, 160)], VOCAB);
    expect(text).toBe('hello world');
  });

  it('returns empty output for no tokens or tag-only emissions', () => {
    expect(decodeUtterance([], VOCAB)).toEqual({ text: '', segments: [], language: null });
    const tagOnly = decodeUtterance([at(12, 0)], VOCAB);
    expect(tagOnly.text).toBe('');
    expect(tagOnly.segments).toEqual([]);
    expect(tagOnly.language).toBe('ja-JP');
  });

  it('ignores out-of-range token ids', () => {
    const { text } = decodeUtterance([at(1, 0), at(999, 80)], VOCAB);
    expect(text).toBe('hello');
  });
});
