import { describe, expect, it, vi } from 'vitest';
import type { AsrEngine } from '../pipeline.svelte';
import {
  AsrEnginePool,
  DEFAULT_ASR_SETTINGS,
  type AsrSettings,
  type NemotronAsrEngine
} from './factory';
import type { NemotronClientOptions } from './nemotron-client';

const fakeEngine = (): AsrEngine & { defunct: boolean } => ({
  defunct: false,
  load: async () => {},
  transcribe: async () => ({ text: '' }),
  dispose: vi.fn()
});

const fakeNemotron = () => {
  const configured: NemotronClientOptions[] = [];
  const engine: NemotronAsrEngine & { defunct: boolean } = {
    ...fakeEngine(),
    configure: (options) => void configured.push(options)
  };
  return { engine, configured };
};

const settings = (overrides: Partial<AsrSettings> = {}): AsrSettings => ({
  ...DEFAULT_ASR_SETTINGS,
  ...overrides
});

describe('AsrEnginePool', () => {
  it('defaults to the Whisper engine, auto language and an adaptive chunk size', () => {
    expect(DEFAULT_ASR_SETTINGS.engine).toBe('whisper');
    expect(DEFAULT_ASR_SETTINGS.language).toBe('auto');
    expect(DEFAULT_ASR_SETTINGS.nemotronChunkMs).toBe('auto');
  });

  it('builds Whisper via the injected seam', () => {
    const engine = fakeEngine();
    const createWhisper = vi.fn(() => engine);
    const pool = new AsrEnginePool({ createWhisper });
    expect(pool.acquire(settings({ engine: 'whisper' }))).toBe(engine);
    expect(createWhisper).toHaveBeenCalledOnce();
  });

  it('builds Nemotron configured with the language hint and chunk size', () => {
    const { engine, configured } = fakeNemotron();
    const pool = new AsrEnginePool({ createNemotron: () => engine });
    const built = pool.acquire(
      settings({ engine: 'nemotron', language: 'de-DE', nemotronChunkMs: '1120' })
    );
    expect(built).toBe(engine);
    expect(configured.at(-1)).toEqual({ language: 'de-DE', chunkMs: '1120' });
  });

  it('translates auto to an undefined hint (model-side detection)', () => {
    const { engine, configured } = fakeNemotron();
    const pool = new AsrEnginePool({ createNemotron: () => engine });
    pool.acquire(settings({ engine: 'nemotron', language: 'auto' }));
    expect(configured.at(-1)).toEqual({ language: undefined, chunkMs: 'auto' });
  });

  it('keeps the loaded engines when switching between them, so neither reloads', () => {
    const whisper = fakeEngine();
    const { engine: nemotron } = fakeNemotron();
    const createWhisper = vi.fn(() => whisper);
    const createNemotron = vi.fn(() => nemotron);
    const pool = new AsrEnginePool({ createWhisper, createNemotron });

    pool.acquire(settings({ engine: 'whisper' }));
    pool.acquire(settings({ engine: 'nemotron' }));
    expect(pool.acquire(settings({ engine: 'whisper' }))).toBe(whisper);
    expect(pool.acquire(settings({ engine: 'nemotron' }))).toBe(nemotron);

    expect(createWhisper).toHaveBeenCalledOnce();
    expect(createNemotron).toHaveBeenCalledOnce();
    expect(whisper.dispose).not.toHaveBeenCalled();
    expect(nemotron.dispose).not.toHaveBeenCalled();
  });

  it('applies a new language or chunk size to the loaded Nemotron instead of rebuilding it', () => {
    const { engine, configured } = fakeNemotron();
    const createNemotron = vi.fn(() => engine);
    const pool = new AsrEnginePool({ createNemotron });

    pool.acquire(settings({ engine: 'nemotron', language: 'auto', nemotronChunkMs: 'auto' }));
    const again = pool.acquire(
      settings({ engine: 'nemotron', language: 'fr-FR', nemotronChunkMs: '1120' })
    );

    expect(again).toBe(engine);
    expect(createNemotron).toHaveBeenCalledOnce();
    expect(configured.at(-1)).toEqual({ language: 'fr-FR', chunkMs: '1120' });
  });

  it('keeps Whisper loaded when only Nemotron-specific settings changed', () => {
    const createWhisper = vi.fn(() => fakeEngine());
    const pool = new AsrEnginePool({ createWhisper });
    const first = pool.acquire(settings({ engine: 'whisper', language: 'auto' }));
    const second = pool.acquire(
      settings({ engine: 'whisper', language: 'de-DE', nemotronChunkMs: '160' })
    );
    expect(second).toBe(first);
    expect(createWhisper).toHaveBeenCalledOnce();
  });

  it('rebuilds an engine whose worker died rather than reusing it', () => {
    const crashed = fakeEngine();
    const fresh = fakeEngine();
    const createWhisper = vi.fn().mockReturnValueOnce(crashed).mockReturnValueOnce(fresh);
    const pool = new AsrEnginePool({ createWhisper });

    pool.acquire(settings({ engine: 'whisper' }));
    crashed.defunct = true;
    expect(pool.acquire(settings({ engine: 'whisper' }))).toBe(fresh);
  });

  it('disposes every loaded engine on dispose', () => {
    const whisper = fakeEngine();
    const { engine: nemotron } = fakeNemotron();
    const pool = new AsrEnginePool({
      createWhisper: () => whisper,
      createNemotron: () => nemotron
    });
    pool.acquire(settings({ engine: 'whisper' }));
    pool.acquire(settings({ engine: 'nemotron' }));
    pool.dispose();
    expect(whisper.dispose).toHaveBeenCalledOnce();
    expect(nemotron.dispose).toHaveBeenCalledOnce();
  });
});
