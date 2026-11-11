/** What a pooled model handle offers the pool. */
export interface PooledModel {
  /** Terminate the model's worker and free its weights. */
  dispose?(): void;
  /**
   * True once the handle can never work again (its worker crashed or was
   * disposed) — the pool then builds a replacement instead of handing it out.
   */
  readonly defunct?: boolean;
}

/**
 * Keeps one loaded instance per model alive for the whole session, so
 * switching between models — and back — reuses the instance already loaded
 * instead of tearing it down. A torn-down model costs a full reload the next
 * time it is picked: its weights come back out of Cache Storage (Nemotron's
 * ~790MB are re-hashed against their pins), its sessions are rebuilt, and
 * a load still in flight when it is torn down loses its partial download.
 * The trade-off is memory: every model used this session stays resident
 * until the pool is disposed.
 *
 * `M` maps each key to the handle type stored under it, so a key always
 * yields the type it was created with.
 */
export class ModelPool<M extends { [K in keyof M]: PooledModel }> {
  readonly #models = new Map<keyof M, M[keyof M]>();

  /** The live instance for `key`, built by `create` on first use or after it died. */
  acquire<K extends keyof M>(key: K, create: () => M[K]): M[K] {
    const existing = this.#models.get(key) as M[K] | undefined;
    if (existing && !existing.defunct) return existing;
    existing?.dispose?.();
    const created = create();
    this.#models.set(key, created);
    return created;
  }

  /** Dispose every pooled model. The pool stays usable and starts empty. */
  dispose(): void {
    for (const model of this.#models.values()) model.dispose?.();
    this.#models.clear();
  }
}
