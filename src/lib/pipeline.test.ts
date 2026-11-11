import { describe, expect, it, vi } from 'vitest';
import type { AsrResult } from './asr/transcript';
import { SubtitleTrack } from './subtitles/track.svelte';
import { TranscriptionPipeline, type PipelineDeps } from './pipeline.svelte';

// A fake AudioCapture whose onFrame callback the test can drive directly.
function makeFakeCapture() {
  let onFrame: (f: Float32Array) => void = () => {};
  return {
    factory: (cb: (f: Float32Array) => void) => {
      onFrame = cb;
      return {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined)
      };
    },
    frame: (f: Float32Array) => onFrame(f)
  };
}

const asrOf = (fn: () => AsrResult) => ({
  load: vi.fn().mockResolvedValue(undefined),
  transcribe: async () => fn()
});

function baseDeps(track: SubtitleTrack, capture: ReturnType<typeof makeFakeCapture>) {
  return {
    track,
    nowMs: () => 0,
    vadOptions: { threshold: 0.1, hangoverFrames: 1 },
    chunkerOptions: { sampleRate: 16_000, minSpeechMs: 100 },
    detect: async () => ({ supported: true }),
    requestStream: async () => ({}) as MediaStream,
    createCapture: capture.factory
  };
}

// Let queued continuations (ASR results, queue hand-offs) run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// loud(3000) + quiet(100, hangover) form a 3100-sample chunk = 194ms @16k.
const CHUNK_MS = Math.round((3100 / 16_000) * 1000);

function utterance(capture: ReturnType<typeof makeFakeCapture>) {
  capture.frame(new Float32Array(3000).fill(0.5));
  capture.frame(new Float32Array(100)); // hangover keeps it active
  capture.frame(new Float32Array(100)); // hangover exhausted -> emit chunk
}

