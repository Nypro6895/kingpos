"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getAppLocalHost, type AppLocalRead } from "./app-local-host";
import { getExperienceOfflineGrant, isExperienceSnapshotAuthorized, readExperienceSnapshot, writeExperienceSnapshot, removeExperienceSnapshot } from "./experience-persistent-cache";
import { appLocalReadIsDurable } from "./app-local-data-policy";
import { appLocalCommandAffectsResource } from "./app-local-resource-invalidation";
import { createExperienceResourceCache, ExperienceResourceInvalidatedError, type ExperienceResourceContext } from "./experience-resource-cache";
import { subscribeReadRefresh, canAutomaticallyRefreshRead } from "./read-refresh-scheduler";
import { recordReadRequest, readResourceCategory } from "./read-request-metrics";
import { nextExperienceTraceOperation, recordExperienceTrace, type ExperienceTraceFields } from "./experience-trace";

function traceResource(name: string, args: Record<string, unknown>): Pick<ExperienceTraceFields, "area" | "phase"> {
  const phase = ["shell", "staff", "bookings", "waiting", "financials", "extras", "full"].includes(String(args.phase)) ? args.phase as ExperienceTraceFields["phase"] : "none";
  return { area: name === "page.owner-today" || name === "owner.today" ? "today" : name.startsWith("shell.") ? "shell" : "other", phase };
}

// Native admission owns its authority epoch. Reuse the web read engine without
// allowing an unrelated hosted scope suspension/resume to grant or block native
// access. Native resets still cancel every retained local request below.
export const appLocalResourceCache = createExperienceResourceCache({ canUse: () => typeof window !== "undefined" });

