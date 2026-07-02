import { describe, expect, it, vi } from 'vitest';
import { cachedFetch } from './model-cache';

const BYTES = new Uint8Array([1, 2, 3, 4]);
const URL = 'https://example.com/model.onnx';

function fakeCaches(prefill?: Record<string, Uint8Array>) {
  const store = new Map<string, Response>(
    Object.entries(prefill ?? {}).map(([k, v]) => [k, new Response(v.slice())])
  );
  const cache = {
    match: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, response: Response) => void store.set(key, response))
  };
  return {
    caches: { open: vi.fn(async () => cache) } as unknown as CacheStorage,
    cache
  };
}

const okFetch = () => vi.fn(async () => new Response(BYTES.slice()));

describe('cachedFetch', () => {
  it('fetches on a cache miss, stores the response, and returns the bytes', async () => {
    const { caches, cache } = fakeCaches();
    const fetchFn = okFetch();
    const bytes = await cachedFetch(URL, { caches, fetchFn });
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledWith(URL, expect.any(Response));
  });

  it('serves a cache hit without touching the network', async () => {
    const { caches } = fakeCaches({ [URL]: BYTES });
    const fetchFn = okFetch();
    const bytes = await cachedFetch(URL, { caches, fetchFn });
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to a plain fetch when Cache Storage is unavailable', async () => {
    const fetchFn = okFetch();
    const bytes = await cachedFetch(URL, { caches: null, fetchFn });
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it('still returns the bytes when storing in the cache fails (quota)', async () => {
    const { caches, cache } = fakeCaches();
    cache.put.mockRejectedValue(new Error('quota exceeded'));
    const bytes = await cachedFetch(URL, { caches, fetchFn: okFetch() });
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it('throws on a non-OK response', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(cachedFetch(URL, { caches: null, fetchFn })).rejects.toThrow(/404/);
  });
});
