import { describe, expect, it } from 'vitest';
import { cueDisplayMs } from './duration';

describe('cueDisplayMs', () => {
  it('scales with text length at ~70ms per character', () => {
    expect(cueDisplayMs('a'.repeat(40))).toBe(2800);
  });

  it('clamps short text to the minimum', () => {
    expect(cueDisplayMs('hi')).toBe(1800);
    expect(cueDisplayMs('')).toBe(1800);
  });

  it('clamps long text to the maximum', () => {
    expect(cueDisplayMs('a'.repeat(500))).toBe(7000);
  });

  it('ignores surrounding whitespace', () => {
    expect(cueDisplayMs('   hi   ')).toBe(1800);
  });

  it('honours custom bounds', () => {
    expect(cueDisplayMs('hi', { minMs: 100, msPerChar: 50 })).toBe(100);
    expect(cueDisplayMs('a'.repeat(100), { maxMs: 3000 })).toBe(3000);
  });
});
