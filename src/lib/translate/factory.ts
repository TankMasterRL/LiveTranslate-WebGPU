import { OpenAITranslator } from './api-translator';
import { chooseLocalModel, languageName, type LocalModelChoice } from './lang';
import type { Translator } from './translator';

export type TranslationMode = 'off' | 'local' | 'api';

export interface TranslationSettings {
  mode: TranslationMode;
  /** ISO code or 'auto' (auto is only valid for the fast →English model). */
  sourceLang: string;
  /** ISO code of the language to translate into. */
  targetLang: string;
  api: {
    endpoint: string;
    apiKey: string;
    model: string;
  };
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  mode: 'off',
  sourceLang: 'auto',
  targetLang: 'en',
  api: { endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: '', model: 'gpt-4o-mini' }
};

export interface TranslatorFactoryDeps {
  /** Builds the local WebGPU translator (injected so tests avoid the Worker). */
  createLocal?: (choice: Extract<LocalModelChoice, { ok: true }>) => Translator;
}

/**
 * Build the Translator for the current settings, or null when translation is
 * off. Throws with a human-readable reason for invalid local language combos
 * so the panel can surface it.
 */
export function createTranslator(
  settings: TranslationSettings,
  deps: TranslatorFactoryDeps = {}
): Translator | null {
  switch (settings.mode) {
    case 'off':
      return null;

    case 'api':
      return new OpenAITranslator({
        endpoint: settings.api.endpoint,
        apiKey: settings.api.apiKey,
        model: settings.api.model,
        targetLang: languageName(settings.targetLang),
        sourceLang: settings.sourceLang === 'auto' ? undefined : languageName(settings.sourceLang)
      });

    case 'local': {
      const choice = chooseLocalModel(settings.sourceLang, settings.targetLang);
      if (!choice.ok) throw new Error(choice.reason);
      if (!deps.createLocal) throw new Error('createLocal dependency is required for local mode');
      return deps.createLocal(choice);
    }
  }
}
