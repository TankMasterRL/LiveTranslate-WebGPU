import { describe, expect, it } from 'vitest';
import { cleanTranscript, isBlank } from './transcript';

describe('cleanTranscript', () => {
  it('strips Whisper special tokens', () => {
    const raw = '<|startoftranscript|><|en|><|transcribe|><|0.00|> Hello there<|endoftext|>';
    expect(cleanTranscript(raw)).toBe('Hello there');
  });

  it('collapses whitespace and trims', () => {
    expect(cleanTranscript('  hello   world \n')).toBe('hello world');
  });

  it('returns an empty string for token-only / blank output', () => {
    expect(cleanTranscript('<|endoftext|>')).toBe('');
    expect(cleanTranscript('   ')).toBe('');
  });
});

describe('isBlank', () => {
  it('is true for empty or token-only transcripts', () => {
    expect(isBlank('<|endoftext|>')).toBe(true);
    expect(isBlank('  ')).toBe(true);
  });

  it('is false when real text remains', () => {
    expect(isBlank('<|0.00|> hi')).toBe(false);
  });
});
