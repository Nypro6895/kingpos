"use client";

import { getExperienceOfflinePath, isExperienceOfflineGrant, type ExperienceOfflineGrant } from "./experience-offline-policy";
import { acceptExperienceOfflineGrant, clearExperienceSnapshots, getExperienceDeviceGeneration, getExperienceOfflineGrant, getExperienceOfflineGrantForPath, loadExperienceOfflineGrant, markExperienceScopeOnlineValidated } from "./experience-persistent-cache";
import { fetchBoundedGet } from "./bounded-get";
import { nextExperienceTraceOperation, recordExperienceTrace } from "./experience-trace";
import { createExperienceAuthorizedReads } from "./experience-authorized-read";

const preparing = new Map<string, Promise<ExperienceOfflineGrant | null>>();
const authorizing = createExperienceAuthorizedReads<ExperienceOfflineGrant>();
const restoring = createExperienceAuthorizedReads<ExperienceOfflineGrant>();
let epoch = 0;
let bootProofAllowed = true;
let listening = false;
let lastLock: Promise<boolean> = Promise.resolve(true);
function accessChanged(scope?: string, status = 403) { window.dispatchEvent(new CustomEvent("reylumi:experience-access-changed", { detail: { scope, status } })); }
async function workerFor(path: string): Promise<ServiceWorker | null> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  // A /pos/ registration cannot control the bare /pos document.
  const pos = path.startsWith("/pos/"), scope = pos ? "/pos/" : "/", script = pos ? "/portable-sw.js" : "/experience-sw.js";
  let registration = (await navigator.serviceWorker.getRegistrations()).find(value => value.scope === new URL(scope, location.origin).href);
  const existing = registration?.active ?? registration?.waiting ?? registration?.installing;
  if (existing && new URL(existing.scriptURL).pathname !== script) return null;
  if (!navigator.onLine && registration?.active) return registration.active;
  try { registration = await navigator.serviceWorker.register(existing?.scriptURL ?? script, { scope, updateViaCache: "none" }); }
  catch { return registration?.active ?? null; }
  const pending = registration.installing ?? registration.waiting;
  if (!pending) return registration.active;
  return new Promise(resolve => {
    const timer = setTimeout(() => { pending.removeEventListener("statechange", changed); resolve(null); }, 15000);
    const changed = () => { if (pending.state === "activated" && registration?.active) { clearTimeout(timer); pending.removeEventListener("statechange", changed); resolve(registration.active); } else if (pending.state === "redundant") { clearTimeout(timer); pending.removeEventListener("statechange", changed); resolve(null); } };
    pending.addEventListener("statechange", changed); changed();
  });
}
export async function getExperienceOfflineWorker(path: string): Promise<ServiceWorker | null> { return workerFor(path); }
export function getExperienceOfflineAuthorizationPath(): string | null {
  const path = getExperienceOfflinePath(location.pathname + location.search, location.origin);
  if (path) return path;
  const url = new URL(location.href);
  return url.pathname === "/pos/customer-display" && [...url.searchParams.keys()].length === 1 && Boolean(url.searchParams.get("token")) ? "/pos/portable" : null;
}
function request(worker: ServiceWorker, message: object, timeoutMs: number): Promise<{ ok: boolean; grant?: ExperienceOfflineGrant }> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve({ ok: false }); }, timeoutMs);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data ?? { ok: false }); };
    try { worker.postMessage(message, [channel.port2]); } catch { clearTimeout(timer); channel.port1.close(); resolve({ ok: false }); }
  });
}
function installListener() {
  if (listening || !("serviceWorker" in navigator)) return;
  listening = true;
  window.addEventListener("reylumi:offline-grant-invalidated", () => lockExperienceOffline({ rotateGeneration: false, status: 409 }));
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.kind !== "experience-offline-cleared") return;
    lockExperienceOffline({ rotateGeneration: false });
    if (event.data.status) accessChanged(event.data.scope, event.data.status);
  });
}

