export type QueueOutcome<T> = { skipped: false; value: T } | { skipped: true };

interface Entry {
  isStale: () => boolean;
  start: () => void;
  skip: () => void;
}

/**
 * Runs async jobs strictly one at a time, in order, and drops work that has
 * waited too long to still be worth doing.
 *
 * Translation needs both. One model instance can only do one generation's
 * worth of work at a time, so overlapping requests just interleave and all
 * finish late; and when speech outpaces the model the backlog never drains
 * on its own — every new line waits behind all the old ones. A waiting job
 * whose `isStale()` turns true resolves `{ skipped: true }` without running,
 * so the caller can fall back (e.g. show the line untranslated). Staleness is
 * re-checked whenever the queue changes — a job is queued or one finishes —
 * so lines stuck behind a long first job (a model download) are released as
 * soon as newer work arrives. A job that has started always runs to the end.
 */
export class SerialQueue {
  #running = false;
  #waiting: Entry[] = [];

  /** True when nothing is running or waiting: new work starts immediately. */
  get idle(): boolean {
    return !this.#running && this.#waiting.length === 0;
  }

  run<T>(job: () => Promise<T>, isStale: () => boolean = () => false): Promise<QueueOutcome<T>> {
    return new Promise((resolve, reject) => {
      this.#waiting.push({
        isStale,
        skip: () => resolve({ skipped: true }),
        start: () => {
          this.#running = true;
          // Promise.resolve().then() also catches a job that throws synchronously.
          Promise.resolve()
            .then(job)
            .then((value) => resolve({ skipped: false, value }), reject)
            .finally(() => {
              this.#running = false;
              this.#pump();
            });
        }
      });
      this.#pump();
    });
  }

  #pump(): void {
    const stale = this.#waiting.filter((entry) => entry.isStale());
    this.#waiting = this.#waiting.filter((entry) => !stale.includes(entry));
    for (const entry of stale) entry.skip();
    if (!this.#running) this.#waiting.shift()?.start();
  }
}
