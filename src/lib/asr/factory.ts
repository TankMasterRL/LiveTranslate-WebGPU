import { ModelPool } from '../model-pool';
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

/** Nemotron's handle: an engine whose runtime options change without a reload. */
export type NemotronAsrEngine = AsrEngine & Pick<NemotronClient, 'configure'>;

export interface AsrFactoryDeps {
  /** Seams so tests can avoid constructing real Web Workers. */
  createWhisper?: () => AsrEngine;
  createNemotron?: (options: NemotronClientOptions) => NemotronAsrEngine;
}

/**
 * Hands out the ASR engine for the current settings (the translate/factory
 * pattern), keeping one loaded engine per model for the whole session.
 *
 * Only the engine kind picks a model; everything else in AsrSettings is a
 * runtime option. So switching engines — and back — reuses the worker that
 * already holds the weights instead of reloading them, and a new spoken
 * language or chunk size is applied to the loaded Nemotron rather than
 * rebuilding its worker (and re-reading and re-verifying ~790MB) for it.
 * Whisper ignores both, so changing them never touches it.
 */
export class AsrEnginePool {
  readonly #engines = new ModelPool<{ whisper: AsrEngine; nemotron: NemotronAsrEngine }>();
  readonly #deps: AsrFactoryDeps;

  constructor(deps: AsrFactoryDeps = {}) {
    this.#deps = deps;
  }

  acquire(settings: AsrSettings): AsrEngine {
    switch (settings.engine) {
      case 'whisper':
        return this.#engines.acquire('whisper', () =>
          (this.#deps.createWhisper ?? (() => new WhisperClient({ model: WHISPER_MODEL })))()
        );
      case 'nemotron': {
        const options: NemotronClientOptions = {
          language: settings.language === 'auto' ? undefined : settings.language,
          chunkMs: settings.nemotronChunkMs
        };
        const create = this.#deps.createNemotron ?? ((o) => new NemotronClient(o));
        const engine = this.#engines.acquire('nemotron', () => create(options));
        engine.configure(options);
        return engine;
      }
    }
  }

  /** Terminate every engine's worker (page teardown). */
  dispose(): void {
    this.#engines.dispose();
  }
}
