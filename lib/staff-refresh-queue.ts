// One queue for all Today resources; events arriving during a refresh get one
// trailing reconciliation, instead of losing the event or issuing parallel RSCs.
export function createStaffRefreshQueue(options: {
  refresh: () => Promise<void>; active: () => boolean; delay?: number;
}) {
  let disposed = false, running = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (disposed || running || timer || !dirty || !options.active()) return;
    timer = setTimeout(async () => {
      timer = undefined;
      if (disposed || !options.active()) return;
      dirty = false; running = true;
      try { await options.refresh(); } catch { /* Next wake/poll retries. */ }
      finally { running = false; schedule(); }
    }, options.delay ?? 250);
  };
  return {
    request() { dirty = true; schedule(); },
    dispose() { disposed = true; if (timer) clearTimeout(timer); },
  };
}
