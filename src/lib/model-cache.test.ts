import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { cachedFetch } from './model-cache';

const BYTES = new Uint8Array([1, 2, 3, 4]);
const URL = 'https://example.com/model.onnx';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function fakeCaches(prefill?: Record<string, Uint8Array>) {
  const store = new Map<string, Response>(
    Object.entries(prefill ?? {}).map(([k, v]) => [k, new Response(v.slice())])
  );
  const cache = {
    match: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, response: Response) => void store.set(key, response)),
    delete: vi.fn(async (key: string) => store.delete(key))
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

  describe('integrity (sha256)', () => {
    it('verifies a fresh download and caches the verified bytes', async () => {
      const { caches, cache } = fakeCaches();
      const bytes = await cachedFetch(URL, { caches, fetchFn: okFetch(), sha256: sha256(BYTES) });
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
      expect(cache.put).toHaveBeenCalledWith(URL, expect.any(Response));
    });

    it('rejects a download whose bytes do not match, and never caches them', async () => {
      const { caches, cache } = fakeCaches();
      const wrong = sha256(new Uint8Array([9, 9, 9]));
      await expect(cachedFetch(URL, { caches, fetchFn: okFetch(), sha256: wrong })).rejects.toThrow(
        /integrity/i
      );
      expect(cache.put).not.toHaveBeenCalled();
    });

    it('serves a verified cache hit without touching the network', async () => {
      const { caches } = fakeCaches({ [URL]: BYTES });
      const fetchFn = okFetch();
      const bytes = await cachedFetch(URL, { caches, fetchFn, sha256: sha256(BYTES) });
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('drops a cached copy that fails verification and refetches', async () => {
      const corrupt = new Uint8Array([1, 2, 3, 5]);
      const { caches, cache } = fakeCaches({ [URL]: corrupt });
      const fetchFn = okFetch();
      const bytes = await cachedFetch(URL, { caches, fetchFn, sha256: sha256(BYTES) });
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(cache.delete).toHaveBeenCalledWith(URL);
      expect(cache.put).toHaveBeenCalledWith(URL, expect.any(Response));
    });

    it('reports both hashes in the mismatch error so the pin is easy to update', async () => {
      const expected = sha256(new Uint8Array([9, 9, 9]));
      const actual = sha256(BYTES);
      await expect(
        cachedFetch(URL, { caches: null, fetchFn: okFetch(), sha256: expected })
      ).rejects.toThrow(new RegExp(`${expected}.*${actual}`, 's'));
    });
  });

  describe('onProgress', () => {
    it('reports cumulative bytes while downloading', async () => {
      const onProgress = vi.fn();
      const bytes = await cachedFetch(URL, { caches: null, fetchFn: okFetch(), onProgress });
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
      expect(onProgress).toHaveBeenCalled();
      const reported = onProgress.mock.calls.map(([loaded]) => loaded as number);
      // Monotonic and ending at the full byte count.
      expect(reported.at(-1)).toBe(BYTES.length);
      for (let i = 1; i < reported.length; i++) {
        expect(reported[i]).toBeGreaterThanOrEqual(reported[i - 1]);
      }
    });

    it('reports the full size for a cache hit', async () => {
      const { caches } = fakeCaches({ [URL]: BYTES });
      const onProgress = vi.fn();
      await cachedFetch(URL, { caches, fetchFn: okFetch(), onProgress });
      expect(onProgress).toHaveBeenCalledWith(BYTES.length);
    });

    it('still verifies integrity when streaming with onProgress', async () => {
      const wrong = sha256(new Uint8Array([9, 9, 9]));
      await expect(
        cachedFetch(URL, { caches: null, fetchFn: okFetch(), sha256: wrong, onProgress: () => {} })
      ).rejects.toThrow(/integrity/i);
    });

    it('works when the response has no streamable body', async () => {
      const fetchFn = vi.fn(async () => {
        const response = new Response(BYTES.slice());
        Object.defineProperty(response, 'body', { value: null });
        return response;
      });
      const onProgress = vi.fn();
      const bytes = await cachedFetch(URL, { caches: null, fetchFn, onProgress });
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
      expect(onProgress).toHaveBeenCalledWith(BYTES.length);
    });
  });
});
