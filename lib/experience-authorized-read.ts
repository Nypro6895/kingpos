/** In-flight reads only: no result cache, authority extension or mutation retry. */
export function createExperienceAuthorizedReads<T>() {
  type Pending = { controller: AbortController; result: Promise<T | null>; consumers: Set<symbol>; settled: boolean };
  const pending = new Map<string, Pending>();
  return {
    read(key: string, run: (signal: AbortSignal) => Promise<T | null>, signal?: AbortSignal, joined?: () => void): Promise<T | null> {
      if (signal?.aborted) return Promise.resolve(null);
      let shared = pending.get(key);
      if (shared) joined?.();
      else {
        const controller = new AbortController();
        shared = { controller, consumers: new Set(), settled: false, result: Promise.resolve(null) };
        const owned = shared;
        owned.result = Promise.resolve().then(() => controller.signal.aborted ? null : run(controller.signal)).catch(() => null).finally(() => {
          owned.settled = true;
          if (pending.get(key) === owned) pending.delete(key);
        });
        pending.set(key, owned);
      }
      const owned = shared, consumer = Symbol();
      owned.consumers.add(consumer);
      return new Promise(resolve => {
        let settled = false;
        const finish = (value: T | null) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", cancel);
          owned.controller.signal.removeEventListener("abort", cancelled);
          owned.consumers.delete(consumer);
          resolve(value);
        };
        const cancelled = () => finish(null);
        const cancel = () => {
          finish(null);
          if (!owned.settled && !owned.consumers.size) {
            if (pending.get(key) === owned) pending.delete(key);
            owned.controller.abort();
          }
        };
        signal?.addEventListener("abort", cancel, { once: true });
        owned.controller.signal.addEventListener("abort", cancelled, { once: true });
        owned.result.then(value => finish(signal?.aborted || owned.controller.signal.aborted ? null : value));
      });
    },
    reset() {
      for (const read of pending.values()) read.controller.abort();
      pending.clear();
    },
  };
}
