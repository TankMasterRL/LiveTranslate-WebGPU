import { describe, expect, it } from 'vitest';
import { NEMOTRON } from './model';
import { LogMelExtractor, fftInPlace } from './features';

function sine(freqHz: number, samples: number, sampleRate = NEMOTRON.sampleRate): Float32Array {
  const out = new Float32Array(samples);
  for (let n = 0; n < samples; n++) out[n] = Math.sin((2 * Math.PI * freqHz * n) / sampleRate);
  return out;
}

describe('fftInPlace', () => {
  it('transforms an impulse to a flat spectrum', () => {
    const re = new Float32Array(8);
    const im = new Float32Array(8);
    re[0] = 1;
    fftInPlace(re, im);
    for (let k = 0; k < 8; k++) {
      expect(re[k]).toBeCloseTo(1, 5);
      expect(im[k]).toBeCloseTo(0, 5);
    }
  });

  it('concentrates a pure complex exponential in a single bin', () => {
    const n = 16;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    // cos(2π·3n/N): energy splits between bins 3 and N-3.
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 3 * i) / n);
    fftInPlace(re, im);
    expect(re[3]).toBeCloseTo(n / 2, 4);
    expect(re[n - 3]).toBeCloseTo(n / 2, 4);
    expect(Math.abs(re[5])).toBeLessThan(1e-4);
  });
});

describe('LogMelExtractor', () => {
  const extractor = new LogMelExtractor();

  it('produces 1 + floor(N/hop) frames of nMels log-mel values', () => {
    const frames = extractor.frames(new Float32Array(16_000));
    expect(frames.length).toBe(1 + Math.floor(16_000 / NEMOTRON.hopLength));
    for (const frame of frames) expect(frame.length).toBe(NEMOTRON.nMels);
  });

  it('maps silence to the log floor', () => {
    const frames = extractor.frames(new Float32Array(3200));
    const floor = Math.log(NEMOTRON.logGuard);
    for (const frame of frames) {
      for (const v of frame) expect(v).toBeCloseTo(floor, 5);
    }
  });

  it('is deterministic', () => {
    const audio = sine(440, 3200);
    const a = extractor.frames(audio);
    const b = extractor.frames(audio);
    expect(Array.from(a[5])).toEqual(Array.from(b[5]));
  });

  it('places higher tones in higher mel bands', () => {
    const peakBand = (freq: number): number => {
      const frames = extractor.frames(sine(freq, 8000));
      const mid = frames[Math.floor(frames.length / 2)];
      let best = 0;
      for (let m = 1; m < mid.length; m++) if (mid[m] > mid[best]) best = m;
      return best;
    };
    const low = peakBand(300);
    const mid = peakBand(1000);
    const high = peakBand(3000);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    // Slaney scale is linear below 1kHz: a 300Hz tone in 128 bands over
    // 0–8kHz should sit in the low third of the filterbank.
    expect(low).toBeGreaterThan(5);
    expect(low).toBeLessThan(45);
  });

  it('boosts high frequencies via pre-emphasis', () => {
    const energy = (freq: number): number => {
      const frames = extractor.frames(sine(freq, 8000));
      const mid = frames[Math.floor(frames.length / 2)];
      return Math.max(...mid);
    };
    // Same amplitude in, but the 3kHz tone must come out hotter than 100Hz.
    expect(energy(3000)).toBeGreaterThan(energy(100));
  });
});
