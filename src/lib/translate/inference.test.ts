import { describe, expect, it } from 'vitest';
import { chooseTranslationRuntime, maxNewTokens } from './inference';

describe('chooseTranslationRuntime', () => {
  it('runs fp16 weights on WebGPU when the adapter supports shader-f16', () => {
    expect(chooseTranslationRuntime({ supported: true, fp16: true })).toEqual({
      backend: 'webgpu',
      dtype: 'fp16'
    });
  });

  it('never runs q8 on WebGPU: without fp16 it falls back to q8 on WASM', () => {
    // q8 exports use MatMulInteger/DynamicQuantizeLinear, which have no
    // WebGPU kernels — every matmul would round-trip through the CPU.
    expect(chooseTranslationRuntime({ supported: true, fp16: false })).toEqual({
      backend: 'wasm',
      dtype: 'q8'
    });
    expect(chooseTranslationRuntime({ supported: true })).toEqual({
      backend: 'wasm',
      dtype: 'q8'
    });
  });

  it('uses q8 on WASM without WebGPU', () => {
    expect(chooseTranslationRuntime({ supported: false, reason: 'no gpu' })).toEqual({
      backend: 'wasm',
      dtype: 'q8'
    });
  });
});

describe('maxNewTokens', () => {
  it('allows about twice the source length plus headroom', () => {
    expect(maxNewTokens(10)).toBe(36);
    expect(maxNewTokens(0)).toBe(16);
  });

  it('never exceeds 256 tokens', () => {
    expect(maxNewTokens(500)).toBe(256);
  });
});
