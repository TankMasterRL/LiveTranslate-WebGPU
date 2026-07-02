// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Real-model integration test: runs only when SILERO_MODEL_PATH points at
// silero_vad_v5.onnx (e.g. static/models/silero_vad_v5.onnx). Verifies the
// tensor wiring against the actual ONNX graph rather than a mock.
const MODEL_PATH = process.env.SILERO_MODEL_PATH ?? 'static/models/silero_vad_v5.onnx';
const available = existsSync(MODEL_PATH);

const loadModel = () => new Uint8Array(readFileSync(MODEL_PATH));

describe.skipIf(!available)('createSileroSession (real model)', () => {
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
});
