import { describe, expect, it, vi } from 'vitest';
import { ModelPool, type PooledModel } from './model-pool';

class FakeModel implements PooledModel {
  defunct = false;
  disposed = 0;
  constructor(readonly name: string) {}
  dispose(): void {
    this.disposed++;
    this.defunct = true;
  }
}

describe('ModelPool', () => {
  it('builds a model on first use and hands the same one back afterwards', () => {
    const pool = new ModelPool<{ a: FakeModel }>();
    const create = vi.fn(() => new FakeModel('a'));
    const first = pool.acquire('a', create);
    expect(pool.acquire('a', create)).toBe(first);
    expect(create).toHaveBeenCalledOnce();
  });

  it('keeps every model alive while another one is in use', () => {
    // The bug this exists for: switching models disposed the old one, so
    // switching back reloaded (and re-verified) its weights from scratch.
    const pool = new ModelPool<{ a: FakeModel; b: FakeModel }>();
    const a = pool.acquire('a', () => new FakeModel('a'));
    const b = pool.acquire('b', () => new FakeModel('b'));
    expect(pool.acquire('a', () => new FakeModel('a2'))).toBe(a);
    expect(pool.acquire('b', () => new FakeModel('b2'))).toBe(b);
    expect(a.disposed + b.disposed).toBe(0);
  });

  it('replaces a defunct model instead of handing out one that can never work', () => {
    const pool = new ModelPool<{ a: FakeModel }>();
    const crashed = pool.acquire('a', () => new FakeModel('a'));
    crashed.defunct = true;
    const fresh = pool.acquire('a', () => new FakeModel('a2'));
    expect(fresh).not.toBe(crashed);
    expect(fresh.name).toBe('a2');
    expect(crashed.disposed).toBe(1); // terminated, not leaked
  });

  it('disposes every pooled model on dispose, and starts over afterwards', () => {
    const pool = new ModelPool<{ a: FakeModel; b: FakeModel }>();
    const a = pool.acquire('a', () => new FakeModel('a'));
    const b = pool.acquire('b', () => new FakeModel('b'));
    pool.dispose();
    expect([a.disposed, b.disposed]).toEqual([1, 1]);
    expect(pool.acquire('a', () => new FakeModel('a2'))).not.toBe(a);
  });
});
