import { describe, expect, it, vi } from 'vitest';
import type { AsrEngine } from '../pipeline.svelte';
import { createAsrEngine, DEFAULT_ASR_SETTINGS, type AsrSettings } from './factory';

const fakeEngine = (): AsrEngine => ({
  load: async () => {},
  transcribe: async () => ({ text: '' })
});

const settings = (overrides: Partial<AsrSettings> = {}): AsrSettings => ({
  ...DEFAULT_ASR_SETTINGS,
  ...overrides
});

describe('createAsrEngine', () => {
  it('defaults to the Whisper engine, auto language and an adaptive chunk size', () => {
    expect(DEFAULT_ASR_SETTINGS.engine).toBe('whisper');
    expect(DEFAULT_ASR_SETTINGS.language).toBe('auto');
    expect(DEFAULT_ASR_SETTINGS.nemotronChunkMs).toBe('auto');
  });

  it('builds Whisper via the injected seam', () => {
    const engine = fakeEngine();
    const createWhisper = vi.fn(() => engine);
    const built = createAsrEngine(settings({ engine: 'whisper' }), { createWhisper });
    expect(built).toBe(engine);
    expect(createWhisper).toHaveBeenCalledOnce();
  });

  it('builds Nemotron with the language hint and chunk size', () => {
    const engine = fakeEngine();
    const createNemotron = vi.fn(() => engine);
    const built = createAsrEngine(
      settings({ engine: 'nemotron', language: 'de-DE', nemotronChunkMs: '1120' }),
      { createNemotron }
    );
    expect(built).toBe(engine);
    expect(createNemotron).toHaveBeenCalledWith({ language: 'de-DE', chunkMs: '1120' });
  });

  it('translates auto to an undefined hint (model-side detection)', () => {
    const createNemotron = vi.fn(() => fakeEngine());
    createAsrEngine(settings({ engine: 'nemotron', language: 'auto' }), { createNemotron });
    expect(createNemotron).toHaveBeenCalledWith({ language: undefined, chunkMs: 'auto' });
  });
});
