const CACHE_NAME = 'livetranslate-models';

export interface CachedFetchDeps {
  /** Cache Storage to use; null disables caching; undefined auto-detects. */
  caches?: CacheStorage | null;
  fetchFn?: typeof fetch;
}

function detectCaches(): CacheStorage | null {
  return typeof globalThis.caches !== 'undefined' ? globalThis.caches : null;
}

/**
 * Fetch model bytes through the Cache Storage API so repeat loads are served
 * locally regardless of HTTP cache heuristics (the moebius-web weights-loading
 * pattern). Falls back to a plain fetch where Cache Storage is unavailable,
 * and a failed cache write (quota, private mode) never fails the load.
 */
export async function cachedFetch(url: string, deps: CachedFetchDeps = {}): Promise<Uint8Array> {
  const fetchFn = deps.fetchFn ?? fetch;
  const caches = deps.caches === undefined ? detectCaches() : deps.caches;

  const cache = caches ? await caches.open(CACHE_NAME) : null;
  const hit = cache ? await cache.match(url) : undefined;
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);

  if (cache) {
    try {
      await cache.put(url, response.clone());
    } catch {
      // Caching is a convenience — never let it break the load.
    }
  }
  return new Uint8Array(await response.arrayBuffer());
}
