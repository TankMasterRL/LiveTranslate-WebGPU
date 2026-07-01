import { describe, expect, it } from 'vitest';
import { SpeechChunker } from './chunker';

const frame = (n: number, value = 0.5) => new Float32Array(n).fill(value);

// Use a 1kHz sample rate so 1 sample == 1ms for easy reasoning.
const opts = { sampleRate: 1000, minSpeechMs: 100, maxDurationMs: 500 };

describe('SpeechChunker', () => {
  it('ignores silence when not collecting', () => {
    const chunker = new SpeechChunker(opts);
    expect(chunker.push(frame(50), false)).toBeNull();
  });

  it('emits a chunk on the speech -> silence transition', () => {
    const chunker = new SpeechChunker(opts);
    expect(chunker.push(frame(50), true)).toBeNull();
    expect(chunker.push(frame(50), true)).toBeNull();
    expect(chunker.push(frame(50), true)).toBeNull(); // 150 samples collected
    const chunk = chunker.push(frame(50), false);
    expect(chunk).not.toBeNull();
    expect(chunk!.length).toBe(150);
  });

  it('drops chunks shorter than minSpeechMs', () => {
    const chunker = new SpeechChunker(opts);
    chunker.push(frame(50), true); // 50 samples < 100ms minimum
    expect(chunker.push(frame(50), false)).toBeNull();
  });

  it('force-emits when maxDurationMs is exceeded during speech', () => {
    const chunker = new SpeechChunker(opts);
    for (let i = 0; i < 9; i++) expect(chunker.push(frame(50), true)).toBeNull(); // 450
    const chunk = chunker.push(frame(50), true); // 500 -> hits cap
    expect(chunk).not.toBeNull();
    expect(chunk!.length).toBe(500);
  });

  it('flush emits the collected chunk if it meets the minimum', () => {
    const chunker = new SpeechChunker(opts);
    chunker.push(frame(50), true);
    chunker.push(frame(50), true);
    chunker.push(frame(50), true);
    const chunk = chunker.flush();
    expect(chunk!.length).toBe(150);
    expect(chunker.flush()).toBeNull(); // nothing left
  });
});