export type AppLocalResourceState<T> = { data?: T; etag?: string; updatedAt: number; loading: boolean; refreshing: boolean; error?: string; accessDenied?: boolean };
// Cells contain React view state only. Request ownership, freshness, conditional
// responses and failure cooldown belong to the shared scoped read cache.
type Cell = { context: ExperienceResourceContext; state: AppLocalResourceState<unknown>; listeners: Set<() => void>; active: number; validatedAt: number; invalidated?: boolean; epoch: number; revision: number; revalidate?: boolean; hydrated?: Promise<void>; pending?: Promise<void> };
const cells = new Map<string, Cell>();
let epoch = 0;
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function cellFor(scope: string, name: string, args: unknown) {
  const key = JSON.stringify([scope, name, stable(args)]);
  let cell = cells.get(key);
  if (!cell) {
    if (cells.size >= 128) for (const [id, existing] of cells) if (!existing.listeners.size && !existing.pending) { cells.delete(id); break; }
    const context = { scope: scope || "unavailable", key: "app-local:" + JSON.stringify([name, stable(args)]) };
    const retained = appLocalResourceCache.get<AppLocalRead<unknown>>(context), saved = retained?.data;
    cell = { context, state: { data: saved?.data, etag: saved?.etag, updatedAt: saved?.updatedAt ?? 0, loading: !saved, refreshing: false }, listeners: new Set(), active: 0, validatedAt: retained?.updatedAt ?? 0, epoch, revision: 0 }; cells.set(key, cell);
  }
  return { key, cell };
}
function emit(cell: Cell, patch: Partial<AppLocalResourceState<unknown>>) { cell.state = { ...cell.state, ...patch }; for (const listener of cell.listeners) listener(); }
function retainActiveResource(cell: Cell) { cell.active++; return () => { cell.active--; }; }
function resourceDomain(name: string) {
  const aliases: Record<string, string> = { "page.market": "market-catalog", "page.market-deposit": "market-deposit", "page.customer-bookings": "customer-bookings", "page.customer-receipt": "customer-receipt", "page.owner-today": "owner-today", "page.settings": "customer-settings", "page.my-place": "customer-my-place", "page.more": "customer-more", "page.support": "customer-support", "page.support-case": "customer-support-case", "page.services": "owner-services" };
  const personal: Record<string,string> = { "page.beauty":"customer-beauty", "page.notifications":"notifications-center", "page.explore":"public-explore", "page.owner-staff":"owner-staff", "page.owner-customers":"owner-customers", "page.owner-customer-detail":"owner-customer-detail", "page.owner-payroll":"owner-payroll" };
  const shared:Record<string,string>={"shell.navigation":"customer-shell-navigation","shell.configuration":"customer-shell-configuration","shell.summary":"notifications-summary","shell.notice":"customer-shell-notice"};
  const domain = aliases[name] ?? personal[name] ?? shared[name] ?? name.replaceAll(".", "-");
  if (!/^[a-z][a-z0-9:-]{0,79}$/.test(domain)) throw new Error("Invalid application resource");
  return domain;
}
export function resetAppLocalResources() {
  recordExperienceTrace("cache.reset", { source: "app-local", reason: "reset" });
  epoch++;
  appLocalResourceCache.reset();
  for (const cell of cells.values()) { cell.epoch = epoch; emit(cell, { data: undefined, etag: undefined, updatedAt: 0, loading: false, refreshing: false, error: undefined }); }
  cells.clear();
}
/** Withdraw only these DTOs before an explicitly reauthorized page recovery. */
export async function discardAppLocalResources(scope: string, name: string, argsList: readonly Record<string, unknown>[]): Promise<boolean> {
  const started = epoch, host = getAppLocalHost();
  const targets = argsList.map(args => ({ ...cellFor(scope, name, args), args }));
  for (const { cell } of targets) {
    cell.revision++;
    cell.invalidated = true;
    appLocalResourceCache.forget(cell.context);
  }
  // Remove durable copies before new readers can mount. A failed removal keeps
  // the page withdrawn; it must not restore a snapshot rejected by the server.
  await Promise.all(targets.map(({ args }) => host.isNative
    ? host.cache("remove", { name, args, scope })
    : removeExperienceSnapshot({ scope, domain: resourceDomain(name), params: args })));
  if (epoch !== started || targets.some(({ key, cell }) => cells.get(key) !== cell)) return false;
  for (const { key, cell, args } of targets) {
    cells.delete(key);
    const replacement = cellFor(scope, name, args).cell;
    replacement.invalidated = true;
    // Do not race a late old durable writer during this recovery. Fresh reads
    // repopulate their own authorized snapshots through the existing transport.
    replacement.hydrated = Promise.resolve();
    emit(cell, { data: undefined, etag: undefined, updatedAt: 0, loading: false, refreshing: false, error: undefined, accessDenied: false });
  }
  return true;
}
if (typeof window !== "undefined") {
  for (const event of ["reylumi:app-local-reset", "reylumi:experience-reset", "reylumi:offline-clear", "reylumi:offline-grant-invalidated", "reylumi:experience-access-changed"]) window.addEventListener(event, value => {
    // Entry sequences context rotations against the accepted native epoch.
    // A queued reset must not independently erase the destination's new cells.
    if (event === "reylumi:app-local-reset" && (value as CustomEvent<{ reason?: string }>).detail?.reason === "context") return;
    resetAppLocalResources();
  });
  window.addEventListener("reylumi:app-local-command-complete", event => {
    const { scope, source } = (event as CustomEvent<{ scope?: string; source?: string }>).detail ?? {};
    for (const [key, cell] of cells) {
      const [owner, name, args] = JSON.parse(key) as [string, string, Record<string, unknown>];
      if (scope !== owner || !appLocalCommandAffectsResource(name, source)) continue;
      cell.invalidated = true;
      cell.revision++;
      // A successful command invalidates even an earlier read still in flight.
      // The cache owns cancellation; only the current cell schedules its repair.
      appLocalResourceCache.forget(cell.context);
      if (cell.pending) cell.revalidate = true;
      // Activity keeps subscriptions and DOM, but detaches operational effects.
      // Mark hidden data stale and reconcile once when its view returns.
      if (!cell.active) continue;
      if (!cell.pending) void refreshAppLocalResource(owner, name, args);
    }
  });
}

