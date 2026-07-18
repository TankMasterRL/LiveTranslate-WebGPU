// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Real-model integration test: the model is not stored in the repo — run
// `bun run fetch:models` to download it into the gitignored .model-cache/
// (SILERO_MODEL_PATH overrides the location). Skips itself when absent.
// Verifies the tensor wiring against the actual ONNX graph rather than a mock.
const MODEL_PATH = process.env.SILERO_MODEL_PATH ?? '.model-cache/silero_vad_v5.onnx';
const available = existsSync(MODEL_PATH);

const loadModel = () => new Uint8Array(readFileSync(MODEL_PATH));

describe.skipIf(!available)('createSileroSession (real model)', () => {
  it('matches the integrity pin the app enforces at runtime', async () => {
    // Ties the three copies of the truth together: the bytes the fetch script
    // downloaded, the sha256 pinned in silero-model.ts (checked in the browser
    // by cachedFetch), and — transitively — the hash in scripts/fetch-silero.mjs
    // that verified the download.
    const { sileroModelSha256 } = await import('./silero-model');
    expect(createHash('sha256').update(loadModel()).digest('hex')).toBe(sileroModelSha256);
  });

  it('reports a low speech probability for silence and threads state', async () => {
    const { createSileroSession } = await import('./silero-session');
    const session = await createSileroSession(loadModel());

    const silence = new Float32Array(512);
    const first = await session.run(silence, new Float32Array(2 * 128));
    expect(first.probability).toBeGreaterThanOrEqual(0);
    expect(first.probability).toBeLessThan(0.5);
    expect(first.state).toHaveLength(2 * 128);

    const second = await session.run(silence, first.state);
    expect(second.probability).toBeLessThan(0.5);
  });

  it('drives SileroVad end-to-end: silence never activates it', async () => {
    const { createSileroSession } = await import('./silero-session');
    const { SileroVad } = await import('./silero-vad');
    const vad = new SileroVad(await createSileroSession(loadModel()), { hangoverFrames: 1 });

    for (let i = 0; i < 5; i++) {
      vad.process(new Float32Array(512));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(vad.process(new Float32Array(512))).toBe(false);
  });

  it('drives SileroVad end-to-end: a sustained voiced signal activates it', async () => {
    // Guards the v5 context contract: without the 64-sample context prefix the
    // model's probabilities collapse after the first few windows and sustained
    // speech is never detected (the energy-VAD-works-but-Silero-doesn't bug).
    // A synthetic vowel is crude speech, so assert on the steady state — most
    // of the utterance's second half must be voiced — not on every frame.
    const { createSileroSession } = await import('./silero-session');
    const { SileroVad } = await import('./silero-vad');
    const vad = new SileroVad(await createSileroSession(loadModel()), {
      threshold: 0.5,
      hangoverFrames: 1
    });

    const samples = syntheticVowel(1.5);
    const decisions: boolean[] = [];
    for (let offset = 0; offset + 512 <= samples.length; offset += 512) {
      // Each call reports the previous frame's verdict (fresh, thanks to the
      // sleep) — a one-frame shift the second-half assertion doesn't notice.
      decisions.push(vad.process(samples.subarray(offset, offset + 512)));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const secondHalf = decisions.slice(Math.floor(decisions.length / 2));
    const voiced = secondHalf.filter(Boolean).length;
    expect(voiced).toBeGreaterThanOrEqual(Math.ceil(secondHalf.length / 2));
  });
});

/** Glottal-pulse train through /a/ formant resonators — crude synthetic speech. */
function syntheticVowel(seconds: number, sampleRate = 16_000): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const excitation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f0 = 110 + 20 * Math.sin((2 * Math.PI * 3 * i) / sampleRate); // pitch wobble
    if (i % Math.round(sampleRate / f0) < 2) excitation[i] = 1;
  }
  const resonator = (input: Float32Array, freq: number, bandwidth: number) => {
    const r = Math.exp((-Math.PI * bandwidth) / sampleRate);
    const c = 2 * r * Math.cos((2 * Math.PI * freq) / sampleRate);
    const out = new Float32Array(input.length);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const y = (1 - r) * input[i] + c * y1 - r * r * y2;
      out[i] = y;
      y2 = y1;
      y1 = y;
    }
    return out;
  };
  const voiced = new Float32Array(n);
  for (const [freq, bandwidth, gain] of [
    [700, 110, 1],
    [1220, 120, 0.6],
    [2600, 160, 0.3]
  ]) {
    const band = resonator(excitation, freq, bandwidth);
    for (let i = 0; i < n; i++) voiced[i] += gain * band[i];
  }
  let peak = 0;
  for (const v of voiced) peak = Math.max(peak, Math.abs(v));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const envelope = 0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * i) / sampleRate); // syllable rate
    out[i] = (0.3 * envelope * voiced[i]) / peak;
  }
  return out;
}
