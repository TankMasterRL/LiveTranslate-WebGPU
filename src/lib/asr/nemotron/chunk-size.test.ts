import { describe, expect, it } from 'vitest';
import {
  ChunkSizeController,
  CLEAN_UTTERANCES_BEFORE_STEP_DOWN,
  DEFAULT_NEMOTRON_CHUNK,
  NEMOTRON_CHUNK_SETTINGS
} from './chunk-size';
import { NEMOTRON_CHUNK_SIZES, NEMOTRON_NATIVE_CHUNK } from './model';

const LARGEST = NEMOTRON_CHUNK_SIZES[NEMOTRON_CHUNK_SIZES.length - 1];

/** Report `count` utterances that arrived with an empty queue behind them. */
function idle(controller: ChunkSizeController, count: number): void {
  for (let i = 0; i < count; i++) controller.observe(0);
}

describe('NEMOTRON_CHUNK_SETTINGS', () => {
  it('offers auto plus every operating point the model supports', () => {
    expect(NEMOTRON_CHUNK_SETTINGS).toEqual([
      'auto',
      ...NEMOTRON_CHUNK_SIZES.map((chunk) => String(chunk.ms))
    ]);
  });

  it('defaults to auto', () => {
    expect(DEFAULT_NEMOTRON_CHUNK).toBe('auto');
    expect(NEMOTRON_CHUNK_SETTINGS).toContain(DEFAULT_NEMOTRON_CHUNK);
  });
});

describe('ChunkSizeController', () => {
  it('holds a fixed size regardless of the backlog', () => {
    const controller = new ChunkSizeController('160');
    expect(controller.current.ms).toBe(160);
    controller.observe(4);
    controller.observe(4);
    expect(controller.current.ms).toBe(160);
  });

  it('falls back to the native size for an unrecognized setting', () => {
    // Persisted settings from an older build (or a hand-edited localStorage
    // entry) must never leave the engine without a usable chunk size.
    const controller = new ChunkSizeController('42' as never);
    expect(controller.current).toEqual(NEMOTRON_NATIVE_CHUNK);
  });

  it('starts auto at the size the export is tuned for', () => {
    expect(new ChunkSizeController('auto').current).toEqual(NEMOTRON_NATIVE_CHUNK);
  });

  it('steps up as soon as utterances queue up behind the engine', () => {
    // A backlog is the pipeline saying it captured speech the engine had no
    // slot for: consume more audio per step so fewer steps run per second.
    const controller = new ChunkSizeController('auto');
    controller.observe(1);
    expect(controller.current.ms).toBeGreaterThan(NEMOTRON_NATIVE_CHUNK.ms);
  });

  it('stops stepping up at the largest supported chunk', () => {
    const controller = new ChunkSizeController('auto');
    for (let i = 0; i < 10; i++) controller.observe(3);
    expect(controller.current).toEqual(LARGEST);
  });

  it('never drops below the native size, however idle the engine is', () => {
    // Below native there is nothing to win: smaller chunks run *more* steps
    // per second of audio and give the model less lookahead.
    const controller = new ChunkSizeController('auto');
    idle(controller, CLEAN_UTTERANCES_BEFORE_STEP_DOWN * 4);
    expect(controller.current).toEqual(NEMOTRON_NATIVE_CHUNK);
  });

  it('steps back down only after a sustained backlog-free stretch', () => {
    const controller = new ChunkSizeController('auto');
    controller.observe(1);
    const raised = controller.current.ms;

    idle(controller, CLEAN_UTTERANCES_BEFORE_STEP_DOWN - 1);
    expect(controller.current.ms).toBe(raised);

    controller.observe(0);
    expect(controller.current.ms).toBeLessThan(raised);
  });

  it('restarts the backlog-free count when the engine falls behind again', () => {
    const controller = new ChunkSizeController('auto');
    controller.observe(1);
    const raised = controller.current.ms;

    idle(controller, CLEAN_UTTERANCES_BEFORE_STEP_DOWN - 1);
    controller.observe(2);
    idle(controller, CLEAN_UTTERANCES_BEFORE_STEP_DOWN - 1);
    expect(controller.current.ms).toBe(raised);
  });

  it('pins to the native size when the current one fails, and stops adapting', () => {
    const controller = new ChunkSizeController('auto');
    controller.observe(1);
    expect(controller.current.ms).not.toBe(NEMOTRON_NATIVE_CHUNK.ms);

    expect(controller.pinToNative()).toBe(true);
    expect(controller.current).toEqual(NEMOTRON_NATIVE_CHUNK);

    // Adaptation is over: a size that failed once must not be tried again.
    controller.observe(5);
    expect(controller.current).toEqual(NEMOTRON_NATIVE_CHUNK);
  });

  it('reports that there is nowhere to fall back to when already native', () => {
    expect(new ChunkSizeController('auto').pinToNative()).toBe(false);
    expect(new ChunkSizeController('560').pinToNative()).toBe(false);
  });

  it('pins a failing fixed size to native too', () => {
    const controller = new ChunkSizeController('1120');
    expect(controller.pinToNative()).toBe(true);
    expect(controller.current).toEqual(NEMOTRON_NATIVE_CHUNK);
  });
});
