import { describe, expect, it } from 'vitest';
import { loadPersisted, savePersisted } from './persist';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    }
  } as Storage;
}

const defaults = {
  theme: 'classic',
  fontScale: 1,
  api: { endpoint: 'https://default.example', key: '' }
};

describe('loadPersisted', () => {
  it('returns a clone of the defaults when nothing is stored', () => {
    const out = loadPersisted('k', defaults, fakeStorage());
    expect(out).toEqual(defaults);
    out.api.endpoint = 'mutated';
    expect(defaults.api.endpoint).toBe('https://default.example');
  });

  it('returns defaults for corrupt JSON', () => {
    const storage = fakeStorage({ k: '{not json' });
    expect(loadPersisted('k', defaults, storage)).toEqual(defaults);
  });

  it('merges stored values over defaults, keeping defaults for missing fields', () => {
    const storage = fakeStorage({ k: JSON.stringify({ fontScale: 2, api: { key: 'sk' } }) });
    const out = loadPersisted('k', defaults, storage);
    expect(out.fontScale).toBe(2);
    expect(out.api.key).toBe('sk');
    expect(out.theme).toBe('classic');
    expect(out.api.endpoint).toBe('https://default.example');
  });

  it('ignores stored values whose type does not match the default', () => {
    const storage = fakeStorage({ k: JSON.stringify({ fontScale: 'big', api: 'nope' }) });
    const out = loadPersisted('k', defaults, storage);
    expect(out.fontScale).toBe(1);
    expect(out.api).toEqual(defaults.api);
  });

  it('returns defaults when no storage is available', () => {
    expect(loadPersisted('k', defaults, undefined)).toEqual(defaults);
  });
});

describe('savePersisted', () => {
  it('round-trips through loadPersisted', () => {
    const storage = fakeStorage();
    savePersisted('k', { ...defaults, fontScale: 1.5 }, storage);
    expect(loadPersisted('k', defaults, storage).fontScale).toBe(1.5);
  });

  it('swallows storage write failures (private mode / quota)', () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    expect(() => savePersisted('k', defaults, storage)).not.toThrow();
  });
});
