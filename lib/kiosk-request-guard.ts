// Per-screen request lifecycle. IDs survive transport retries and Back; obsolete
// responses cannot change the current screen. No customer data is persisted.
export function createKioskRequestGuard() {
  let revision = 0;
  let active: { revision: number; key: string; requestId: string } | null = null;
  const ids = new Map<string, string>();
  const completed = new Set<string>();
  return {
    begin(key: string, makeId: () => string) {
      if (active || completed.has(key)) return null;
      const requestId = ids.get(key) ?? makeId();
      ids.set(key, requestId);
      active = { revision, key, requestId };
      return active;
    },
    finish(ticket: { revision: number; key: string; requestId: string }, complete = false) {
      if (active !== ticket || ticket.revision !== revision) return false;
      active = null;
      if (complete) completed.add(ticket.key);
      return true;
    },
    invalidate() { revision++; active = null; },
    reset() { revision++; active = null; ids.clear(); completed.clear(); },
  };
}
