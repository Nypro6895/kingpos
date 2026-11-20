"use client";

import { createServicesCatalogStore } from "./services-catalog-cache";
import type { ExperienceResetReason } from "./experience-cache-events";

let store: ReturnType<typeof createServicesCatalogStore> | undefined;
const listeners = new Set<() => void>();
let revision = 0;
let activeScope: string | null = null;
export const getServicesCatalogStore = () => store ??= createServicesCatalogStore();
export const servicesCatalogRuntimeRevision = () => revision;
export const servicesCatalogActiveScope = () => activeScope;
export const servicesCatalogScopeActive = (scope: string) => activeScope === scope;
export function subscribeServicesCatalogInvalidation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function invalidateServicesCatalog(reason: ExperienceResetReason = "reset") {
  if (typeof window === "undefined") return;
  ++revision;
  // An optional subscriber cannot prevent other views from withdrawing or stop
  // the caller's authoritative auth reset. Notify this event's subscribers once.
  for (const listener of [...listeners]) {
    try { void Promise.resolve(listener()).catch(() => {}); } catch { /* Continue invalidation. */ }
  }
  // A workspace transition withdraws presentation but preserves same-account
  // salon partitions. Every other reset is conservatively a security purge.
  if (reason !== "workspace") {
    try { void Promise.resolve(getServicesCatalogStore().purge()).catch(() => {}); }
    catch { /* Optional store construction or synchronous removal can fail. */ }
  }
}
export function observeServicesCatalogScope(scope: string | null) {
  if (scope !== activeScope) { activeScope = scope; invalidateServicesCatalog("workspace"); }
}

/** A Services write/handoff invalidates only its read projection, never authority. */
export function invalidateServicesCatalogForMutation(scope: string | null = activeScope, salonId?: string): Promise<void> {
  if ((!scope && !salonId) || !store) return Promise.resolve();
  if (scope === activeScope) invalidateServicesCatalog("workspace");
  // Cancel current presentation before touching optional disk. The native
  // editor has a different origin, so retire its old copy before opening it.
  let removal: Promise<void>;
  try { removal = salonId ? store.removeSalon(salonId) : store.removeScope(scope!); } catch { return Promise.resolve(); }
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 2_000);
    const finish = () => { clearTimeout(timer); resolve(); };
    void Promise.resolve(removal).then(finish, finish);
  });
}
