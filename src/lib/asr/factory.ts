import type { AsrEngine } from '../pipeline.svelte';
import { WhisperClient } from './asr-client';
import { NemotronClient } from './nemotron-client';

export type AsrEngineKind = 'whisper' | 'nemotron';

export interface AsrSettings {
  engine: AsrEngineKind;
  /**
   * Spoken-language hint ('auto' = detect). Consumed by Nemotron's prompt
   * conditioning; Whisper always auto-detects.
   */
  language: string;
}

export const DEFAULT_ASR_SETTINGS: AsrSettings = { engine: 'whisper', language: 'auto' };

const WHISPER_MODEL = 'onnx-community/whisper-base';

export interface AsrFactoryDeps {
  /** Seams so tests can avoid constructing real Web Workers. */
  createWhisper?: () => AsrEngine;
  createNemotron?: (language: string | undefined) => AsrEngine;
}

/** Build the ASR engine for the current settings (the translate/factory pattern). */
export function createAsrEngine(settings: AsrSettings, deps: AsrFactoryDeps = {}): AsrEngine {
  switch (settings.engine) {
    case 'whisper': {
      const create = deps.createWhisper ?? (() => new WhisperClient({ model: WHISPER_MODEL }));
      return create();
    }
    case 'nemotron': {
      const language = settings.language === 'auto' ? undefined : settings.language;
      const create = deps.createNemotron ?? ((lang) => new NemotronClient({ language: lang }));
      return create(language);
    }
  }
}
