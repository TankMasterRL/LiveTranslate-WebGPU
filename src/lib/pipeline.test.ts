import { describe, expect, it, vi } from 'vitest';
import { SubtitleTrack } from './subtitles/track.svelte';
import { TranscriptionPipeline, transcribeChunkToCue, type PipelineDeps } from './pipeline.svelte';

describe('transcribeChunkToCue', () => {
  it('cleans the transcript and builds a cue with timing', async () => {
    const cue = await transcribeChunkToCue(new Float32Array(10), { startMs: 1000, endMs: 5000 }, {
      transcribe: async () => '<|0.00|> hola mundo'
    });
    expect(cue).not.toBeNull();
    expect(cue!.text).toBe('hola mundo');
    expect(cue!.startMs).toBe(1000);
    expect(cue!.endMs).toBe(5000);
  });

  it('applies the translator when provided', async () => {
    const cue = await transcribeChunkToCue(new Float32Array(10), { startMs: 0, endMs: 1 }, {
      transcribe: async () => 'hola',
      translate: async (t) => `EN:${t}`
    });
    expect(cue!.translation).toBe('EN:hola');
  });

  it('returns null for a blank transcript', async () => {
    const cue = await transcribeChunkToCue(new Float32Array(10), { startMs: 0, endMs: 1 }, {
      transcribe: async () => '<|endoftext|>'
    });
    expect(cue).toBeNull();
  });
});

// A fake AudioCapture whose onFrame callback the test can drive directly.
function makeFakeCapture() {
  let onFrame: (f: Float32Array) => void = () => {};
  return {
    factory: (cb: (f: Float32Array) => void) => {
      onFrame = cb;
      return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    },
    frame: (f: Float32Array) => onFrame(f)
  };
}

describe('TranscriptionPipeline', () => {
  it('captures voiced audio and commits a transcribed, translated cue', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    let clock = 10_000;

    const deps: PipelineDeps = {
      track,
      nowMs: () => clock,
      displayMs: 4000,
      vadOptions: { threshold: 0.1, hangoverFrames: 1 },
      chunkerOptions: { sampleRate: 16_000, minSpeechMs: 100 },
      detect: async () => ({ supported: true }),
      requestStream: async () => ({}) as MediaStream,
      createCapture: capture.factory,
      asr: { load: vi.fn().mockResolvedValue(undefined), transcribe: async () => 'hola' },
      translator: { translate: async (t) => `EN:${t}` }
    };

    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');
    expect(pipeline.status).toBe('listening');
    expect(pipeline.backend).toBe('webgpu');

    const loud = new Float32Array(3000).fill(0.5);
    const quiet = new Float32Array(100);
    capture.frame(loud); // voiced, collecting
    capture.frame(quiet); // hangover keeps it active
    capture.frame(quiet); // hangover exhausted -> emit chunk

    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(track.cues[0].text).toBe('hola');
    expect(track.cues[0].translation).toBe('EN:hola');
    expect(track.cues[0].startMs).toBe(10_000);
    expect(track.cues[0].endMs).toBe(14_000);
  });

  it('falls back to the wasm backend when WebGPU is unavailable', async () => {
    const deps: PipelineDeps = {
      track: new SubtitleTrack(),
      nowMs: () => 0,
      detect: async () => ({ supported: false, reason: 'no gpu' }),
      requestStream: async () => ({}) as MediaStream,
      createCapture: makeFakeCapture().factory,
      asr: { load: vi.fn().mockResolvedValue(undefined), transcribe: async () => '' }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');
    expect(pipeline.backend).toBe('wasm');
  });

  it('swaps the translator at runtime without restarting capture', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const deps: PipelineDeps = {
      track,
      nowMs: () => 0,
      vadOptions: { threshold: 0.1, hangoverFrames: 1 },
      chunkerOptions: { sampleRate: 16_000, minSpeechMs: 100 },
      detect: async () => ({ supported: true }),
      requestStream: async () => ({}) as MediaStream,
      createCapture: capture.factory,
      asr: { load: vi.fn().mockResolvedValue(undefined), transcribe: async () => 'hola' }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    const loud = new Float32Array(3000).fill(0.5);
    const quiet = new Float32Array(100);
    const utterance = () => {
      capture.frame(loud);
      capture.frame(quiet); // hangover keeps it active
      capture.frame(quiet); // hangover exhausted -> emit chunk
    };

    // No translator configured -> raw transcription.
    utterance();
    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(track.cues[0].translation).toBeUndefined();

    pipeline.setTranslator({ translate: async (t) => `EN:${t}` });
    utterance();
    await vi.waitFor(() => expect(track.cues.length).toBe(2));
    expect(track.cues[1].translation).toBe('EN:hola');

    pipeline.setTranslator(null);
    utterance();
    await vi.waitFor(() => expect(track.cues.length).toBe(3));
    expect(track.cues[2].translation).toBeUndefined();
  });

  it('commits the untranslated cue and surfaces the error when translation fails', async () => {
    const track = new SubtitleTrack();
    const capture = makeFakeCapture();
    const deps: PipelineDeps = {
      track,
      nowMs: () => 0,
      vadOptions: { threshold: 0.1, hangoverFrames: 1 },
      chunkerOptions: { sampleRate: 16_000, minSpeechMs: 100 },
      detect: async () => ({ supported: true }),
      requestStream: async () => ({}) as MediaStream,
      createCapture: capture.factory,
      asr: { load: vi.fn().mockResolvedValue(undefined), transcribe: async () => 'hola' },
      translator: {
        translate: async () => {
          throw new Error('translate boom');
        }
      }
    };
    const pipeline = new TranscriptionPipeline(deps);
    await pipeline.start('microphone');

    capture.frame(new Float32Array(3000).fill(0.5));
    capture.frame(new Float32Array(100));
    capture.frame(new Float32Array(100));

    // Transcription must survive a translation failure.
    await vi.waitFor(() => expect(track.cues.length).toBe(1));
    expect(track.cues[0].text).toBe('hola');
    expect(track.cues[0].translation).toBeUndefined();
    expect(pipeline.error).toContain('translate boom');
  });
});
