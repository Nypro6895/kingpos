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
