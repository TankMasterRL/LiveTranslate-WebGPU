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
