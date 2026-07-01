import { describe, expect, it } from 'vitest';
import { downmixToMono, resampleLinear } from './resample';

describe('downmixToMono', () => {
  it('averages channels sample-by-sample', () => {
    const left = new Float32Array([0, 1, 0.5]);
    const right = new Float32Array([1, 3, 0.5]);
    expect(Array.from(downmixToMono([left, right]))).toEqual([0.5, 2, 0.5]);
  });

  it('returns a copy of the single channel unchanged', () => {
    const mono = new Float32Array([0.5, 0.25]); // float32-exact values
    const out = downmixToMono([mono]);
    expect(Array.from(out)).toEqual([0.5, 0.25]);
    expect(out).not.toBe(mono);
  });

  it('handles empty input', () => {
    expect(downmixToMono([]).length).toBe(0);
  });
});

describe('resampleLinear', () => {
  it('returns a copy when rates are equal', () => {
    const input = new Float32Array([1, 2, 3]);
    const out = resampleLinear(input, 16000, 16000);
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(out).not.toBe(input);
  });

  it('downsamples by an integer factor', () => {
    const input = new Float32Array([0, 1, 2, 3]);
    // 4 -> 2 kHz halves the length, sampling positions 0 and 2.
    expect(Array.from(resampleLinear(input, 4000, 2000))).toEqual([0, 2]);
  });

  it('produces the expected output length for 48k -> 16k', () => {
    const input = new Float32Array(4800); // 100ms @ 48kHz
    const out = resampleLinear(input, 48000, 16000);
    expect(out.length).toBe(1600); // 100ms @ 16kHz
  });

  it('linearly interpolates between samples when upsampling', () => {
    const out = resampleLinear(new Float32Array([0, 10]), 1000, 2000);
    expect(Array.from(out)).toEqual([0, 5, 10, 10]);
  });
});