/** Returns true only for a complete document with every build asset and a valid grant. */
export async function hasPreparedExperiencePath(href: string): Promise<boolean> {
  const path = getExperienceOfflinePath(href, location.origin); if (!path) return false;
  try {
    const started = epoch, worker = await workerFor(path); if (!worker || started !== epoch) return false;
    const result = await request(worker, { kind: "experience-offline-has", path, generation: getExperienceDeviceGeneration() }, 3000);
    return started === epoch && result.ok && isExperienceOfflineGrant(result.grant, { path, generation: getExperienceDeviceGeneration() });
  } catch { return false; }
}
export function prepareExperienceOfflinePath(href: string, options: { scope?: string } = {}): Promise<ExperienceOfflineGrant | null> {
  const path = getExperienceOfflinePath(href, location.origin); if (!path || !navigator.onLine) return Promise.resolve(null);
  const key = JSON.stringify([path, options.scope, getExperienceDeviceGeneration()]);
  if (preparing.has(key)) { recordExperienceTrace("cache.join", { source: "web", reason: "grant" }); return preparing.get(key)!; }
  const started = epoch;
  const traceOperation = nextExperienceTraceOperation(), traceStarted = performance.now();
  recordExperienceTrace("cache.read.start", { source: "web", reason: "grant", operation: traceOperation });
  const run = (async () => {
    try {
      installListener();
      const worker = await workerFor(path); if (!worker || started !== epoch) return null;
      const result = await request(worker, { kind: "experience-offline-prepare", path, scope: options.scope, generation: getExperienceDeviceGeneration(), assets: performance.getEntriesByType("resource").map(entry => entry.name) }, 240000);
      if (started !== epoch || !result.ok || !isExperienceOfflineGrant(result.grant, { path, scope: options.scope, generation: getExperienceDeviceGeneration() })) return null;
      if (!await acceptExperienceOfflineGrant(result.grant)) return null;
      if (started !== epoch) return null;
      markExperienceScopeOnlineValidated(result.grant.scope);
      // Native persists only a bare route hint and expiry after this success ACK.
      if (!new URL(path, location.origin).search) window.dispatchEvent(new CustomEvent("reylumi:offline-ready", { detail: { path, version: 1, expiresAt: new Date(result.grant.expiresAt).toISOString() } }));
      return result.grant;
    } catch { return null; }
  })().finally(() => { recordExperienceTrace("cache.read.end", { source: "web", reason: "grant", operation: traceOperation, durationMs: performance.now() - traceStarted }); if (preparing.get(key) === run) preparing.delete(key); });
  preparing.set(key, run); return run;
}

