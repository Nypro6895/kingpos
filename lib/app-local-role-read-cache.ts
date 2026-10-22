import type { AppLocalRead } from "./app-local-host";

export type AppLocalRoleReadAuthority = {
  viewerId: string; generation: string; salonId: string; workspaceId: string;
  scope: string; permissionRevision: string; grantRevision: string; proof: string;
};
export type AppLocalRoleRead = { name: string; args: Record<string, unknown>; snapshot: AppLocalRead };
type Entry = { authority: AppLocalRoleReadAuthority; row: AppLocalRoleRead; bytes: number; expiresAt: number };
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
}

/** Quarantined DTOs only. Neither a stored row nor this object admits a page.
 * Callers restore only after the destination's fresh online admission succeeds. */
export function createAppLocalRoleReadCache(options: { now?: () => number; maxEntries?: number; maxBytes?: number; retainForMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? Math.floor(value!) : fallback;
  const maxEntries = Math.max(1, Math.min(30, finite(options.maxEntries, 30)));
  // Additional to the existing live read cache; never persisted to disk.
  const maxBytes = Math.max(1, Math.min(5 * 1024 * 1024, finite(options.maxBytes, 2 * 1024 * 1024)));
  const retainForMs = Math.max(0, Math.min(300_000, finite(options.retainForMs, 300_000)));
  const entries = new Map<string, Entry>();
  const revisions = new Map<string, { scope: string; revision: string }>();
  let boundary: { viewerId: string; generation: string } | null = null, bytes = 0;
  const valid = (value: AppLocalRoleReadAuthority | null): value is AppLocalRoleReadAuthority => Boolean(value
    && [value.viewerId, value.generation, value.salonId, value.workspaceId, value.permissionRevision, value.proof].every(part => typeof part === "string" && part.trim().length > 0 && part.length <= 8192)
    && /^v3:[a-f0-9]{64}$/.test(value.scope) && typeof value.grantRevision === "string" && value.grantRevision.length <= 8192);
  const revision = (value: AppLocalRoleReadAuthority) => JSON.stringify([value.permissionRevision, value.grantRevision, value.proof]);
  const contextKey = (value: AppLocalRoleReadAuthority) => JSON.stringify([value.salonId, value.workspaceId]);
  const identity = (value: AppLocalRoleReadAuthority) => JSON.stringify([value.viewerId, value.generation, value.salonId, value.workspaceId, value.scope, revision(value)]);
  function remove(key: string) { const entry = entries.get(key); if (entry) { bytes -= entry.bytes; entries.delete(key); } }
  function prune() { for (const [key, entry] of entries) if (entry.expiresAt <= now()) remove(key); }
  function clear(scope?: string) {
    if (scope === undefined || !/^v3:[a-f0-9]{64}$/.test(scope)) { entries.clear(); revisions.clear(); boundary = null; bytes = 0; return; }
    for (const [key, entry] of entries) if (entry.authority.scope === scope) remove(key);
    for (const [key, value] of revisions) if (value.scope === scope) revisions.delete(key);
  }
  function observePrincipal(viewerId: string, generation: string): boolean {
    if (![viewerId, generation].every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 8192)) { clear(); return false; }
    if (boundary && (boundary.viewerId !== viewerId || boundary.generation !== generation)) clear();
    boundary = { viewerId, generation }; prune(); return true;
  }
  function removeContext(context: string) {
    for (const [key, entry] of entries) if (contextKey(entry.authority) === context) remove(key);
    revisions.delete(context);
  }
  function observe(authority: AppLocalRoleReadAuthority | null): boolean {
    if (!valid(authority)) { clear(); return false; }
    if (!observePrincipal(authority.viewerId, authority.generation)) return false;
    const context = contextKey(authority), previous = revisions.get(context), next = { scope: authority.scope, revision: revision(authority) };
    if (previous && (previous.scope !== next.scope || previous.revision !== next.revision)) removeContext(context);
    // Metadata is bounded too, even when a workspace produced no retainable DTO.
    if (revisions.size >= 30 && !revisions.has(context)) removeContext(revisions.keys().next().value!);
    revisions.set(context, next); prune(); return true;
  }
  function remember(authority: AppLocalRoleReadAuthority, rows: readonly AppLocalRoleRead[]) {
    if (!observe(authority)) return;
    for (const row of rows) {
      if (!row || typeof row.name !== "string" || !/^[a-z][a-z0-9.-]{0,100}$/.test(row.name)
        || !row.args || Array.isArray(row.args) || typeof row.args !== "object") continue;
      const snapshot = row.snapshot;
      if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.status !== 200 || snapshot.scope !== authority.scope
        || snapshot.offline || snapshot.data === undefined || !Number.isFinite(snapshot.updatedAt)
        || snapshot.updatedAt > now() || snapshot.updatedAt + retainForMs <= now()) continue;
      let encoded: string;
      try {
        encoded = JSON.stringify({ name: row.name, args: row.args, snapshot: { schemaVersion: 1, status: 200, scope: snapshot.scope, etag: snapshot.etag, updatedAt: snapshot.updatedAt, data: snapshot.data } }, (key, value) => {
          if (/^(?:password|passcode|token|access_token|refresh_token|client_secret|session|grant|grants|authorization|sealedPasscode|cardNumber|card_number|cvc|cvv)$/i.test(key)
            || typeof value === "function" || value instanceof Promise) throw new Error("Not a read DTO");
          return value;
        });
      } catch { continue; }
      const key = JSON.stringify([identity(authority), row.name, stable(row.args)]), size = (encoded.length + key.length) * 2 + 128;
      if (size > maxBytes) continue;
      const saved = JSON.parse(encoded) as AppLocalRoleRead;
      remove(key);
      while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value!);
      entries.set(key, { authority: { ...authority }, row: saved, bytes: size, expiresAt: snapshot.updatedAt + retainForMs }); bytes += size;
    }
  }
  function restore(authority: AppLocalRoleReadAuthority): AppLocalRoleRead[] {
    if (!observe(authority)) return [];
    const result: AppLocalRoleRead[] = [], expected = identity(authority);
    for (const [key, entry] of [...entries]) if (identity(entry.authority) === expected) {
      result.push(JSON.parse(JSON.stringify(entry.row)) as AppLocalRoleRead);
      entries.delete(key); entries.set(key, entry);
    }
    return result;
  }
  return { remember, observe, observePrincipal, restore, clear, stats: () => { prune(); return { entries: entries.size, bytes }; } };
}