export async function hydrateAppLocalResource<T>(scope: string, name: string, args: Record<string, unknown> = {}): Promise<void> {
  const { key, cell } = cellFor(scope, name, args); if (cell.hydrated) return cell.hydrated;
  const started = epoch, revision = cell.revision, host = getAppLocalHost();
  let traceOperation = 0, traceStarted = 0;
  cell.hydrated = (async () => {
    if (!appLocalReadIsDurable(name)) return;
    traceOperation = nextExperienceTraceOperation(); traceStarted = traceOperation ? performance.now() : 0;
    recordExperienceTrace("cache.restore.start", { source: "app-local", operation: traceOperation, ...traceResource(name, args) });
    const saved = host.isNative
      ? await host.cache<{ data: T; revision?: string; updatedAt: number }>("get", { name, args, scope })
      : await readExperienceSnapshot<T>({ scope, domain: resourceDomain(name), params: args });
    recordExperienceTrace(saved ? "cache.hit" : "cache.miss", { source: "app-local", operation: traceOperation, offline: true, ...traceResource(name, args) });
    if (epoch !== started || cell.epoch !== started || cell.revision !== revision || cells.get(key) !== cell) return;
    if (saved && !cell.invalidated && saved.updatedAt >= cell.state.updatedAt && appLocalResourceCache.isAvailable(cell.context)) {
      const snapshot: AppLocalRead<T> = { schemaVersion: 1, status: 200, scope, data: saved.data, etag: saved.revision ?? "", updatedAt: saved.updatedAt, offline: true };
      appLocalResourceCache.seed(cell.context, snapshot, {}, saved.updatedAt, saved.revision);
      cell.validatedAt = Math.max(cell.validatedAt, saved.updatedAt);
      emit(cell, { data: saved.data, etag: saved.revision, updatedAt: saved.updatedAt, loading: false, accessDenied: false });
    }
  })().catch(() => {}).finally(() => { if (traceOperation) recordExperienceTrace("cache.restore.end", { source: "app-local", operation: traceOperation, durationMs: performance.now() - traceStarted, ...traceResource(name, args) }); if (epoch === started && cells.get(key) === cell && cell.state.data === undefined) emit(cell, { loading: false }); });
  return cell.hydrated;
}
export function seedAppLocalResource<T>(scope: string, name: string, args: Record<string, unknown>, snapshot: AppLocalRead<T>) {
  if (snapshot.scope !== scope || snapshot.status !== 200 || snapshot.data === undefined) return;
  const { cell } = cellFor(scope, name, args);
  if (snapshot.updatedAt >= cell.state.updatedAt && appLocalResourceCache.isAvailable(cell.context)) {
    appLocalResourceCache.seed(cell.context, snapshot, {}, snapshot.offline ? snapshot.updatedAt : Date.now(), snapshot.etag);
    cell.validatedAt = snapshot.offline ? snapshot.updatedAt : Date.now();
    cell.invalidated = false;
    emit(cell, { data: snapshot.data, etag: snapshot.etag, updatedAt: snapshot.updatedAt, loading: false, refreshing: false, accessDenied: false });
  }
}
export async function refreshAppLocalResource<T>(scope: string, name: string, args: Record<string, unknown> = {}, options: { force?: boolean; freshForMs?: number } = {}): Promise<void> {
  const { key, cell } = cellFor(scope, name, args); if (cell.pending) return cell.pending;
  if (!appLocalResourceCache.isAvailable(cell.context)) return;
  if (options.force === false && !canAutomaticallyRefreshRead()) return;
  // Oversize DTOs and recently evicted entries can remain in a retained view.
  // Keep only their successful-validation timestamp here; displaying/hydrating
  // that view does not move the timestamp or create another cache owner.
  const retained = appLocalResourceCache.get(cell.context);
  if (options.force === false && !cell.invalidated && !retained && cell.state.data !== undefined && cell.validatedAt > 0 && cell.validatedAt <= Date.now() && Date.now() - cell.validatedAt < (options.freshForMs ?? 30_000)) {
    recordReadRequest(readResourceCategory(cell.context.key), "cache-hit");
    return;
  }
  const started = epoch, revision = cell.revision, host = getAppLocalHost();
  recordExperienceTrace("cache.refresh", { source: "app-local", fresh: Boolean(retained?.fresh), trigger: options.force === false ? "unknown" : "manual", ...traceResource(name, args) });
  emit(cell, { refreshing: true, error: undefined });
  cell.pending = (async () => {
    // Oversize/evicted data can remain in a mounted view. Supply that snapshot
    // for a conditional read without claiming it is fresh merely by showing it.
    if (!appLocalResourceCache.get(cell.context) && cell.state.data !== undefined) {
      appLocalResourceCache.seed(cell.context, { schemaVersion: 1, status: 200, scope, data: cell.state.data, etag: cell.state.etag ?? "", updatedAt: cell.state.updatedAt } satisfies AppLocalRead<unknown>, { freshForMs: 0 }, cell.state.updatedAt, cell.state.etag);
    }
    let transportValidatedAt: number | undefined;
    const snapshot = await appLocalResourceCache.load<AppLocalRead<T>>(cell.context, async ({ signal, etag, cached }) => {
      const category = readResourceCategory(cell.context.key), began = Date.now();
      const operation = nextExperienceTraceOperation();
      recordExperienceTrace("cache.read.start", { source: "app-local", operation, ...traceResource(name, args) });
      try {
        const next = await host.read<T>(name, args, { scope, etag: etag ?? cell.state.etag, signal });
        recordExperienceTrace("cache.read.end", { source: "app-local", operation, status: next.status, offline: Boolean(next.offline), durationMs: Date.now() - began, ...traceResource(name, args) });
        if (epoch !== started || cell.epoch !== started || cell.revision !== revision || cells.get(key) !== cell || next.scope !== scope) throw new ExperienceResourceInvalidatedError();
        transportValidatedAt = next.offline ? next.updatedAt : Date.now();
        const previous = cached ?? (cell.state.data === undefined ? undefined : { schemaVersion: 1, status: 200, scope, data: cell.state.data as T, etag: cell.state.etag ?? "", updatedAt: cell.state.updatedAt } as AppLocalRead<T>);
        if (next.status === 304) {
          if (!previous) throw new Error("The saved page must be loaded again");
          recordReadRequest(category, "not-modified", Date.now() - began);
          return { data: { ...previous, offline: next.offline }, etag: next.etag || previous.etag, validatedAt: transportValidatedAt };
        }
        if (next.data === undefined) throw new Error("The page update was incomplete");
        // A delayed transport cannot replace a newer accepted page seed.
        const accepted = previous && previous.updatedAt > next.updatedAt ? previous : next;
        recordReadRequest(category, "network", Date.now() - began);
        return { data: accepted, etag: accepted.etag, validatedAt: transportValidatedAt };
      } catch (error) {
        const status = (error as { status?: number })?.status;
        recordExperienceTrace("cache.read.end", { source: "app-local", operation, status, reason: signal.aborted ? "reset" : "transient", durationMs: Date.now() - began, ...traceResource(name, args) });
        recordReadRequest(category, signal.aborted ? "aborted" : [401,403,409].includes(status ?? 0) ? "access-denied" : "error", Date.now() - began);
        throw error;
      }
    }, { freshForMs: options.freshForMs ?? 30_000, force: options.force !== false || cell.invalidated });
    if (epoch !== started || cell.revision !== revision || cells.get(key) !== cell || !appLocalResourceCache.isAvailable(cell.context)) return;
    cell.invalidated = false;
    cell.validatedAt = appLocalResourceCache.get(cell.context)?.updatedAt ?? transportValidatedAt ?? cell.validatedAt;
    if (snapshot.updatedAt >= cell.state.updatedAt) emit(cell, { data: snapshot.data, etag: snapshot.etag, updatedAt: snapshot.updatedAt, loading: false, refreshing: false, accessDenied: false });
    // Native retains only envelopes it fetched and authorized itself. JavaScript
    // cannot manufacture a private native snapshot through a cache-write bridge.
    if (appLocalReadIsDurable(name) && !host.isNative && !snapshot.offline && isExperienceSnapshotAuthorized(scope) && getExperienceOfflineGrant(scope)) await writeExperienceSnapshot({ scope, domain: resourceDomain(name), params: args, data: snapshot.data, revision: snapshot.etag, updatedAt: snapshot.updatedAt });
  })().catch(error => {
    if (epoch !== started || cell.revision !== revision || error instanceof ExperienceResourceInvalidatedError || cells.get(key) !== cell) return;
    if (error?.status === 401 || error?.status === 409 || error?.status === 403 && name.startsWith("staff.")) { resetAppLocalResources(); window.dispatchEvent(new CustomEvent("reylumi:app-local-access-changed", { detail: { reason: "resource", status: error.status, scope } })); return; }
    if (error?.status === 403 || error?.status === 404) {
      cell.revision++;
      appLocalResourceCache.forget(cell.context);
      // A confirmed deletion or revoked relationship cannot keep its old DTO
      // visible. A timeout leaves the last authorized snapshot available.
      emit(cell, { data: undefined, etag: undefined, updatedAt: 0, error: "This page is no longer available.", loading: false, refreshing: false, accessDenied: true });
      if (host.isNative) void host.cache("remove", { name, args, scope }).catch(() => {});
      else void removeExperienceSnapshot({ scope, domain: resourceDomain(name), params: args });
      // Check whether the account's permissions changed, without remounting
      // unrelated pages merely because one feature/relationship was denied.
      if (error.status === 403) window.dispatchEvent(new CustomEvent("reylumi:app-local-revalidate-access", { detail: { scope } }));
      return;
    }
    emit(cell, { error: error instanceof Error ? error.message : "Could not update this page", loading: false, refreshing: false });
  }).finally(() => { if (epoch === started && cells.get(key) === cell) { cell.pending = undefined; if (cell.state.refreshing) emit(cell, { refreshing: false }); if (cell.revalidate) { cell.revalidate = false; if (cell.active) void refreshAppLocalResource(scope, name, args); } } });
  return cell.pending;
}

