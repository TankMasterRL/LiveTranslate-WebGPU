const CACHE_NAME = 'livetranslate-models';

export interface CachedFetchDeps {
  /** Cache Storage to use; null disables caching; undefined auto-detects. */
  caches?: CacheStorage | null;
  fetchFn?: typeof fetch;
  /**
   * Expected SHA-256 of the bytes (lowercase hex). When set, downloads that
   * don't match throw and are never cached, and a cached copy that no longer
   * matches (corruption, or a pin bumped by a model upgrade) is dropped and
   * refetched.
   */
  sha256?: string;
  /**
   * Called with the cumulative byte count as a download streams in (and once
   * with the full size on a cache hit) — lets callers of large models drive
   * a progress bar. Progress is cosmetic: bytes are still verified and
   * cached whole.
   */
  onProgress?: (loadedBytes: number) => void;
}

function detectCaches(): CacheStorage | null {
  return typeof globalThis.caches !== 'undefined' ? globalThis.caches : null;
}

/** Read a response body, streaming byte counts to `onProgress` when possible. */
async function readBody(
  response: Response,
  onProgress?: (loadedBytes: number) => void
): Promise<Uint8Array<ArrayBuffer>> {
  if (!onProgress || !response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // SubtleCrypto needs a secure context — a given for this app, since audio
  // capture (getDisplayMedia/getUserMedia) already requires one.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SubtleCrypto unavailable: cannot verify model integrity.');
  const digest = await subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch model bytes through the Cache Storage API so repeat loads are served
 * locally regardless of HTTP cache heuristics (the moebius-web weights-loading
 * pattern). Falls back to a plain fetch where Cache Storage is unavailable,
 * and a failed cache write (quota, private mode) never fails the load.
 * Integrity, in contrast, is never best-effort: when `sha256` is given, only
 * bytes that verify are returned or cached.
 */
export async function cachedFetch(url: string, deps: CachedFetchDeps = {}): Promise<Uint8Array> {
  const fetchFn = deps.fetchFn ?? fetch;
  const caches = deps.caches === undefined ? detectCaches() : deps.caches;

  const cache = caches ? await caches.open(CACHE_NAME) : null;
  const hit = cache ? await cache.match(url) : undefined;
  if (hit) {
    const cached = new Uint8Array(await hit.arrayBuffer());
    if (!deps.sha256 || (await sha256Hex(cached)) === deps.sha256) {
      deps.onProgress?.(cached.byteLength);
      return cached;
    }
    try {
      await cache?.delete(url);
    } catch {
      // Eviction is best-effort; the refetch below decides what we return.
    }
  }

  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  const bytes = await readBody(response, deps.onProgress);

  if (deps.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== deps.sha256) {
      throw new Error(
        `Integrity check failed for ${url}: expected sha256 ${deps.sha256}, got ${actual}`
      );
    }
  }

  if (cache) {
    try {
      // The body was consumed to verify it, so cache a rebuilt response.
      await cache.put(url, new Response(bytes));
    } catch {
      // Caching is a convenience — never let it break the load.
    }
  }
  return bytes;
}
