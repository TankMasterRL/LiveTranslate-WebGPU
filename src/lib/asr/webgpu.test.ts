import { describe, expect, it, vi } from 'vitest';
import { detectWebGPU } from './webgpu';

const navWith = (gpu: unknown) => ({ gpu }) as unknown as Navigator;

describe('detectWebGPU', () => {
  it('reports unsupported when navigator.gpu is missing', async () => {
    const result = await detectWebGPU(navWith(undefined));
    expect(result.supported).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('reports supported when an adapter is returned', async () => {
    const gpu = { requestAdapter: vi.fn().mockResolvedValue({}) };
    const result = await detectWebGPU(navWith(gpu));
    expect(result.supported).toBe(true);
  });

  it('reports unsupported when no adapter is available', async () => {
    const gpu = { requestAdapter: vi.fn().mockResolvedValue(null) };
    const result = await detectWebGPU(navWith(gpu));
    expect(result.supported).toBe(false);
  });

  it('reports unsupported when requesting an adapter throws', async () => {
    const gpu = { requestAdapter: vi.fn().mockRejectedValue(new Error('boom')) };
    const result = await detectWebGPU(navWith(gpu));
    expect(result.supported).toBe(false);
  });
});
