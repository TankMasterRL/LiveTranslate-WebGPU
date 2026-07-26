import {
  NEMOTRON_CHUNK_SIZES,
  NEMOTRON_NATIVE_CHUNK,
  nemotronChunkSize,
  type NemotronChunkSize
} from './model';

/**
 * The streaming chunk size as a *setting*: what the UI select, the persisted
 * preferences and the worker's `load` message carry. 'auto' adapts at runtime
 * (see ChunkSizeController); the rest are operating points in milliseconds.
 *
 * Deliberately a string union rather than `number | 'auto'`: loadPersisted
 * only accepts a stored value whose `typeof` matches the default's, so a
 * mixed-type setting would silently reset itself whenever the user picked the
 * other kind. The spoken-language setting ('auto' | a locale) has the same
 * shape for the same reason.
 */
export const NEMOTRON_CHUNK_SETTINGS = ['auto', '80', '160', '320', '560', '1120'] as const;

export type NemotronChunkSetting = (typeof NEMOTRON_CHUNK_SETTINGS)[number];

export const DEFAULT_NEMOTRON_CHUNK: NemotronChunkSetting = 'auto';

/**
 * Backlog-free utterances required before auto steps back down. Raising is
 * immediate and lowering is slow on purpose: falling behind is what the user
 * notices (cues arrive late, or not at all), so the controller pays for the
 * recovery quickly and gives the headroom back only once it is clearly spare.
 */
export const CLEAN_UTTERANCES_BEFORE_STEP_DOWN = 4;

const NATIVE_INDEX = NEMOTRON_CHUNK_SIZES.indexOf(NEMOTRON_NATIVE_CHUNK);

/**
 * Picks the encoder's streaming chunk size, either from a fixed setting or —
 * in 'auto' — from how far behind the engine is running.
 *
 * The signal is the *backlog*: utterances the pipeline captured while this
 * engine was still busy with an earlier one. Transcriptions are serialized
 * (onnxruntime-web cannot run a session concurrently), so a non-zero backlog
 * means speech is queueing and cues are arriving late — a real-time overrun
 * that sustains itself once it starts. The cheapest runtime lever against it
 * is a bigger chunk: every encoder step re-uploads and reads back the whole
 * streaming cache (~6MB), so doubling the audio per step roughly halves that
 * traffic. Auto never goes *below* the native size, where the cost per second
 * of audio only rises and the model gets less lookahead.
 */
export class ChunkSizeController {
  readonly #auto: boolean;
  #index: number;
  /** Frozen after a size failed at runtime — see pinToNative(). */
  #pinned = false;
  #cleanUtterances = 0;

  constructor(setting: NemotronChunkSetting = DEFAULT_NEMOTRON_CHUNK) {
    this.#auto = setting === 'auto';
    const chunk = this.#auto ? NEMOTRON_NATIVE_CHUNK : nemotronChunkSize(Number(setting));
    this.#index = NEMOTRON_CHUNK_SIZES.indexOf(chunk);
  }

  get current(): NemotronChunkSize {
    return NEMOTRON_CHUNK_SIZES[this.#index];
  }

  /** Record one finished utterance and the queue depth it arrived with. */
  observe(backlog: number): void {
    if (!this.#auto || this.#pinned) return;
    if (backlog > 0) {
      this.#cleanUtterances = 0;
      this.#index = Math.min(this.#index + 1, NEMOTRON_CHUNK_SIZES.length - 1);
      return;
    }
    this.#cleanUtterances++;
    if (this.#cleanUtterances < CLEAN_UTTERANCES_BEFORE_STEP_DOWN) return;
    this.#cleanUtterances = 0;
    this.#index = Math.max(this.#index - 1, NATIVE_INDEX);
  }

  /**
   * The current size failed at runtime: fall back to the one the export ships
   * for, and stop adapting so it is never retried. Returns false when the
   * native size is already in use — there is no safer size to retry, so the
   * caller must treat the failure as real.
   */
  pinToNative(): boolean {
    if (this.#index === NATIVE_INDEX) return false;
    this.#index = NATIVE_INDEX;
    this.#pinned = true;
    return true;
  }
}
