import { describe, expect, it } from 'vitest';
import { EnergyVad, rms } from './vad';

const loud = () => new Float32Array([0.5, -0.5, 0.5, -0.5]);
const quiet = () => new Float32Array([0, 0, 0, 0]);

describe('rms', () => {
  it('computes root-mean-square energy', () => {
    expect(rms(loud())).toBeCloseTo(0.5, 5);
    expect(rms(quiet())).toBe(0);
  });

  it('returns 0 for an empty frame', () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe('EnergyVad', () => {
  it('activates when energy crosses the threshold', () => {
    const vad = new EnergyVad({ threshold: 0.1, hangoverFrames: 2 });
    expect(vad.process(quiet())).toBe(false);
    expect(vad.process(loud())).toBe(true);
  });

  it('holds active through the hangover window then releases', () => {
    const vad = new EnergyVad({ threshold: 0.1, hangoverFrames: 2 });
    vad.process(loud());
    expect(vad.process(quiet())).toBe(true); // 1st trailing silence
    expect(vad.process(quiet())).toBe(true); // 2nd trailing silence
    expect(vad.process(quiet())).toBe(false); // hangover exhausted
  });

  it('re-arms the hangover on new speech', () => {
    const vad = new EnergyVad({ threshold: 0.1, hangoverFrames: 1 });
    vad.process(loud());
    vad.process(quiet());
    expect(vad.process(loud())).toBe(true);
    expect(vad.process(quiet())).toBe(true);
  });
});
