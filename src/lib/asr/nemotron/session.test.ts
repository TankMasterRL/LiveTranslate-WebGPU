import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNemotronSessions, type NemotronModelBytes } from './session';

// onnxruntime-web caches backend initialization per backend *name*, but the
// 'webgpu' and 'wasm' names share one WASM backend object. Kicking off a
// ['webgpu'] and a ['wasm'] InferenceSession.create concurrently makes both
// names call that backend's init(), and the second call dies with
// "multiple calls to 'initWasm()' detected." — surfacing in the UI as
// "no available backend found. ERR: [wasm] ...". These tests pin the ordering
// that avoids the race: the encoder session (which carries the pipeline's
// backend name) must finish creating before the wasm sessions start.
const ortMock = vi.hoisted(() => {
  const createCalls: { providers: string[]; resolve: (session: unknown) => void }[] = [];
  return {
    createCalls,
    InferenceSession: {
      create: (_model: Uint8Array, options: { executionProviders: string[] }) =>
        new Promise((resolve) => {
          createCalls.push({ providers: options.executionProviders, resolve });
        })
    },
    Tensor: class {},
    env: { wasm: {} }
  };
});

vi.mock('onnxruntime-web', () => ortMock);

const modelBytes = (): NemotronModelBytes => ({
  encoder: { model: new Uint8Array(1), data: new Uint8Array(1) },
  decoder: { model: new Uint8Array(1), data: new Uint8Array(1) },
  joint: { model: new Uint8Array(1), data: new Uint8Array(1) }
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createNemotronSessions', () => {
  beforeEach(() => {
    ortMock.createCalls.length = 0;
  });

  it('creates the encoder session before starting the wasm sessions', async () => {
    const pending = createNemotronSessions(modelBytes(), 'webgpu');
    await flush();

    expect(ortMock.createCalls.map((call) => call.providers)).toEqual([['webgpu']]);

    ortMock.createCalls[0].resolve({});
    await flush();

    expect(ortMock.createCalls.map((call) => call.providers)).toEqual([
      ['webgpu'],
      ['wasm'],
      ['wasm']
    ]);

    for (const call of ortMock.createCalls.slice(1)) call.resolve({});
    await expect(pending).resolves.toBeDefined();
  });
});
