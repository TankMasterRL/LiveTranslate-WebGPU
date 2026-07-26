import type { AsrEngine } from '../pipeline.svelte';
import { WhisperClient } from './asr-client';
import { NemotronClient, type NemotronClientOptions } from './nemotron-client';
import { DEFAULT_NEMOTRON_CHUNK, type NemotronChunkSetting } from './nemotron/chunk-size';

export type AsrEngineKind = 'whisper' | 'nemotron';

export interface AsrSettings {
  engine: AsrEngineKind;
  /**
   * Spoken-language hint ('auto' = detect). Consumed by Nemotron's prompt
   * conditioning; Whisper always auto-detects.
   */
  language: string;
  /**
   * Nemotron's streaming chunk size in ms, or 'auto' to let the worker follow
   * the utterance backlog. Ignored by Whisper.
   */
  nemotronChunkMs: NemotronChunkSetting;
}

export const DEFAULT_ASR_SETTINGS: AsrSettings = {
  engine: 'whisper',
  language: 'auto',
  nemotronChunkMs: DEFAULT_NEMOTRON_CHUNK
};

const WHISPER_MODEL = 'onnx-community/whisper-base';

export interface AsrFactoryDeps {
  /** Seams so tests can avoid constructing real Web Workers. */
  createWhisper?: () => AsrEngine;
  createNemotron?: (options: NemotronClientOptions) => AsrEngine;
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
      const create = deps.createNemotron ?? ((options) => new NemotronClient(options));
      return create({ language, chunkMs: settings.nemotronChunkMs });
    }
  }
}
