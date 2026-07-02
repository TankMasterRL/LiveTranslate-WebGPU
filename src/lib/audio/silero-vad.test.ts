import { describe, expect, it, vi } from 'vitest';
import { SileroVad, type SileroSession } from './silero-vad';

const frame = () => new Float32Array(512);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function sessionOf(probabilities: number[]): SileroSession & { states: Float32Array[] } {
  const states: Float32Array[] = [];
  return {
    states,
    run: vi.fn(async (_frame: Float32Array, state: Float32Array) => {
      states.push(state);
      const next = new Float32Array(256).fill(states.length);
      return { probability: probabilities.shift() ?? 0, state: next };
    })
  };
}

describe('SileroVad', () => {
  it('activates once the model reports speech (one-frame decision lag)', async () => {
    const vad = new SileroVad(sessionOf([0.9, 0.9]), { threshold: 0.5, hangoverFrames: 1 });
    // First call kicks off inference; the decision lands a frame later.
    expect(vad.process(frame())).toBe(false);
    await tick();
    expect(vad.process(frame())).toBe(true);
  });

  it('holds through the hangover window then releases', async () => {
    const vad = new SileroVad(sessionOf([0.9, 0.2, 0.1, 0.1]), {
      threshold: 0.5,
      hangoverFrames: 1
    });
    vad.process(frame()); // 0.9 -> active
    await tick();
    vad.process(frame()); // 0.2 -> hangover keeps it active
    await tick();
    expect(vad.process(frame())).toBe(true); // decision from hangover frame
    await tick();
    await tick();
    expect(vad.process(frame())).toBe(false); // hangover exhausted
  });

  it('threads the model state from one inference into the next', async () => {
    const session = sessionOf([0.1, 0.1, 0.1]);
    const vad = new SileroVad(session, {});
    vad.process(frame());
    await tick();
    vad.process(frame());
    await tick();
    // Second run received the state produced by the first.
    expect(session.states[1][0]).toBe(1);
  });

  it('reset clears activation and model state', async () => {
    const session = sessionOf([0.9, 0.1]);
    const vad = new SileroVad(session, { threshold: 0.5, hangoverFrames: 5 });
    vad.process(frame());
    await tick();
    expect(vad.process(frame())).toBe(true);
    await tick();
    vad.reset();
    expect(vad.process(frame())).toBe(false);
    await tick();
    // The run after reset starts from a zeroed state again.
    expect(session.states[2].every((v) => v === 0)).toBe(true);
  });

  it('deactivates and keeps working when inference fails', async () => {
    let calls = 0;
    const session: SileroSession = {
      run: async (_f, state) => {
        calls++;
        if (calls === 1) throw new Error('ort boom');
        return { probability: 0.9, state };
      }
    };
    const vad = new SileroVad(session, { threshold: 0.5, hangoverFrames: 1 });
    expect(vad.process(frame())).toBe(false); // failing run
    await tick();
    vad.process(frame()); // recovers on the next run
    await tick();
    expect(vad.process(frame())).toBe(true);
  });
});
