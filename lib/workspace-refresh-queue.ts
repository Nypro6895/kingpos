/** Merge realtime/focus/poll hints before issuing a scoped read. A configuration
 * read includes calendar data, so it supersedes a simultaneous calendar read. */
export function createWorkspaceRefreshQueue(load: (ids?: string[], configuration?: boolean) => Promise<void>, delayMs = 20) {
  type Batch = { ids: Set<string>; full: boolean; configuration: boolean; resolve: () => void; reject: (error: unknown) => void; promise: Promise<void> };
  let queued: Batch | undefined;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => { if (!running && !timer && queued) timer = setTimeout(run, delayMs); };
  const run = async () => {
    timer = undefined;
    const batch = queued;
    if (!batch) return;
    queued = undefined; running = true;
    try { await load(batch.full || batch.configuration ? undefined : [...batch.ids], batch.configuration); batch.resolve(); }
    catch (error) { batch.reject(error); }
    finally { running = false; schedule(); }
  };
  return (ids?: string[], configuration = false) => {
    if (!queued) {
      let resolve!: () => void, reject!: (error: unknown) => void;
      const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
      queued = { ids: new Set(), full: false, configuration: false, resolve, reject, promise };
    }
    if (!ids?.length) queued.full = true;
    else ids.forEach(id => queued!.ids.add(id));
    queued.configuration ||= configuration;
    schedule();
    return queued.promise;
  };
}