/** A failed read cannot create authority; only the fresh endpoint response can. */
export function refreshExperienceOfflineAuthorization(href: string, scope: string, signal?: AbortSignal): Promise<ExperienceOfflineGrant | null> {
  const path = getExperienceOfflinePath(href, location.origin) ?? (href === location.pathname + location.search ? getExperienceOfflineAuthorizationPath() : null); if (!path || !navigator.onLine || signal?.aborted) return Promise.resolve(null);
  const started = epoch, generation = getExperienceDeviceGeneration();
  const key = JSON.stringify([scope, path, generation, started]);
  return authorizing.read(key, async signal => {
  if (started !== epoch || signal.aborted) return null;
  const traceOperation = nextExperienceTraceOperation(), traceStarted = performance.now();
  let received = false;
  recordExperienceTrace("auth.start", { source: "web", reason: "grant", operation: traceOperation });
  try {
    const response = await fetchBoundedGet(`/api/experience/offline-context?path=${encodeURIComponent(path)}&generation=${encodeURIComponent(generation)}`, { cache: "no-store", credentials: "same-origin", signal }, { timeoutMs: 10_000, totalTimeoutMs: 10_000, maxAttempts: 1 });
    received = true;
    recordExperienceTrace("auth.end", { source: "web", reason: "grant", status: response.status, operation: traceOperation, durationMs: performance.now() - traceStarted });
    if (started !== epoch || signal.aborted || generation !== getExperienceDeviceGeneration()) return null;
    if (response.status === 401 || response.status === 403) { lockExperienceOffline({ status: response.status }); accessChanged(scope, response.status); return null; }
    if (!response.ok) {
      if (response.status === 503) {
        const unavailable = await response.json().catch(() => null);
        if (started === epoch && !signal.aborted && generation === getExperienceDeviceGeneration() && unavailable?.offlineState === "unconfirmed" && unavailable.scope === scope && getExperienceOfflineGrant(scope, "staff")) { lockExperienceOffline({ status: 409 }); accessChanged(undefined, 409); }
      }
      return null;
    }
    const grant = await response.json();
    if (started !== epoch || signal.aborted || generation !== getExperienceDeviceGeneration() || !isExperienceOfflineGrant(grant, { path, generation })) return null;
    if (!grant.scopes.includes(scope)) { lockExperienceOffline({ status: 409 }); accessChanged(scope, 409); return null; }
    if (!await acceptExperienceOfflineGrant(grant)) return null;
    if (started !== epoch || signal.aborted || generation !== getExperienceDeviceGeneration()) return null;
    markExperienceScopeOnlineValidated(grant.scope); return grant;
  } catch { if (!received) recordExperienceTrace(signal?.aborted ? "auth.abort" : "auth.end", { source: "web", reason: "grant", operation: traceOperation, durationMs: performance.now() - traceStarted }); return null; }
  }, signal, () => recordExperienceTrace("cache.join", { source: "web", reason: "grant" }));
}
export function restoreExperienceOfflineAuthorization(scope: string, signal?: AbortSignal): Promise<ExperienceOfflineGrant | null> {
  const path = getExperienceOfflineAuthorizationPath();
  if (!path || signal?.aborted) return Promise.resolve(null);
  installListener();
  const existing = getExperienceOfflineGrantForPath(scope, path);
  if (existing) return Promise.resolve(existing);
  const started = epoch, generation = getExperienceDeviceGeneration();
  return restoring.read(JSON.stringify([scope, path, generation, started]), async signal => {
  if (started !== epoch || signal.aborted || generation !== getExperienceDeviceGeneration()) return null;
  const traceOperation = nextExperienceTraceOperation(), traceStarted = performance.now();
  recordExperienceTrace("cache.restore.start", { source: "web", reason: "grant", operation: traceOperation });
  let restored = false;
  try {
  installListener();
  const boot = readExperienceOfflineBootGrant(scope);
  const grant = boot.present ? boot.grant && boot.grant.path === path && await acceptExperienceOfflineGrant(boot.grant) ? boot.grant : null : await loadExperienceOfflineGrant(scope, path, signal);
  if (started !== epoch || signal.aborted || generation !== getExperienceDeviceGeneration()) return null;
  restored = Boolean(grant);
  return grant;
  } finally { recordExperienceTrace("cache.restore.end", { source: "web", reason: "grant", operation: traceOperation, changed: restored, durationMs: performance.now() - traceStarted }); }
  }, signal, () => recordExperienceTrace("cache.join", { source: "web", reason: "grant" }));
}
export function readExperienceOfflineBootGrant(scope: string): { present: boolean; grant: ExperienceOfflineGrant | null } {
  const boot = document.getElementById("reylumi-offline-boot");
  if (!boot || !boot.textContent?.trim() || boot.textContent.trim() === "null") return { present: false, grant: null };
  // A lock rejects the cached document's old proof even when its generation is
  // deliberately retained. Only a fresh endpoint grant or new document may win.
  if (!bootProofAllowed) return { present: true, grant: null };
  try {
    const path = getExperienceOfflineAuthorizationPath(), grant: unknown = JSON.parse(boot.textContent);
    return { present: true, grant: path && isExperienceOfflineGrant(grant, { scope, path, generation: getExperienceDeviceGeneration() }) ? grant : null };
  } catch { return { present: true, grant: null }; }
}
export function releaseExperienceOfflineBootGuard(): void { const style = document.getElementById("reylumi-offline-guard") as HTMLStyleElement | null; if (style) style.media = "not all"; }
/** Called directly by every reset, including resets that intentionally suppress DOM events. */
export function lockExperienceOffline(options: { scope?: string; rotateGeneration?: boolean; status?: number } = {}): Promise<boolean> {
  recordExperienceTrace("cache.reset", { source: "web", reason: "grant", status: options.status });
  bootProofAllowed = false;
  epoch++; preparing.clear(); authorizing.reset(); restoring.reset();
  void clearExperienceSnapshots({ scope: options.scope, rotateGeneration: options.rotateGeneration });
  if (typeof window === "undefined") return lastLock = Promise.resolve(true);
  window.dispatchEvent(new CustomEvent("reylumi:offline-clear"));
  if (!("serviceWorker" in navigator)) return lastLock = Promise.resolve(true);
  const controller = navigator.serviceWorker.controller;
  const known = (worker: ServiceWorker) => ["/experience-sw.js", "/portable-sw.js"].includes(new URL(worker.scriptURL).pathname);
  const message = { kind: "experience-offline-lock", status: options.status };
  // Send to the controlling worker synchronously, then await all known realms.
  // A recovery reload must never race the asynchronous private-cache deletion.
  const immediate = controller && known(controller) ? request(controller, message, 3000) : null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const registrations = Promise.race([navigator.serviceWorker.getRegistrations(), new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 3000); })]);
  lastLock = registrations.then(async registrations => {
    if (!registrations) return false;
    const workers = new Set(registrations.map(value => value.active ?? value.waiting ?? value.installing).filter((worker): worker is ServiceWorker => Boolean(worker && known(worker) && worker !== controller)));
    const replies = await Promise.all([...(immediate ? [immediate] : []), ...[...workers].map(worker => request(worker, message, 3000))]);
    return replies.every(reply => reply.ok);
  }).catch(() => false).finally(() => { if (deadline) clearTimeout(deadline); });
  return lastLock;
}
export function waitForExperienceOfflineLock(): Promise<boolean> { return lastLock; }

/** Offline links use complete documents. Next's RSC/action protocol remains network-only. */
export function installExperienceOfflineNavigation(onUnavailable: () => void): () => void {
  let active = true, running = false;
  const click = (event: MouseEvent) => {
    if (navigator.onLine || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target instanceof Element ? event.target : null;
    const anchor = element?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.closest("[data-owner-workspace]") && !anchor.closest("[data-owner-more-popover]") || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
    const path = getExperienceOfflinePath(anchor.href, location.origin); if (!path) return;
    event.preventDefault(); event.stopPropagation();
    if (running) return; running = true;
    void hasPreparedExperiencePath(path).then(prepared => {
      if (!active) return;
      if (prepared) window.location.assign(path); else onUnavailable();
    }).finally(() => { running = false; });
  };
  document.addEventListener("click", click, true);
  return () => { active = false; document.removeEventListener("click", click, true); };
}
