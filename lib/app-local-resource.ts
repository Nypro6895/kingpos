"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getAppLocalHost, type AppLocalRead } from "./app-local-host";
import { getExperienceOfflineGrant, isExperienceSnapshotAuthorized, readExperienceSnapshot, writeExperienceSnapshot, removeExperienceSnapshot } from "./experience-persistent-cache";
import { appLocalReadIsDurable } from "./app-local-data-policy";
import { appLocalCommandAffectsResource } from "./app-local-resource-invalidation";

export type AppLocalResourceState<T> = { data?: T; etag?: string; updatedAt: number; loading: boolean; refreshing: boolean; error?: string };
type Cell = { state: AppLocalResourceState<unknown>; listeners: Set<() => void>; active: number; checkedAt: number; invalidated?: boolean; epoch: number; revision: number; revalidate?: boolean; controller?: AbortController; hydrated?: Promise<void>; pending?: Promise<void> };
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
    cell = { state: { updatedAt: 0, loading: true, refreshing: false }, listeners: new Set(), active: 0, checkedAt: 0, epoch, revision: 0 }; cells.set(key, cell);
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
  epoch++;
  for (const cell of cells.values()) { cell.controller?.abort(); cell.epoch = epoch; emit(cell, { data: undefined, etag: undefined, updatedAt: 0, loading: false, refreshing: false, error: undefined }); }
  cells.clear();
}
if (typeof window !== "undefined") {
  for (const event of ["reylumi:app-local-reset", "reylumi:experience-reset", "reylumi:offline-clear", "reylumi:offline-grant-invalidated", "reylumi:experience-access-changed"]) window.addEventListener(event, resetAppLocalResources);
  window.addEventListener("reylumi:app-local-command-complete", event => {
    const { scope, source } = (event as CustomEvent<{ scope?: string; source?: string }>).detail ?? {};
    for (const [key, cell] of cells) {
      const [owner, name, args] = JSON.parse(key) as [string, string, Record<string, unknown>];
      if (scope !== owner || !appLocalCommandAffectsResource(name, source)) continue;
      cell.invalidated = true;
      cell.revision++;
      if (cell.pending) { cell.revalidate = true; cell.controller?.abort(); }
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
  cell.hydrated = (async () => {
    if (!appLocalReadIsDurable(name)) return;
    const saved = host.isNative
      ? await host.cache<{ data: T; revision?: string; updatedAt: number }>("get", { name, args, scope })
      : await readExperienceSnapshot<T>({ scope, domain: resourceDomain(name), params: args });
    if (epoch !== started || cell.epoch !== started || cell.revision !== revision || cells.get(key) !== cell) return;
    if (saved && saved.updatedAt >= cell.state.updatedAt) emit(cell, { data: saved.data, etag: saved.revision, updatedAt: saved.updatedAt, loading: false });
  })().catch(() => {}).finally(() => { if (epoch === started && cells.get(key) === cell && cell.state.data === undefined) emit(cell, { loading: false }); });
  return cell.hydrated;
}
export function seedAppLocalResource<T>(scope: string, name: string, args: Record<string, unknown>, snapshot: AppLocalRead<T>) {
  if (snapshot.scope !== scope || snapshot.status !== 200 || snapshot.data === undefined) return;
  const { cell } = cellFor(scope, name, args);
  if (snapshot.updatedAt >= cell.state.updatedAt) {
    cell.checkedAt = snapshot.offline ? snapshot.updatedAt : Date.now(); cell.invalidated = false;
    emit(cell, { data: snapshot.data, etag: snapshot.etag, updatedAt: snapshot.updatedAt, loading: false, refreshing: false });
  }
}
export async function refreshAppLocalResource<T>(scope: string, name: string, args: Record<string, unknown> = {}): Promise<void> {
  const { key, cell } = cellFor(scope, name, args); if (cell.pending) return cell.pending;
  const started = epoch, revision = cell.revision, host = getAppLocalHost(); cell.controller = new AbortController();
  emit(cell, { refreshing: true, error: undefined });
  cell.pending = (async () => {
    const snapshot = await host.read<T>(name, args, { scope, etag: cell.state.etag, signal: cell.controller?.signal });
    if (epoch !== started || cell.epoch !== started || cell.revision !== revision || cells.get(key) !== cell || snapshot.scope !== scope) return;
    if (snapshot.status === 304) {
      if (cell.state.data === undefined) throw new Error("The saved page must be loaded again");
      // Data version and last successful validation are separate. A 304 must
      // stop an unchanged retained page from being stale on every return.
      cell.checkedAt = snapshot.offline ? snapshot.updatedAt : Date.now(); cell.invalidated = false;
      emit(cell, { refreshing: false, loading: false }); return;
    }
    if (snapshot.data === undefined) throw new Error("The page update was incomplete");
    seedAppLocalResource(scope, name, args, snapshot);
    // Native retains only envelopes it fetched and authorized itself. JavaScript
    // cannot manufacture a private native snapshot through a cache-write bridge.
    if (appLocalReadIsDurable(name) && !host.isNative && !snapshot.offline && isExperienceSnapshotAuthorized(scope) && getExperienceOfflineGrant(scope)) await writeExperienceSnapshot({ scope, domain: resourceDomain(name), params: args, data: snapshot.data, revision: snapshot.etag, updatedAt: snapshot.updatedAt });
  })().catch(error => {
    if (epoch !== started || cell.revision !== revision || cell.controller?.signal.aborted || cells.get(key) !== cell) return;
    if (error?.status === 401 || error?.status === 403 || error?.status === 409) { resetAppLocalResources(); window.dispatchEvent(new CustomEvent("reylumi:app-local-access-changed", { detail: { reason: "resource", status: error.status, scope } })); return; }
    if (error?.status === 404) {
      cell.revision++;
      // A confirmed deletion or revoked relationship cannot keep its old DTO
      // visible. A timeout leaves the last authorized snapshot available.
      emit(cell, { data: undefined, etag: undefined, updatedAt: 0, error: "This page is no longer available.", loading: false, refreshing: false });
      if (host.isNative) void host.cache("remove", { name, args, scope }).catch(() => {});
      else void removeExperienceSnapshot({ scope, domain: resourceDomain(name), params: args });
      return;
    }
    emit(cell, { error: error instanceof Error ? error.message : "Could not update this page", loading: false, refreshing: false });
  }).finally(() => { if (epoch === started && cells.get(key) === cell) { cell.pending = undefined; cell.controller = undefined; if (cell.state.refreshing) emit(cell, { refreshing: false }); if (cell.revalidate) { cell.revalidate = false; if (cell.active) void refreshAppLocalResource(scope, name, args); } } });
  return cell.pending;
}

export function useAppLocalResource<T>(scope: string | undefined, name: string, args: Record<string, unknown> = {}, options: { enabled?: boolean; refreshAfterMs?: number } = {}) {
  const signature = JSON.stringify(stable(args)), actualScope = scope ?? "", { cell } = cellFor(actualScope, name, args);
  const subscribe = useCallback((changed: () => void) => { cell.listeners.add(changed); return () => { cell.listeners.delete(changed); }; }, [cell]);
  const snapshot = useCallback(() => cell.state as AppLocalResourceState<T>, [cell]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const refresh = useCallback(() => actualScope ? refreshAppLocalResource<T>(actualScope, name, JSON.parse(signature)) : Promise.resolve(), [actualScope, name, signature]);
  useEffect(() => {
    if (!actualScope || options.enabled === false) return;
    const release = retainActiveResource(cell);
    let alive = true;
    void hydrateAppLocalResource<T>(actualScope, name, JSON.parse(signature)).then(() => { if (alive && navigator.onLine && (cell.invalidated || Date.now() - Math.max(cell.state.updatedAt, cell.checkedAt) >= (options.refreshAfterMs ?? 30_000))) void refresh(); });
    const resume = () => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); };
    window.addEventListener("online", resume); window.addEventListener("reylumi:foreground", resume);
    return () => { alive = false; release(); window.removeEventListener("online", resume); window.removeEventListener("reylumi:foreground", resume); };
  }, [actualScope, name, signature, options.enabled, options.refreshAfterMs, cell, refresh]);
  return { ...state, refresh };
}
