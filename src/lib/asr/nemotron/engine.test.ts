import { describe, expect, it } from 'vitest';
import { NEMOTRON } from './model';
import { NemotronEngine, type EncoderStepInput, type NemotronSessions } from './engine';

const { nMels, newFrames, preEncodeCacheFrames, encoderInputFrames, dModel, blankId } = NEMOTRON;

/** Fake extractor: one mel frame per `hop` samples, frame f filled with f+1. */
function fakeExtractor(framesPerCall: (samples: Float32Array) => number) {
  return {
    frames(samples: Float32Array): Float32Array[] {
      const count = framesPerCall(samples);
      return Array.from({ length: count }, (_, f) => new Float32Array(nMels).fill(f + 1));
    }
  };
}

interface FakeOptions {
  /** Encoded frames returned per encoder step. */
  framesPerStep?: number;
  /** Scripted joint emissions per encoded frame (token ids before blank). */
  emissions?: Record<number, number[]>;
  /** When set, the joint always returns this token (never blank). */
  stuckToken?: number;
}

function makeFakes(options: FakeOptions = {}) {
  const framesPerStep = options.framesPerStep ?? 2;
  const encodeCalls: EncoderStepInput[] = [];
  const decodeCalls: number[] = [];
  let frameCursor = 0;
  let jointCallsForFrame = 0;
  let currentFrame = -1;

  const sessions: NemotronSessions = {
    async encode(input) {
      encodeCalls.push({
        ...input,
        mel: input.mel.slice(),
        cache: {
          channel: input.cache.channel.slice(),
          time: input.cache.time.slice(),
          channelLen: input.cache.channelLen
        }
      });
      const frames = new Float32Array(framesPerStep * dModel);
      // Stamp each encoded frame with its global index so tests can see which
      // frame reached the joint.
      for (let t = 0; t < framesPerStep; t++) frames[t * dModel] = frameCursor + t;
      frameCursor += framesPerStep;
      return {
        frames,
        frameCount: framesPerStep,
        cache: {
          channel: input.cache.channel,
          time: input.cache.time,
          channelLen: input.cache.channelLen + 1
        }
      };
    },
    async decode(token, state) {
      decodeCalls.push(token);
      return { output: new Float32Array(NEMOTRON.decoderHidden).fill(token), state };
    },
    async joint(encoderFrame) {
      const logits = new Float32Array(NEMOTRON.vocabSize);
      if (options.stuckToken !== undefined) {
        logits[options.stuckToken] = 1;
        return logits;
      }
      const frame = encoderFrame[0];
      if (frame !== currentFrame) {
        currentFrame = frame;
        jointCallsForFrame = 0;
      }
      const script = options.emissions?.[frame] ?? [];
      const token = jointCallsForFrame < script.length ? script[jointCallsForFrame] : blankId;
      jointCallsForFrame++;
      logits[token] = 1;
      return logits;
    }
  };
  return { sessions, encodeCalls, decodeCalls };
}

// Vocab where token id 1 is "▁hi", 2 is "▁there", 3 is ".".
const VOCAB = ['<unk>', '▁hi', '▁there', '.'];