export function useAppLocalResource<T>(scope: string | undefined, name: string, args: Record<string, unknown> = {}, options: { enabled?: boolean; refreshAfterMs?: number } = {}) {
  const signature = JSON.stringify(stable(args)), actualScope = scope ?? "", { cell } = cellFor(actualScope, name, args);
  const subscribe = useCallback((changed: () => void) => {
    cell.listeners.add(changed);
    const unsubscribe = appLocalResourceCache.subscribe(cell.context, () => { cell.state = { ...cell.state }; changed(); });
    return () => { cell.listeners.delete(changed); unsubscribe(); };
  }, [cell]);
  const snapshot = useCallback(() => cell.state as AppLocalResourceState<T>, [cell]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const available = appLocalResourceCache.isAvailable(cell.context);
  const refresh = useCallback(() => actualScope ? refreshAppLocalResource<T>(actualScope, name, JSON.parse(signature)) : Promise.resolve(), [actualScope, name, signature]);
  useEffect(() => {
    if (!actualScope || !available || options.enabled === false) return;
    const release = retainActiveResource(cell);
    let alive = true;
    const ensureFresh = () => {
      if (!alive || !canAutomaticallyRefreshRead()) return;
      void refreshAppLocalResource<T>(actualScope, name, JSON.parse(signature), { force: false, freshForMs: options.refreshAfterMs });
    };
    void hydrateAppLocalResource<T>(actualScope, name, JSON.parse(signature)).then(ensureFresh);
    const unsubscribe = subscribeReadRefresh(ensureFresh);
    return () => { alive = false; release(); unsubscribe(); };
  }, [actualScope, name, signature, options.enabled, options.refreshAfterMs, cell, refresh, available]);
  return { ...state, data: available ? state.data : undefined, refresh, available };
}
