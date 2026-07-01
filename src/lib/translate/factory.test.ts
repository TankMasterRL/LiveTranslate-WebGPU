import { describe, expect, it, vi } from 'vitest';
import { OpenAITranslator } from './api-translator';
import { createTranslator, type TranslationSettings } from './factory';
import type { Translator } from './translator';

const base: TranslationSettings = {
  mode: 'off',
  sourceLang: 'auto',
  targetLang: 'en',
  api: { endpoint: 'https://api.example.com/v1/chat/completions', apiKey: 'sk', model: 'm' }
};

describe('createTranslator', () => {
  it('returns null when translation is off', () => {
    expect(createTranslator(base)).toBeNull();
  });

  it('returns an OpenAITranslator for api mode', () => {
    const translator = createTranslator({ ...base, mode: 'api' });
    expect(translator).toBeInstanceOf(OpenAITranslator);
  });

  it('builds the local translator from the chosen model', () => {
    const local: Translator = { translate: async (t) => t };
    const createLocal = vi.fn().mockReturnValue(local);
    const translator = createTranslator({ ...base, mode: 'local' }, { createLocal });
    expect(translator).toBe(local);
    expect(createLocal).toHaveBeenCalledWith({ ok: true, model: 'Xenova/opus-mt-mul-en' });
  });

  it('throws with the reason when the local language combo is invalid', () => {
    expect(() =>
      createTranslator({ ...base, mode: 'local', targetLang: 'ja' }, { createLocal: vi.fn() })
    ).toThrow(/source/i);
  });
});