describe('TranscriptionPipeline', () => {
  it('captures voiced audio and commits a transcribed, translated cue backdated to the utterance start', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const clock = 10_000;

    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      nowMs: () => clock,
      displayMs: 4000,
      asr: asrOf(() => ({ text: 'hola' })),
      translator: { translate: async (t) => `EN:${t}` }
    };

    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');
    expect(pipeline.status).toBe('listening');
    expect(pipeline.backend).toBe('webgpu');

    utterance(capture);

    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(track.cues[0].text).toBe('hola');
    expect(track.cues[0].translation).toBe('EN:hola');
    // The cue starts when the speech started, not when the chunk was emitted.
    expect(track.cues[0].startMs).toBe(clock - CHUNK_MS);
    expect(track.cues[0].endMs).toBe(clock + 4000);
  });

  it('falls back to the wasm backend when WebGPU is unavailable', async () => {
    const capture = makeFakeCapture();
    const deps: PipelineDeps = {
      ...baseDeps(new SubtitleTrack(), capture),
      detect: async () => ({ supported: false, reason: 'no gpu' }),
      asr: asrOf(() => ({ text: '' }))
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');
    expect(pipeline.backend).toBe('wasm');
  });

  it('splits a multi-segment result into true-timed cues, extending the last for display', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const clock = 10_000;

    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      nowMs: () => clock,
      asr: asrOf(() => ({
        text: ' one two',
        segments: [
          { text: ' one', startMs: 0, endMs: 100 },
          { text: ' two', startMs: 100, endMs: null }
        ]
      }))
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture);

    await vi.waitFor(() => expect(track.cues.length).toBe(2));
    const start = clock - CHUNK_MS;
    expect(track.cues[0]).toMatchObject({ text: 'one', startMs: start, endMs: start + 100 });
    // Last cue keeps its true start but stays on screen for reading time.
    expect(track.cues[1].startMs).toBe(start + 100);
    expect(track.cues[1].endMs).toBe(clock + 1800);
  });

  it('measures the reading window from when the cue is committed, so slow translation cannot expire it', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    let clock = 10_000;
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      nowMs: () => clock,
      asr: asrOf(() => ({ text: 'hola' })),
      translator: {
        translate: async (t) => {
          clock += 5_000; // translation outlasts the 1.8s minimum reading time
          return `EN:${t}`;
        }
      }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture);

    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    // Still starts when it was spoken...
    expect(track.cues[0].startMs).toBe(10_000 - CHUNK_MS);
    // ...but is readable for its full reading time once it finally appears,
    // instead of being committed already expired.
    expect(track.cues[0].endMs).toBe(15_000 + 1800);
    expect(track.activeAt(15_000)).toBe(track.cues[0]);
  });

  it('applies a fixed displayMs from commit time too, covering ASR latency', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    let clock = 10_000;
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      nowMs: () => clock,
      displayMs: 4000,
      asr: {
        load: vi.fn().mockResolvedValue(undefined),
        transcribe: async () => {
          clock += 3_000;
          return { text: 'hola' };
        }
      }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture);

    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(track.cues[0].startMs).toBe(10_000 - CHUNK_MS);
    expect(track.cues[0].endMs).toBe(13_000 + 4000);
  });

  it('swaps the translator at runtime without restarting capture', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      asr: asrOf(() => ({ text: 'hola' }))
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    // No translator configured -> raw transcription.
    utterance(capture);
    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(track.cues[0].translation).toBeUndefined();

    pipeline.setTranslator({ translate: async (t) => `EN:${t}` });
    utterance(capture);
    await vi.waitFor(() => expect(track.cues.length).toBe(2));
    expect(track.cues[1].translation).toBe('EN:hola');

    pipeline.setTranslator(null);
    utterance(capture);
    await vi.waitFor(() => expect(track.cues.length).toBe(3));
    expect(track.cues[2].translation).toBeUndefined();
  });

  it('adapts cue duration to text length when no fixed displayMs is set', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    let response = 'hi';
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      asr: asrOf(() => ({ text: response }))
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture); // short text -> clamped to the minimum display time
    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(track.cues[0].startMs).toBe(-CHUNK_MS);
    expect(track.cues[0].endMs).toBe(1800);

    response = 'a'.repeat(500);
    utterance(capture); // long text -> clamped to the maximum
    await vi.waitFor(() => expect(track.cues.length).toBe(2));
    expect(track.cues[1].endMs).toBe(7000);
  });

  it('uses an injected VAD engine and can swap it at runtime', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const script = [true, true, false];
    const vad1 = { process: vi.fn(() => script.shift() ?? false), reset: vi.fn() };
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      vad: vad1,
      asr: asrOf(() => ({ text: 'hola' }))
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture);
    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(vad1.process).toHaveBeenCalledTimes(3);

    // A swapped-in VAD that never detects speech means no further cues.
    const vad2 = { process: vi.fn(() => false), reset: vi.fn() };
    pipeline.setVad(vad2);
    utterance(capture);
    expect(vad2.process).toHaveBeenCalledTimes(3);
    expect(track.cues.length).toBe(1);
  });

  it('surfaces an ASR diagnostic notice and clears it when recognition recovers', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const responses: AsrResult[] = [
      { text: '', notice: 'nemotron decoded nothing' },
      { text: 'hola' }
    ];
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      asr: asrOf(() => responses.shift() ?? { text: 'hola' })
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    // An empty decode commits no cue but must surface its diagnostic.
    utterance(capture);
    await vi.waitFor(() => expect(pipeline.notice).toBe('nemotron decoded nothing'));
    expect(track.cues.length).toBe(0);
    expect(pipeline.error).toBeNull();

    // The next successful utterance clears the stale diagnostic.
    utterance(capture);
    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(pipeline.notice).toBeNull();
  });

  it('translates a multi-segment utterance once, as a single cue', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const clock = 10_000;
    const translate = vi.fn(async (t: string) => `EN:${t}`);
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      nowMs: () => clock,
      asr: asrOf(() => ({
        text: ' fui a la tienda y compré leche',
        segments: [
          { text: ' fui a la tienda', startMs: 0, endMs: 100 },
          { text: ' y compré leche', startMs: 100, endMs: null }
        ]
      })),
      translator: { translate }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture);

    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    // Fragments translate incoherently; the model gets the whole sentence.
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith('fui a la tienda y compré leche');
    expect(track.cues[0]).toMatchObject({
      text: 'fui a la tienda y compré leche',
      translation: 'EN:fui a la tienda y compré leche',
      startMs: clock - CHUNK_MS
    });
  });

  it('runs one translation at a time across overlapping utterances', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const pending: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      asr: asrOf(() => ({ text: 'hola' })),
      translator: {
        translate: (t) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          return new Promise((resolve) =>
            pending.push(() => {
              inFlight--;
              resolve(`EN:${t}`);
            })
          );
        }
      }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture);
    utterance(capture);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await settle();
    expect(pending).toHaveLength(1); // the second waits for the first

    pending.shift()!();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()!();

    await vi.waitFor(() => expect(track.cues.length).toBe(2));
    expect(maxInFlight).toBe(1);
    expect(track.cues.map((c) => c.translation)).toEqual(['EN:hola', 'EN:hola']);
  });

  it('commits a line untranslated, with a notice, once it has waited too long for the translator', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    let clock = 10_000;
    let release: (() => void) | null = null;
    const translate = vi.fn(
      (t: string) =>
        new Promise<string>((resolve) => {
          release = () => resolve(`EN:${t}`);
        })
    );
    let response = 'uno';
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      nowMs: () => clock,
      maxTranslationWaitMs: 2000,
      asr: asrOf(() => ({ text: response })),
      translator: { translate }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture); // 'uno' starts translating and gets stuck
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    response = 'dos';
    utterance(capture); // 'dos' queues behind it
    await settle();

    clock += 2500; // 'dos' has now waited longer than allowed
    release!();

    await vi.waitFor(() => expect(track.cues.length).toBe(2));
    expect(track.cues[0]).toMatchObject({ text: 'uno', translation: 'EN:uno' });
    // Skipped rather than translated late: shown as transcribed, never lost.
    expect(track.cues[1].text).toBe('dos');
    expect(track.cues[1].translation).toBeUndefined();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(pipeline.notice).toMatch(/falling behind/i);
    expect(pipeline.error).toBeNull();

    // Once a line reaches an idle translator again, it is keeping up.
    response = 'tres';
    utterance(capture);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    release!();
    await vi.waitFor(() => expect(track.cues.length).toBe(3));
    expect(track.cues[2].translation).toBe('EN:tres');
    expect(pipeline.notice).toBeNull();
  });

  it('commits a queued line untranslated when translation is turned off meanwhile', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    let release: (() => void) | null = null;
    const translate = vi.fn(
      (t: string) =>
        new Promise<string>((resolve) => {
          release = () => resolve(`EN:${t}`);
        })
    );
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      asr: asrOf(() => ({ text: 'hola' })),
      translator: { translate }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    utterance(capture);
    await settle();

    pipeline.setTranslator(null);
    release!();

    await vi.waitFor(() => expect(track.cues.length).toBe(2));
    expect(track.cues[0].translation).toBe('EN:hola');
    expect(track.cues[1].translation).toBeUndefined();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(pipeline.error).toBeNull();
  });

  it('commits the untranslated cue and surfaces the error when translation fails', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const deps: PipelineDeps = {
      ...baseDeps(track, capture),
      asr: asrOf(() => ({ text: 'hola' })),
      translator: {
        translate: async () => {
          throw new Error('translate boom');
        }
      }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    utterance(capture);

    // Transcription must survive a translation failure.
    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(track.cues[0].text).toBe('hola');
    expect(track.cues[0].translation).toBeUndefined();
    expect(pipeline.error).toContain('translate boom');
  });
});
