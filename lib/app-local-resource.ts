"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getAppLocalHost, type AppLocalRead, type AppLocalContext } from "./app-local-host";
import { createAppLocalRoleReadCache, type AppLocalRoleReadAuthority } from "./app-local-role-read-cache";
import { getExperienceOfflineGrant, isExperienceSnapshotAuthorized, readExperienceSnapshot, writeExperienceSnapshot, removeExperienceSnapshot } from "./experience-persistent-cache";
import { appLocalReadIsDurable } from "./app-local-data-policy";
import { appLocalCommandAffectsResource } from "./app-local-resource-invalidation";
import { createExperienceResourceCache, ExperienceResourceInvalidatedError, type ExperienceResourceContext } from "./experience-resource-cache";
import { subscribeReadRefresh, canAutomaticallyRefreshRead } from "./read-refresh-scheduler";
import { recordReadRequest, readResourceCategory } from "./read-request-metrics";
import { nextExperienceTraceOperation, recordExperienceTrace, type ExperienceTraceFields } from "./experience-trace";
import { appLocalContextFailureReason, isAppLocalContextCancellation } from "./app-local-context-recovery";
import { appLocalReadTraceFields } from "./read-request-trace-protocol";
import { readPriorityScheduler } from "./read-priority-scheduler";

function traceResource(name: string, args: Record<string, unknown>): Pick<ExperienceTraceFields, "area" | "phase"> {
  const phase = ["shell", "staff", "bookings", "waiting", "financials", "extras", "full"].includes(String(args.phase)) ? args.phase as ExperienceTraceFields["phase"] : "none";
  return { area: name === "page.owner-today" || name === "owner.today" ? "today" : name.startsWith("shell.") ? "shell" : "other", phase };
}

// Native admission owns its authority epoch. Reuse the web read engine without
// allowing an unrelated hosted scope suspension/resume to grant or block native
// access. Native resets still cancel every retained local request below.
export const appLocalResourceCache = createExperienceResourceCache({ canUse: () => typeof window !== "undefined" });

export type AppLocalResourceState<T> = { data?: T; etag?: string; updatedAt: number; loading: boolean; refreshing: boolean; error?: string; accessDenied?: boolean; offline?: boolean };
// Cells contain React view state only. Request ownership, freshness, conditional
// responses and failure cooldown belong to the shared scoped read cache.
type Cell = { context: ExperienceResourceContext; state: AppLocalResourceState<unknown>; listeners: Set<() => void>; active: number; validatedAt: number; invalidated?: boolean; epoch: number; revision: number; deliveryRevision: number; revalidate?: boolean; hydrated?: Promise<void>; pending?: Promise<void> };
const cells = new Map<string, Cell>();
const roleReads = createAppLocalRoleReadCache();
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
    cell = { context, state: { data: saved?.data, etag: saved?.etag, updatedAt: saved?.updatedAt ?? 0, loading: !saved, refreshing: false, offline: saved?.offline }, listeners: new Set(), active: 0, validatedAt: retained?.updatedAt ?? 0, epoch, revision: 0, deliveryRevision: 0 }; cells.set(key, cell);
  }
  return { key, cell };
}
function emit(cell: Cell, patch: Partial<AppLocalResourceState<unknown>>) { cell.state = { ...cell.state, ...patch }; for (const listener of cell.listeners) listener(); }
function retainActiveResource(cell: Cell) { cell.active++; return () => { cell.active--; }; }
function roleReadAuthority(value: AppLocalContext, generation?: string): AppLocalRoleReadAuthority | null {
  const context = value.context;
  // Personal/unknown tenants do not establish a same-salon cache boundary.
  if (value.offline || !context.authenticated || !context.viewerId || !context.salonId || !generation) return null;
  return { viewerId: context.viewerId, salonId: context.salonId, generation, workspaceId: context.workspaceId,
    scope: context.scope, permissionRevision: context.permissionRevision, grantRevision: value.grant?.grantRevision ?? "",
    proof: JSON.stringify([value.grant?.kind ?? null, value.offlineState ?? null, Boolean(value.access?.ownerWorkspace), Boolean(value.access?.staffWorkspace), value.staffOnlineAccess?.staffId ?? null]) };
}
export function clearAppLocalRoleResources(scope?: string) { roleReads.clear(scope); }
/** A fresh denied destination can withdraw its quarantine without forgetting a
 * different role of the positively identified account. This never admits it. */
