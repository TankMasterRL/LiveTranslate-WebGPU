import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNemotronSessions, type NemotronModelBytes } from './session';

// Two ort builds are in play (see session.ts): the webgpu backend must load
// the native-WebGPU-EP build ('onnxruntime-web/jspi') because the default
// build's JSEP Concat kernel cannot bind the encoder's 24-layer cache concat,
// while the wasm backend keeps the default build. Each mock records its own
// InferenceSession.create calls so the tests can tell the builds apart.
//
// The ordering pin: onnxruntime-web caches backend initialization per backend
// *name*, but the 'webgpu' and 'wasm' names share one WASM backend object.
// Kicking off a ['webgpu'] and a ['wasm'] InferenceSession.create concurrently
// makes both names call that backend's init(), and the second call dies with
// "multiple calls to 'initWasm()' detected." — surfacing in the UI as
// "no available backend found. ERR: [wasm] ...". The encoder session (which
// carries the pipeline's backend name) must finish creating before the wasm
// sessions start.
const ortMocks = vi.hoisted(() => {
  const makeOrtMock = () => {
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
  };
  return { default: makeOrtMock(), jspi: makeOrtMock() };
});

vi.mock('onnxruntime-web', () => ortMocks.default);
vi.mock('onnxruntime-web/jspi', () => ortMocks.jspi);

const modelBytes = (): NemotronModelBytes => ({
  encoder: { model: new Uint8Array(1), data: new Uint8Array(1) },
  decoder: { model: new Uint8Array(1), data: new Uint8Array(1) },
  joint: { model: new Uint8Array(1), data: new Uint8Array(1) }
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Node exposes WebAssembly JSPI only behind a flag, so the suite fakes the
// capability marker the session module feature-detects.
const wasmGlobal = WebAssembly as { Suspending?: unknown };

describe('createNemotronSessions', () => {
  beforeEach(() => {
    ortMocks.default.createCalls.length = 0;
    ortMocks.jspi.createCalls.length = 0;
    wasmGlobal.Suspending = class {};
  });

  afterEach(() => {
    delete wasmGlobal.Suspending;
  });

  it('creates the encoder session before starting the wasm sessions', async () => {
    const pending = createNemotronSessions(modelBytes(), 'webgpu');
    await flush();

    expect(ortMocks.jspi.createCalls.map((call) => call.providers)).toEqual([['webgpu']]);

    ortMocks.jspi.createCalls[0].resolve({});
    await flush();

    expect(ortMocks.jspi.createCalls.map((call) => call.providers)).toEqual([
      ['webgpu'],
      ['wasm'],
      ['wasm']
    ]);

    for (const call of ortMocks.jspi.createCalls.slice(1)) call.resolve({});
    await expect(pending).resolves.toBeDefined();
  });

  it('keeps the wasm backend on the default onnxruntime-web build', async () => {
    const pending = createNemotronSessions(modelBytes(), 'wasm');
    await flush();

    ortMocks.default.createCalls[0]?.resolve({});
    await flush();
    for (const call of ortMocks.default.createCalls.slice(1)) call.resolve({});

    await expect(pending).resolves.toBeDefined();
    expect(ortMocks.default.createCalls.map((call) => call.providers)).toEqual([
      ['wasm'],
      ['wasm'],
      ['wasm']
    ]);
    expect(ortMocks.jspi.createCalls).toHaveLength(0);
  });

  it('rejects the webgpu backend when WebAssembly JSPI is unavailable', async () => {
    delete wasmGlobal.Suspending;

    await expect(createNemotronSessions(modelBytes(), 'webgpu')).rejects.toThrow(
      /JavaScript Promise Integration/
    );
    expect(ortMocks.default.createCalls).toHaveLength(0);
    expect(ortMocks.jspi.createCalls).toHaveLength(0);
  });
});
