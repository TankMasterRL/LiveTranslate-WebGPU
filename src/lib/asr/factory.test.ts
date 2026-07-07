import { describe, expect, it, vi } from 'vitest';
import type { AsrEngine } from '../pipeline.svelte';
import { createAsrEngine, DEFAULT_ASR_SETTINGS } from './factory';

const fakeEngine = (): AsrEngine => ({
  load: async () => {},
  transcribe: async () => ({ text: '' })
});

describe('createAsrEngine', () => {
  it('defaults to the Whisper engine', () => {
    expect(DEFAULT_ASR_SETTINGS.engine).toBe('whisper');
    expect(DEFAULT_ASR_SETTINGS.language).toBe('auto');
  });

  it('builds Whisper via the injected seam', () => {
    const engine = fakeEngine();
    const createWhisper = vi.fn(() => engine);
    const built = createAsrEngine({ engine: 'whisper', language: 'auto' }, { createWhisper });
    expect(built).toBe(engine);
    expect(createWhisper).toHaveBeenCalledOnce();
  });

  it('builds Nemotron with the language hint', () => {
    const engine = fakeEngine();
    const createNemotron = vi.fn(() => engine);
    const built = createAsrEngine({ engine: 'nemotron', language: 'de-DE' }, { createNemotron });
    expect(built).toBe(engine);
    expect(createNemotron).toHaveBeenCalledWith('de-DE');
  });

  it('translates auto to an undefined hint (model-side detection)', () => {
    const createNemotron = vi.fn(() => fakeEngine());
    createAsrEngine({ engine: 'nemotron', language: 'auto' }, { createNemotron });
    expect(createNemotron).toHaveBeenCalledWith(undefined);
  });
});