describe('NemotronEngine', () => {
  it('windows mel frames into cache+new encoder steps with zero left padding', async () => {
    const { sessions, encodeCalls } = makeFakes();
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames * 2)
    );
    await engine.transcribe(new Float32Array(1), undefined);

    expect(encodeCalls).toHaveLength(2);
    const first = encodeCalls[0];
    expect(first.validFrames).toBe(encoderInputFrames);
    // Rows 0..8 are the zero pre-encode cache; row 9 is mel frame 0 (value 1).
    expect(first.mel[0]).toBe(0);
    expect(first.mel[(preEncodeCacheFrames - 1) * nMels]).toBe(0);
    expect(first.mel[preEncodeCacheFrames * nMels]).toBe(1);
    expect(first.mel[(encoderInputFrames - 1) * nMels]).toBe(newFrames);

    // The second step re-reads the last 9 mel frames of the first chunk.
    const second = encodeCalls[1];
    expect(second.mel[0]).toBe(newFrames - preEncodeCacheFrames + 1);
    expect(second.mel[preEncodeCacheFrames * nMels]).toBe(newFrames + 1);
  });

  it('zero-pads and shortens validFrames on the tail step', async () => {
    const tail = 14;
    const { sessions, encodeCalls } = makeFakes();
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames + tail)
    );
    await engine.transcribe(new Float32Array(1), undefined);

    expect(encodeCalls).toHaveLength(2);
    const second = encodeCalls[1];
    expect(second.validFrames).toBe(preEncodeCacheFrames + tail);
    // Rows past the valid region stay zero.
    expect(second.mel[(preEncodeCacheFrames + tail) * nMels]).toBe(0);
  });

  it('threads the encoder cache through successive steps', async () => {
    const { sessions, encodeCalls } = makeFakes();
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames * 3)
    );
    await engine.transcribe(new Float32Array(1), undefined);
    expect(encodeCalls.map((c) => c.cache.channelLen)).toEqual([0, 1, 2]);
  });

  it('passes the resolved language prompt id to every encoder step', async () => {
    const { sessions, encodeCalls } = makeFakes();
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames)
    );
    await engine.transcribe(new Float32Array(1), 'de-DE');
    expect(encodeCalls[0].langId).toBe(9);
  });

  it('primes the decoder with blank, then greedy-decodes tokens per frame', async () => {
    const { sessions, decodeCalls } = makeFakes({
      framesPerStep: 2,
      emissions: [[1], [2, 3]]
    });
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames)
    );
    const result = await engine.transcribe(new Float32Array(1), undefined);

    expect(decodeCalls[0]).toBe(blankId); // priming
    expect(decodeCalls.slice(1)).toEqual([1, 2, 3]);
    expect(result.text).toBe('hi there.');
  });

  it('derives segment times from the emitting frame (80ms per frame)', async () => {
    const { sessions } = makeFakes({ framesPerStep: 7, emissions: { 3: [1], 6: [3] } });
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames)
    );
    const result = await engine.transcribe(new Float32Array(1), undefined);
    expect(result.segments).toHaveLength(1);
    expect(result.segments?.[0].startMs).toBe(3 * NEMOTRON.encodedFrameMs);
    expect(result.segments?.[0].endMs).toBe(7 * NEMOTRON.encodedFrameMs);
  });

  it('caps runaway emissions at maxSymbolsPerStep per frame', async () => {
    const { sessions, decodeCalls } = makeFakes({ framesPerStep: 1, stuckToken: 1 });
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames)
    );
    await engine.transcribe(new Float32Array(1), undefined);
    // 1 priming call + exactly maxSymbolsPerStep emissions for the one frame.
    expect(decodeCalls).toHaveLength(1 + NEMOTRON.maxSymbolsPerStep);
  });

  it('returns empty output without touching the encoder for empty audio', async () => {
    const { sessions, encodeCalls } = makeFakes();
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => 0)
    );
    const result = await engine.transcribe(new Float32Array(0), undefined);
    expect(result).toEqual({ text: '', segments: [] });
    expect(encodeCalls).toHaveLength(0);
  });

  // Empty decodes are invisible to the pipeline (no cue, no error), so the
  // engine must diagnose them itself — see the notice tests below.

  it('flags a flood of emissions that all decode to nothing as corrupted output', async () => {
    // Degenerate (e.g. all-zero) joint logits argmax to token 0 = <unk>: the
    // engine emits maxSymbolsPerStep of them per frame and the tokenizer
    // discards every one, so text is empty despite many emissions.
    const { sessions } = makeFakes({ framesPerStep: 1, stuckToken: 0 });
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames)
    );
    const result = await engine.transcribe(new Float32Array(1), undefined);
    expect(result.text).toBe('');
    expect(result.notice).toMatch(/corrupted/i);
  });

  it('does not flag ordinary silent utterances until they repeat', async () => {
    const { sessions } = makeFakes({ emissions: {} });
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames)
    );
    const first = await engine.transcribe(new Float32Array(1), undefined);
    const second = await engine.transcribe(new Float32Array(1), undefined);
    const third = await engine.transcribe(new Float32Array(1), undefined);
    expect(first.notice).toBeUndefined();
    expect(second.notice).toBeUndefined();
    expect(third.notice).toMatch(/no text/i);
  });

  it('resets the silent-utterance count when a decode produces text', async () => {
    // Frame 0 (first call) emits "hi."; the three calls after that are silent.
    const { sessions } = makeFakes({ framesPerStep: 2, emissions: { 0: [1, 3] } });
    const engine = new NemotronEngine(
      sessions,
      VOCAB,
      fakeExtractor(() => newFrames)
    );
    expect((await engine.transcribe(new Float32Array(1), undefined)).text).toBe('hi.');
    expect((await engine.transcribe(new Float32Array(1), undefined)).notice).toBeUndefined();
    expect((await engine.transcribe(new Float32Array(1), undefined)).notice).toBeUndefined();
    expect((await engine.transcribe(new Float32Array(1), undefined)).notice).toMatch(/no text/i);
  });
});
