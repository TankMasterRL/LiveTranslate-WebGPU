import { describe, expect, it } from 'vitest';
import { SerialQueue } from './serial-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Let queued continuations (job starts, outcome resolution) run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SerialQueue', () => {
  it('runs jobs one at a time, in order', async () => {
    const queue = new SerialQueue();
    const first = deferred<string>();
    const started: string[] = [];

    const a = queue.run(() => (started.push('a'), first.promise));
    const b = queue.run(async () => (started.push('b'), 'B'));
    await settle();
    expect(started).toEqual(['a']);
    expect(queue.idle).toBe(false);

    first.resolve('A');
    await expect(a).resolves.toEqual({ skipped: false, value: 'A' });
    await expect(b).resolves.toEqual({ skipped: false, value: 'B' });
    expect(started).toEqual(['a', 'b']);
    expect(queue.idle).toBe(true);
  });

  it("rejects a failed job's caller and still runs the next one", async () => {
    const queue = new SerialQueue();
    const failed = queue.run(async () => {
      throw new Error('boom');
    });
    const next = queue.run(async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toEqual({ skipped: false, value: 'ok' });
  });

  it('turns a job that throws synchronously into a rejection', async () => {
    const queue = new SerialQueue();
    const failed = queue.run(() => {
      throw new Error('sync boom');
    });
    await expect(failed).rejects.toThrow('sync boom');
    expect(queue.idle).toBe(true);
  });

  it('skips a waiting job that went stale, without running it', async () => {
    const queue = new SerialQueue();
    const first = deferred<string>();
    let stale = false;
    let ranStale = false;

    const a = queue.run(() => first.promise);
    const b = queue.run(
      async () => ((ranStale = true), 'B'),
      () => stale
    );
    const c = queue.run(async () => 'C');

    stale = true; // b waited too long behind a
    first.resolve('A');

    await expect(a).resolves.toEqual({ skipped: false, value: 'A' });
    await expect(b).resolves.toEqual({ skipped: true });
    await expect(c).resolves.toEqual({ skipped: false, value: 'C' });
    expect(ranStale).toBe(false);
  });

  it('skips stale waiting jobs as soon as new work arrives, even while one is still running', async () => {
    // e.g. the first job is stuck behind a model download: lines queued
    // behind it must not wait out the whole download.
    const queue = new SerialQueue();
    const stuck = deferred<string>();
    let stale = false;

    void queue.run(() => stuck.promise);
    const waiting = queue.run(
      async () => 'late',
      () => stale
    );

    stale = true;
    void queue.run(async () => 'newer');

    await expect(waiting).resolves.toEqual({ skipped: true });
    stuck.resolve('done');
  });

  it('never skips a job that has already started', async () => {
    const queue = new SerialQueue();
    const running = deferred<string>();
    let stale = false;

    const a = queue.run(
      () => running.promise,
      () => stale
    );
    await settle();
    stale = true;
    void queue.run(async () => 'next');
    running.resolve('A');

    await expect(a).resolves.toEqual({ skipped: false, value: 'A' });
  });
});