export function invalidateAppLocalRoleResources(value: AppLocalContext, generation?: string) {
  const age = Date.now() - value.onlineValidatedAt;
  const observedGeneration = value.grant?.generation ?? (value as AppLocalContext & { host?: { generation?: string } }).host?.generation;
  if (value.schemaVersion !== 1 || value.offline || value.grantStatus === 401 || !value.context?.authenticated
    || !/^v3:[a-f0-9]{64}$/.test(value.context.scope) || !Number.isFinite(age) || age < 0 || age >= 30_000
    || !generation || observedGeneration !== generation
    || !roleReads.observePrincipal(value.context.viewerId ?? "", generation ?? "")) {
    roleReads.clear(); return false;
  }
  const authority = roleReadAuthority(value, generation);
  if (authority && !roleReads.observe(authority)) return false;
  roleReads.clear(value.context.scope);
  return true;
}
function observePersonalPrincipal(value: AppLocalContext, generation?: string) {
  // An accepted Personal context can preserve existing salon quarantine, but
  // cannot mint, restore, or admit salon DTOs through its null tenant identity.
  return !value.offline && value.context.authenticated && value.context.salonId === null
    && roleReads.observePrincipal(value.context.viewerId ?? "", generation ?? "");
}
/** Capture settled online DTOs before the original workspace command runs. */
export function rememberAppLocalRoleResources(value: AppLocalContext, generation?: string) {
  const authority = roleReadAuthority(value, generation);
  if (!authority) { if (!observePersonalPrincipal(value, generation)) roleReads.clear(); return; }
  const rows = [];
  for (const [key, cell] of cells) {
    const [scope, name, args] = JSON.parse(key) as [string, string, Record<string, unknown>];
    if (scope !== authority.scope || cell.pending || cell.invalidated || cell.state.accessDenied || !appLocalReadIsDurable(name)) continue;
    const snapshot = appLocalResourceCache.get<AppLocalRead>(cell.context)?.data;
    if (snapshot) rows.push({ name, args, snapshot });
  }
  roleReads.remember(authority, rows);
}
/** Called only after entry accepts fresh destination authority, never as admission. */
export function reconcileAppLocalRoleResources(value: AppLocalContext, generation?: string, restore = false) {
  if (value.offline) { roleReads.clear(); return; }
  const authority = roleReadAuthority(value, generation);
  if (!authority) { if (!observePersonalPrincipal(value, generation)) roleReads.clear(); return; }
  if (!roleReads.observe(authority) || !authority || !restore) return;
  for (const { name, args, snapshot } of roleReads.restore(authority)) {
    const { cell } = cellFor(authority.scope, name, args);
    if (!appLocalResourceCache.seed(cell.context, snapshot, { freshForMs: 0 }, snapshot.updatedAt, snapshot.etag)) continue;
    // Fresh context proves access, not DTO freshness. Revalidate in background;
    // skip an older durable hydration and preserve the original DTO timestamp.
    cell.invalidated = true; cell.validatedAt = 0; cell.hydrated = Promise.resolve(); cell.deliveryRevision++;
    emit(cell, { data: snapshot.data, etag: snapshot.etag, updatedAt: snapshot.updatedAt, loading: false, refreshing: false, accessDenied: false, offline: Boolean(snapshot.offline) });
  }
}
function resourceDomain(name: string) {
  const aliases: Record<string, string> = { "page.market": "market-catalog", "page.market-deposit": "market-deposit", "page.customer-bookings": "customer-bookings", "page.customer-receipt": "customer-receipt", "page.owner-today": "owner-today", "page.settings": "customer-settings", "page.my-place": "customer-my-place", "page.more": "customer-more", "page.support": "customer-support", "page.support-case": "customer-support-case", "page.services": "owner-services" };
  const personal: Record<string,string> = { "page.beauty":"customer-beauty", "page.notifications":"notifications-center", "page.explore":"public-explore", "page.owner-staff":"owner-staff", "page.owner-customers":"owner-customers", "page.owner-customer-detail":"owner-customer-detail", "page.owner-payroll":"owner-payroll" };
  const shared:Record<string,string>={"shell.navigation":"customer-shell-navigation","shell.configuration":"customer-shell-configuration","shell.summary":"notifications-summary","shell.notice":"customer-shell-notice"};
  const domain = aliases[name] ?? personal[name] ?? shared[name] ?? name.replaceAll(".", "-");
  if (!/^[a-z][a-z0-9:-]{0,79}$/.test(domain)) throw new Error("Invalid application resource");
  return domain;
}
export function resetAppLocalResources(scope?: string) {
  recordExperienceTrace("cache.reset", { source: "app-local", reason: "reset" });
  if (!scope) epoch++;
  readPriorityScheduler.cancelScope(scope);
  appLocalResourceCache.reset(scope);
  for (const [key, cell] of cells) {
    if (scope && cell.context.scope !== scope) continue;
    cell.revision++;
    cell.epoch = epoch;
    emit(cell, { data: undefined, etag: undefined, updatedAt: 0, loading: false, refreshing: false, error: undefined });
    cells.delete(key);
  }
}
/** Withdraw only these DTOs before an explicitly reauthorized page recovery. */
export async function discardAppLocalResources(scope: string, name: string, argsList: readonly Record<string, unknown>[]): Promise<boolean> {
  clearAppLocalRoleResources(scope);
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
    clearAppLocalRoleResources();
    resetAppLocalResources();
  });
  window.addEventListener("reylumi:app-local-command-complete", event => {
    // A business write can affect another role in this salon. Conservatively
    // withdraw quarantined DTOs as well as invalidating the visible resources.
    clearAppLocalRoleResources();
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
  const started = epoch, revision = cell.revision, deliveryRevision = cell.deliveryRevision, host = getAppLocalHost();
  let traceOperation = 0, traceStarted = 0;
  cell.hydrated = (async () => {
    if (!appLocalReadIsDurable(name)) return;
    traceOperation = nextExperienceTraceOperation(); traceStarted = traceOperation ? performance.now() : 0;
    recordExperienceTrace("cache.restore.start", { source: "app-local", operation: traceOperation, ...traceResource(name, args) });
    const saved = host.isNative
      ? await host.cache<{ data: T; revision?: string; updatedAt: number }>("get", { name, args, scope })
      : await readExperienceSnapshot<T>({ scope, domain: resourceDomain(name), params: args });
    recordExperienceTrace(saved ? "cache.hit" : "cache.miss", { source: "app-local", operation: traceOperation, offline: true, ...traceResource(name, args) });
    // Foreground/manual reads can finish while durable restoration is pending.
    // That earlier cache request cannot replace a subsequently accepted result,
    // even when the saved timestamp is ahead because of clock skew.
    if (epoch !== started || cell.epoch !== started || cell.revision !== revision || cell.deliveryRevision !== deliveryRevision || cells.get(key) !== cell) return;
    if (saved && !cell.invalidated && saved.updatedAt >= cell.state.updatedAt && appLocalResourceCache.isAvailable(cell.context)) {
      const snapshot: AppLocalRead<T> = { schemaVersion: 1, status: 200, scope, data: saved.data, etag: saved.revision ?? "", updatedAt: saved.updatedAt, offline: true };
      appLocalResourceCache.seed(cell.context, snapshot, {}, saved.updatedAt, saved.revision);
      cell.validatedAt = Math.max(cell.validatedAt, saved.updatedAt);
      emit(cell, { data: saved.data, etag: saved.revision, updatedAt: saved.updatedAt, loading: false, accessDenied: false, offline: true });
    }
  })().catch(() => {}).finally(() => { if (traceOperation) recordExperienceTrace("cache.restore.end", { source: "app-local", operation: traceOperation, durationMs: performance.now() - traceStarted, ...traceResource(name, args) }); if (epoch === started && cells.get(key) === cell && cell.state.data === undefined) emit(cell, { loading: false }); });
  return cell.hydrated;
}
export function seedAppLocalResource<T>(scope: string, name: string, args: Record<string, unknown>, snapshot: AppLocalRead<T>) {
  if (snapshot.scope !== scope || snapshot.status !== 200 || snapshot.data === undefined) return;
  const { cell } = cellFor(scope, name, args);
  if ((snapshot.updatedAt >= cell.state.updatedAt || cell.state.offline && !snapshot.offline) && appLocalResourceCache.isAvailable(cell.context)) {
    appLocalResourceCache.seed(cell.context, snapshot, {}, snapshot.offline ? snapshot.updatedAt : Date.now(), snapshot.etag);
    cell.validatedAt = snapshot.offline ? snapshot.updatedAt : Date.now();
    cell.invalidated = false;
    cell.deliveryRevision++;
    emit(cell, { data: snapshot.data, etag: snapshot.etag, updatedAt: snapshot.updatedAt, loading: false, refreshing: false, accessDenied: false, offline: Boolean(snapshot.offline) });
  }
}
type ReadOptions = { force?: boolean; freshForMs?: number; route?: string; priority?: number; background?: boolean; signal?: AbortSignal };
export async function refreshAppLocalResource<T>(scope: string, name: string, args: Record<string, unknown> = {}, options: ReadOptions = {}): Promise<void> {
  if (options.signal?.aborted) return;
  const { key, cell } = cellFor(scope, name, args);
  const route = options.route ?? (typeof location === "undefined" || name.startsWith("shell.") ? undefined : location.pathname + location.search);
  if (cell.pending) {
    if (!options.background) readPriorityScheduler.promote(scope, cell.context.key, route, options.priority ?? 0);
    return cell.pending;
  }
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
  const pathname = typeof location === "undefined" ? undefined : location.pathname + location.search;
  const generation = typeof window === "undefined" ? undefined : window.__reylumiAppLocalContext?.generation;
  const hostEpoch = typeof window === "undefined" ? undefined : window.__reylumiAppLocalContext?.scopeEpoch;
  const wasActive = cell.active > 0;
  const currentCancellationRead = (signal: AbortSignal) => !signal.aborted && epoch === started && cell.epoch === started && cell.revision === revision && cells.get(key) === cell
    && (!wasActive || cell.active > 0) && (typeof location === "undefined" ? pathname === undefined : location.pathname + location.search === pathname)
    && (typeof window === "undefined" || window.__reylumiAppLocalContext?.generation === generation && window.__reylumiAppLocalContext?.scopeEpoch === hostEpoch);
  // Only small named reads fit the native GET transport with ample URL margin.
  // Long reads use POST bodies and must not be automatically replayed here.
  const cancellationGet = JSON.stringify(args).length <= 256 && scope.length <= 128
    && new URLSearchParams({ name, args: JSON.stringify(stable(args)), scope }).toString().length <= 1000;
  recordExperienceTrace("cache.refresh", { source: "app-local", fresh: Boolean(retained?.fresh), trigger: options.force === false ? "unknown" : "manual", ...traceResource(name, args) });
  emit(cell, { refreshing: true, error: undefined });
  let deniedRead: unknown;
  cell.pending = (async () => {
    // Oversize/evicted data can remain in a mounted view. Supply that snapshot
    // for a conditional read without claiming it is fresh merely by showing it.
    if (!appLocalResourceCache.get(cell.context) && cell.state.data !== undefined) {
      appLocalResourceCache.seed(cell.context, { schemaVersion: 1, status: 200, scope, data: cell.state.data, etag: cell.state.etag ?? "", updatedAt: cell.state.updatedAt, offline: cell.state.offline } satisfies AppLocalRead<unknown>, { freshForMs: 0 }, cell.state.updatedAt, cell.state.etag);
    }
    let transportValidatedAt: number | undefined;
    let acceptedReadTrace: ReturnType<typeof appLocalReadTraceFields> = {}, acceptedReadStatus: number | undefined;
    const snapshot = await appLocalResourceCache.load<AppLocalRead<T>>(cell.context, async ({ signal, etag, cached }) => {
      const category = readResourceCategory(cell.context.key), began = Date.now();
      const operation = nextExperienceTraceOperation();
      recordExperienceTrace("cache.read.start", { source: "app-local", operation, ...traceResource(name, args) });
      try {
        let revalidatedCancellation = false;
        const read = async () => {
          const controller = new AbortController();
          const cancel = () => controller.abort();
          // A foreground observer joining a preload now owns that same read.
          const cancelSpeculation = () => { if (!cell.active) controller.abort(); };
          signal.addEventListener("abort", cancel, { once: true });
          options.signal?.addEventListener("abort", cancelSpeculation, { once: true });
          if (signal.aborted || options.signal?.aborted && !cell.active) controller.abort();
          const phase = ["staff", "bookings", "waiting", "financials", "extras"].indexOf(String(args.phase));
          const priority = options.priority ?? (name === "shell.navigation" ? 5 : name.startsWith("shell.") ? 40 : phase >= 0 ? 10 + phase : 0);
          try { return await readPriorityScheduler.run({ scope, key: cell.context.key, route,
            priority, background: options.background,
            signal: controller.signal, run: queuedSignal => host.read<T>(name, args, { scope, etag: etag ?? cell.state.etag, signal: queuedSignal }) });
          } finally { signal.removeEventListener("abort", cancel); options.signal?.removeEventListener("abort", cancelSpeculation); }
        };
        const next = await read().catch(error => {
          if (!isAppLocalContextCancellation(error)) throw error;
          if (!currentCancellationRead(signal)) throw new ExperienceResourceInvalidatedError();
          if (!host.isNative || !cancellationGet) throw error;
          revalidatedCancellation = true;
          recordExperienceTrace("cache.join", { source: "app-local", status: -999, contextReason: "late-reply", ...traceResource(name, args) });
          return read();
        });
        if (revalidatedCancellation && !currentCancellationRead(signal)) throw new ExperienceResourceInvalidatedError();
        recordExperienceTrace("cache.read.end", { source: "app-local", operation, status: next.status, offline: Boolean(next.offline), durationMs: Date.now() - began, ...traceResource(name, args), ...appLocalReadTraceFields(next) });
        if (epoch !== started || cell.epoch !== started || cell.revision !== revision || cells.get(key) !== cell || next.scope !== scope) throw new ExperienceResourceInvalidatedError();
        acceptedReadTrace = appLocalReadTraceFields(next); acceptedReadStatus = next.status;
        transportValidatedAt = next.offline ? next.updatedAt : Date.now();
        const previous = cached ?? (cell.state.data === undefined ? undefined : { schemaVersion: 1, status: 200, scope, data: cell.state.data as T, etag: cell.state.etag ?? "", updatedAt: cell.state.updatedAt, offline: cell.state.offline } as AppLocalRead<T>);
        if (next.status === 304) {
          if (!previous) throw new Error("The saved page must be loaded again");
          recordReadRequest(category, "not-modified", Date.now() - began);
          return { data: { ...previous, offline: next.offline }, etag: next.etag || previous.etag, validatedAt: transportValidatedAt };
        }
        if (next.data === undefined) throw new Error("The page update was incomplete");
        // A delayed transport cannot replace a newer accepted page seed.
        const accepted = previous && !previous.offline && previous.updatedAt > next.updatedAt ? previous : next;
        recordReadRequest(category, "network", Date.now() - began);
        return { data: accepted, etag: accepted.etag, validatedAt: transportValidatedAt };
      } catch (error) {
        const status = (error as { status?: number })?.status;
        recordExperienceTrace("cache.read.end", { source: "app-local", operation, status, contextReason: appLocalContextFailureReason(error), reason: signal.aborted ? "reset" : status === 401 ? "identity" : status === 403 ? "permissions" : status === 409 ? "scope" : "transient", durationMs: Date.now() - began, ...traceResource(name, args), ...appLocalReadTraceFields(error) });
        recordReadRequest(category, signal.aborted ? "aborted" : [401,403,409].includes(status ?? 0) ? "access-denied" : "error", Date.now() - began);
        throw error;
      }
    }, { freshForMs: options.freshForMs ?? 30_000, force: options.force !== false || cell.invalidated });
    if (epoch !== started || cell.revision !== revision || cells.get(key) !== cell || !appLocalResourceCache.isAvailable(cell.context)) return;
    cell.invalidated = false;
    cell.validatedAt = appLocalResourceCache.get(cell.context)?.updatedAt ?? transportValidatedAt ?? cell.validatedAt;
    if (snapshot.updatedAt >= cell.state.updatedAt || cell.state.offline && !snapshot.offline) {
      cell.deliveryRevision++;
      emit(cell, { data: snapshot.data, etag: snapshot.etag, updatedAt: snapshot.updatedAt, loading: false, refreshing: false, accessDenied: false, offline: Boolean(snapshot.offline) });
      recordExperienceTrace("cache.accept", { source: "app-local", status: acceptedReadStatus, offline: Boolean(snapshot.offline), ...traceResource(name, args), ...acceptedReadTrace });
    }
    // Native retains only envelopes it fetched and authorized itself. JavaScript
    // cannot manufacture a private native snapshot through a cache-write bridge.
    if (appLocalReadIsDurable(name) && !host.isNative && !snapshot.offline && isExperienceSnapshotAuthorized(scope) && getExperienceOfflineGrant(scope)) await writeExperienceSnapshot({ scope, domain: resourceDomain(name), params: args, data: snapshot.data, revision: snapshot.etag, updatedAt: snapshot.updatedAt });
  })().catch(error => {
    if (epoch !== started || cell.revision !== revision || error instanceof ExperienceResourceInvalidatedError || cells.get(key) !== cell) return;
    if ([401, 403, 409].includes(error?.status)) deniedRead = error;
    // 403 remains conservative: it may denote account suspension as well as
    // a relationship denial. Only unambiguous scoped outcomes are narrowed.
    if ([401, 403].includes(error?.status)) clearAppLocalRoleResources();
    else if ([404, 409].includes(error?.status)) clearAppLocalRoleResources(scope);
    if (error?.status === 409) {
      // A stale request scope is not proof that the account expired. Withdraw
      // its DTOs, then let entry join the current authority read without
      // cancelling that read or another workspace's resources.
      resetAppLocalResources(scope);
      window.dispatchEvent(new CustomEvent("reylumi:app-local-scope-conflict", { detail: { reason: "stale-scope", status: 409, scope } }));
      return;
    }
    if (error?.status === 401 || error?.status === 403 && name.startsWith("staff.")) { resetAppLocalResources(); window.dispatchEvent(new CustomEvent("reylumi:app-local-access-changed", { detail: { reason: "resource", status: error.status, scope } })); return; }
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
    if ((error as { name?: string })?.name === "AbortError") { emit(cell, { loading: false, refreshing: false }); return; }
    emit(cell, { error: isAppLocalContextCancellation(error) ? "The app changed while loading. Please try again." : error instanceof Error ? error.message : "Could not update this page", loading: false, refreshing: false });
  }).finally(() => { if (epoch === started && cells.get(key) === cell) { cell.pending = undefined; if (cell.state.refreshing) emit(cell, { refreshing: false }); if (cell.revalidate) { cell.revalidate = false; if (cell.active) void refreshAppLocalResource(scope, name, args); } } });
  await cell.pending;
  if (options.background && deniedRead) throw deniedRead;
}

/** Local restoration gets a short head start, never a 25s bridge callback gate.
 * Its delivery revision still prevents a late disk snapshot replacing a new read.
 */
async function restoreBeforeRefresh(scope: string, name: string, args: Record<string, unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([hydrateAppLocalResource(scope, name, args), new Promise<void>(resolve => { timer = setTimeout(resolve, 60); })]);
  if (timer) clearTimeout(timer);
}

/** Named, scoped reads only. Returns the accepted DTO for dependent prefetch work. */
export async function prefetchAppLocalResource<T>(scope: string, name: string, args: Record<string, unknown> = {}, options: ReadOptions = {}): Promise<T | undefined> {
  if (!appLocalReadIsDurable(name) || options.signal?.aborted) return undefined;
  try {
  const started = epoch, original = cellFor(scope, name, args);
  await restoreBeforeRefresh(scope, name, args);
  if (started !== epoch || options.signal?.aborted || cells.get(original.key) !== original.cell) throw new DOMException("Read context changed", "AbortError");
  await refreshAppLocalResource<T>(scope, name, args, { ...options, force: false, background: true, priority: options.priority ?? 100 });
  const { cell, key } = original;
  if (started !== epoch || options.signal?.aborted || cells.get(key) !== cell) throw new DOMException("Read context changed", "AbortError");
  if (cell.state.accessDenied) throw Object.assign(new Error("Access changed"), { status: 403 });
  const accepted = appLocalResourceCache.get<AppLocalRead<T>>(cell.context);
  // A failed online shell refresh may leave useful older UI on screen, but
  // must not fan out date/permission-dependent reads from that stale snapshot.
  if (cell.state.error || !accepted?.fresh || accepted.data.offline) return undefined;
  return cell.state.data as T | undefined;
  } finally {
    // Unvisited DTOs belong to the bounded read cache. React cells must not
    // accidentally keep an evicted/oversize background response alive forever.
    // Mounted and Activity-retained views keep their existing state and drafts.
    for (const [key, cell] of cells) if (!cell.active && !cell.listeners.size && !cell.pending && !appLocalResourceCache.get(cell.context)) cells.delete(key);
  }
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
    void restoreBeforeRefresh(actualScope, name, JSON.parse(signature)).then(ensureFresh);
    const unsubscribe = subscribeReadRefresh(ensureFresh);
    return () => { alive = false; release(); unsubscribe(); };
  }, [actualScope, name, signature, options.enabled, options.refreshAfterMs, cell, refresh, available]);
  return { ...state, data: available ? state.data : undefined, refresh, available };
}
