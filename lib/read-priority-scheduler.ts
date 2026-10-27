/** Read-only work. Commands and durable writes must never enter this scheduler. */
export type ScheduledRead<T> = {
  scope: string;
  key: string;
  route?: string;
  priority: number;
  background?: boolean;
  signal?: AbortSignal;
  run(signal: AbortSignal): Promise<T>;
};
type Consumer = { resolve(value: unknown): void; reject(reason: unknown): void; detach(): void };
type Job = Omit<ScheduledRead<unknown>, "signal"> & {
  id: string; order: number; attempt: number; running: boolean; requeue: boolean;
  controller?: AbortController; consumers: Set<Consumer>;
};
const cancelled = () => new DOMException("Read cancelled", "AbortError");
const routeKey = (path: string) => path.split("#")[0];

/** One shared queue: at most two reads, including at most one speculative read.
 * A foreground request can interrupt a speculative read and reuse its queue
 * position later. Each attempt has its own signal; late replies are discarded.
 */
export function createReadPriorityScheduler(concurrency = 2) {
  const jobs = new Map<string, Job>();
  const limit = Math.max(1, Math.min(4, concurrency));
  let activeScope: string | undefined, activeRoute = "", paused = false, order = 0;
  let scheduled = false;
  const speculative = (job: Job) => job.route && activeRoute
    ? routeKey(job.route) !== activeRoute || Boolean(job.background && job.priority >= 80)
    : Boolean(job.background);
  const rank = (job: Job) => {
    if (!speculative(job) && job.route && activeRoute === routeKey(job.route)) return Math.min(job.priority, 20);
    return speculative(job) ? (job.route && activeRoute === routeKey(job.route) ? 80 : 100) + job.priority : job.priority;
  };
  const valid = (job: Job) => jobs.get(job.id) === job && job.consumers.size > 0;
  const wake = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; pump(); });
  };
  function finish(job: Job, error?: unknown, value?: unknown) {
    if (!valid(job)) return;
    jobs.delete(job.id);
    for (const consumer of job.consumers) { consumer.detach(); if (error !== undefined) consumer.reject(error); else consumer.resolve(value); }
    job.consumers.clear();
    wake();
  }
  function stop(job: Job, retry: boolean) {
    if (!valid(job)) return;
    job.requeue = retry;
    job.controller?.abort();
    if (!retry) finish(job, cancelled());
  }
  function start(job: Job) {
    job.running = true; job.requeue = false;
    const controller = new AbortController(), attempt = ++job.attempt;
    job.controller = controller;
    let abort: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled());
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    // A transport that ignores abort cannot publish through this attempt.
    void Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw cancelled();
      return job.run(controller.signal);
    }), interrupted]).then(value => {
      if (valid(job) && job.attempt === attempt && !controller.signal.aborted) finish(job, undefined, value);
    }, error => {
      if (valid(job) && job.attempt === attempt && !job.requeue) finish(job, error);
    }).finally(() => {
      controller.signal.removeEventListener("abort", abort);
      if (job.attempt !== attempt) return;
      job.running = false; job.controller = undefined;
      wake();
    });
  }
  function pump() {
    const waiting = [...jobs.values()].filter(job => !job.running && (!paused || !speculative(job)))
      .sort((a, b) => rank(a) - rank(b) || a.order - b.order);
    for (const next of waiting) {
      if (!valid(next)) continue;
      let running = [...jobs.values()].filter(job => job.running);
      if (!speculative(next)) {
        const lower = running.filter(job => speculative(job) && rank(job) > rank(next));
        // Interrupt only named reads. The aborted attempt settles before restart.
        for (const job of lower) stop(job, true);
        if (lower.length) return;
      }
      running = [...jobs.values()].filter(job => job.running);
      if (running.length >= limit) return;
      if (speculative(next) && running.some(speculative)) continue;
      start(next);
    }
  }
  return {
    run<T>(input: ScheduledRead<T>): Promise<T> {
      if (input.signal?.aborted || activeScope && input.scope !== activeScope) return Promise.reject(cancelled());
      const id = JSON.stringify([input.scope, input.key]);
      let job = jobs.get(id);
      if (!job) {
        job = { ...input, id, order: order++, attempt: 0, running: false, requeue: false, consumers: new Set() };
        jobs.set(id, job);
      } else {
        job.priority = Math.min(job.priority, input.priority);
        if (!input.background) job.background = false;
        if (input.route && (!input.background || job.background || job.route !== activeRoute)) job.route = input.route;
      }
      const owned = job;
      const promise = new Promise<T>((resolve, reject) => {
        const abort = () => {
          consumer.detach(); owned.consumers.delete(consumer); reject(cancelled());
          if (!owned.consumers.size) { owned.controller?.abort(); jobs.delete(id); wake(); }
        };
        const consumer: Consumer = { resolve: value => resolve(value as T), reject,
          detach: () => input.signal?.removeEventListener("abort", abort) };
        owned.consumers.add(consumer);
        input.signal?.addEventListener("abort", abort, { once: true });
      });
      wake();
      return promise;
    },
    setActiveScope(scope?: string) {
      if (activeScope === scope) return;
      activeScope = scope;
      for (const job of jobs.values()) if (!scope || job.scope !== scope) stop(job, false);
      wake();
    },
    setActiveRoute(path: string) { activeRoute = routeKey(path); wake(); },
    promote(scope: string, key: string, route?: string, priority = 0) {
      const job = jobs.get(JSON.stringify([scope, key]));
      if (!job) return;
      job.background = false; job.priority = Math.min(job.priority, priority);
      if (route) job.route = route;
      wake();
    },
    setPaused(value: boolean) {
      paused = value;
      if (paused) for (const job of jobs.values()) if (job.running && speculative(job)) stop(job, true);
      wake();
    },
    cancelScope(scope?: string) { for (const job of jobs.values()) if (!scope || job.scope === scope) stop(job, false); },
    snapshot() { return [...jobs.values()].map(job => ({ scope: job.scope, key: job.key, running: job.running, background: speculative(job), priority: rank(job) })); },
  };
}

export const readPriorityScheduler = createReadPriorityScheduler();
