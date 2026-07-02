/**
 * Tiny localStorage persistence with defensive merging: stored values only
 * override defaults when their type matches, so corrupt/stale entries (or
 * settings shapes from older versions) degrade to defaults instead of breaking
 * the app.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge<T>(defaults: T, stored: unknown): T {
  if (isPlainObject(defaults)) {
    const out = {} as Record<string, unknown>;
    const source = isPlainObject(stored) ? stored : {};
    for (const [key, defaultValue] of Object.entries(defaults)) {
      out[key] = merge(defaultValue, source[key]);
    }
    return out as T;
  }
  if (stored !== undefined && typeof stored === typeof defaults && stored !== null) {
    return stored as T;
  }
  return structuredClone(defaults);
}

function defaultStorage(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

/**
 * Load `key`, merged over `defaults`. Always returns a fresh object (never a
 * reference into `defaults`). Missing key, corrupt JSON, or absent storage all
 * yield the defaults.
 */
export function loadPersisted<T extends object>(
  key: string,
  defaults: T,
  storage: Storage | undefined = defaultStorage()
): T {
  if (!storage) return structuredClone(defaults);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return structuredClone(defaults);
    return merge(defaults, JSON.parse(raw));
  } catch {
    return structuredClone(defaults);
  }
}

/** Persist `value` as JSON; failures (private mode, quota) are swallowed. */
export function savePersisted(
  key: string,
  value: unknown,
  storage: Storage | undefined = defaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience — never let it break the app.
  }
}
