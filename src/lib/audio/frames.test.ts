import { describe, expect, it } from 'vitest';
import { FrameAccumulator } from './frames';

describe('FrameAccumulator', () => {
  it('emits complete fixed-size frames and buffers the remainder', () => {
    const acc = new FrameAccumulator(40);
    const frames = acc.push(new Float32Array(100));
    expect(frames.map((f) => f.length)).toEqual([40, 40]);
  });

  it('completes a buffered frame across multiple pushes', () => {
    const acc = new FrameAccumulator(40);
    expect(acc.push(new Float32Array(20))).toEqual([]);
    const frames = acc.push(new Float32Array(30)); // 20 + 30 = 50 -> one frame, 10 buffered
    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(40);
  });

  it('preserves sample values in order', () => {
    const acc = new FrameAccumulator(2);
    const frames = acc.push(new Float32Array([1, 2, 3, 4]));
    expect(Array.from(frames[0])).toEqual([1, 2]);
    expect(Array.from(frames[1])).toEqual([3, 4]);
  });

  it('reset clears the buffered remainder', () => {
    const acc = new FrameAccumulator(40);
    acc.push(new Float32Array(20));
    acc.reset();
    expect(acc.push(new Float32Array(20))).toEqual([]); // remainder was dropped
  });
});
