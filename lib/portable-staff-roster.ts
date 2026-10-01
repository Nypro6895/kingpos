// Refresh staff values without moving their touch targets. Full snapshots may
// remove staff; partial snapshots only replace/remove the requested identities.
export function mergeStaffRoster<T extends { id: string }>(
  current: T[], fresh: T[], ids?: string[],
): T[] {
  const updates = new Map(fresh.map(row => [row.id, row]));
  const targets = ids?.length ? new Set(ids) : null;
  const result: T[] = [];
  for (const row of current) {
    const next = updates.get(row.id);
    if (next) { result.push(next); updates.delete(row.id); }
    else if (targets && !targets.has(row.id)) result.push(row);
  }
  return [...result, ...updates.values()];
}
