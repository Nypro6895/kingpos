"use client";

import { getServicesCatalogStore, invalidateServicesCatalog, observeServicesCatalogScope, servicesCatalogScopeActive, servicesCatalogActiveScope } from "./services-catalog-runtime";

// This sidecar only withdraws data and binds storage to the native session. It
// never creates display permission; the controller still needs fresh admission.
type NativeMetadata = { generation: string; scopeEpoch: number };
type Detail = Record<string, unknown>;
const object = (value: unknown): value is Detail => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 128;
const metadata = (value: unknown): value is NativeMetadata => object(value) && text(value.generation) && Number.isSafeInteger(value.scopeEpoch) && (value.scopeEpoch as number) >= 0;
let installed: { enabled: boolean; dispose: () => void } | undefined;

export function installServicesCatalogNativeLifecycle(enabled = true): () => void {
  if (typeof window === "undefined" || !window.__reylumiAppLocalTransport || !metadata(window.__reylumiAppLocalContext)) return () => {};
  if (installed?.enabled === enabled) return installed.dispose;
  installed?.dispose();
  if (!enabled) {
    invalidateServicesCatalog("reset");
    const dispose = () => { if (installed?.dispose === dispose) installed = undefined; };
    installed = { enabled, dispose };
    return dispose;
  }

  let generation = window.__reylumiAppLocalContext.generation;
  let scope: string | undefined, viewer: string | undefined;
  const bind = (value: string) => { void getServicesCatalogStore().observeNativeGeneration(value).catch(() => {}); };
  bind(generation);
  const withdraw = () => { observeServicesCatalogScope(null); invalidateServicesCatalog("workspace"); };
  const purge = () => { withdraw(); invalidateServicesCatalog("identity"); scope = undefined; viewer = undefined; };
  const deny = (status: number, target?: string) => {
    if (status === 401) { purge(); return; }
    target ??= servicesCatalogActiveScope() ?? scope;
    if (target) {
      void getServicesCatalogStore().removeScope(target).catch(() => {});
      if (servicesCatalogScopeActive(target) || (!servicesCatalogActiveScope() && target === scope)) withdraw();
    } else { withdraw(); }
  };
  const accept = (detail: Detail) => {
    const current = window.__reylumiAppLocalContext;
    if (!metadata(current)) { withdraw(); return false; }
    const provided = object(detail.host) ? detail.host : detail;
    // Native metadata is already filtered by the bridge. Ignore late events as
    // well so an old request cannot withdraw a newer salon's presentation.
    if (typeof provided.generation === "string" && provided.generation !== current.generation) return false;
    if (typeof provided.scopeEpoch === "number" && provided.scopeEpoch < current.scopeEpoch) return false;
    if (current.generation !== generation) { generation = current.generation; purge(); bind(generation); }
    return true;
  };
  const context = (detail: Detail) => {
    const value = detail.context;
    if (!object(value)) return;
    const nextScope = text(value.scope) ? value.scope : undefined;
    const nextViewer = text(value.viewerId) ? value.viewerId : undefined;
    if (detail.grantStatus === 401 || value.authenticated === false) { purge(); return; }
    if ([403, 404, 409].includes(Number(detail.grantStatus))) { deny(Number(detail.grantStatus), nextScope ?? scope); return; }
    if (viewer !== undefined && nextViewer !== viewer) purge();
    else if ((scope !== undefined && nextScope !== scope) || (scope === undefined && nextScope && servicesCatalogActiveScope() && !servicesCatalogScopeActive(nextScope))) withdraw();
    // Identical online context is common during the native read barrier; do not
    // abort an admitted request or clear the active scope on that event.
    scope = nextScope; viewer = nextViewer;
  };
  const listeners = new Map<string, EventListener>();
  const listen = (name: string, handle: (detail: Detail) => void) => {
    const listener: EventListener = event => {
      const value = (event as CustomEvent<unknown>).detail;
      const detail = object(value) ? value : {};
      try { if (accept(detail)) handle(detail); } catch { /* Optional cache must not interfere with native lifecycle. */ }
    };
    listeners.set(name, listener); window.addEventListener(name, listener);
  };
  listen("reylumi:app-local-context", context);
  listen("reylumi:app-local-reset", detail => {
    if ([401, 403, 404, 409].includes(Number(detail.status))) { deny(Number(detail.status), text(detail.scope) ? detail.scope : undefined); return; }
    if (detail.reason === "context") { withdraw(); return; }
    purge();
  });
  listen("reylumi:app-local-scope-conflict", detail => deny(409, text(detail.scope) ? detail.scope : undefined));
  listen("reylumi:app-local-access-changed", detail => {
    if ([401, 403, 404, 409].includes(Number(detail.status))) deny(Number(detail.status), text(detail.scope) ? detail.scope : undefined);
    else withdraw();
  });
  const dispose = () => {
    for (const [name, listener] of listeners) window.removeEventListener(name, listener);
    if (installed?.dispose === dispose) installed = undefined;
  };
  installed = { enabled, dispose };
  return dispose;
}
