"use client";

import { isExperienceOfflineGrant, type ExperienceOfflineGrant } from "./experience-offline-policy";
import { isTrustedStaffOfflineBinding } from "./staff-offline-binding";

const DATABASE = "reylumi-experience-readmodels-v1";
const STORE = "records";
const MAX_ENTRIES = 128;
const MAX_GRANTS = 32;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_RECORD = 2 * 1024 * 1024;
const MAX_RETAIN = 7 * 24 * 60 * 60 * 1000;
const GENERATION_KEY = "reylumi:offline-device-generation:v1";
export const EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT = "reylumi:offline-authorization";
export type ExperienceSnapshotContext = { scope: string; domain: string; params?: unknown };
export type ExperiencePersistentSnapshot<T> = { data: T; updatedAt: number; retainUntil: number; revision?: string };
type RecordRow = ExperiencePersistentSnapshot<unknown> & { id: string; scope: string; authorizationRevision: string; bytes: number; usedAt: number };
type GrantRow = { id: string; grant: ExperienceOfflineGrant };
let database: Promise<IDBDatabase> | undefined;
let epoch = 0;
let clearingEpoch = 0;
let writes = Promise.resolve();
let volatileGeneration: string | undefined;
const grants = new Map<string, Map<string, ExperienceOfflineGrant>>();
const onlineChecks = new Map<string, number>();

function db(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => { const value = request.result; value.onversionchange = () => { value.close(); database = undefined; }; resolve(value); };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("Device storage is busy")); };
  });
  return database;
}
function complete(tx: IDBTransaction) { return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Device storage unavailable")); }); }
function result<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function rows() { const data = await db(); return result(data.transaction(STORE).objectStore(STORE).getAll()) as Promise<(RecordRow | GrantRow)[]>; }
function serialized<T>(operation: () => Promise<T>): Promise<T> { const next = writes.catch(() => {}).then(operation); writes = next.then(() => {}, () => {}); return next; }
function event() { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT)); }

export function getExperienceDeviceGeneration(): string {
  try { const existing = localStorage.getItem(GENERATION_KEY); if (existing && /^[\w-]{16,100}$/.test(existing)) return volatileGeneration = existing; } catch { /* Optional storage. */ }
  if (volatileGeneration) return volatileGeneration;
  volatileGeneration = crypto.randomUUID();
  try { localStorage.setItem(GENERATION_KEY, volatileGeneration); } catch { /* This process can still use its memory generation. */ }
  return volatileGeneration;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function identity(context: ExperienceSnapshotContext) {
  if (!context.scope || context.scope.length > 8192 || !/^[a-z][a-z0-9:-]{0,79}$/.test(context.domain)) throw new Error("Invalid saved view");
  const key = JSON.stringify([context.scope, context.domain, stable(context.params ?? null)]);
  if (key.length > 16384) throw new Error("Saved view key is too large");
  return "snapshot:" + key;
}
function safeJson(value: unknown) {
  return JSON.stringify(value, (key, item) => {
    if (/^(?:access_token|refresh_token|client_secret|password|passcode|sealedPasscode|cardNumber|card_number|cvc|cvv)$/i.test(key)) throw new Error("Credentials do not belong in saved views");
    return item;
  });
}

function authority(grant: ExperienceOfflineGrant): string { return grant.kind === "staff" ? "staff" : grant.kind === "portable" ? "portable" : "base"; }
function grantKey(grant: ExperienceOfflineGrant): string { return JSON.stringify([authority(grant), grant.path]); }
function rememberGrant(grant: ExperienceOfflineGrant): void {
  for (const scope of grant.scopes) {
    const allowed = grants.get(scope) ?? new Map<string, ExperienceOfflineGrant>();
    allowed.set(grantKey(grant), grant);
    const retained = [...allowed.entries()].sort(([, a], [, b]) => b.issuedAt - a.issuedAt).slice(0, MAX_GRANTS);
    grants.set(scope, new Map(retained));
  }
}
function activeGrants(scope: string): ExperienceOfflineGrant[] {
  const allowed = grants.get(scope); if (!allowed) return [];
  const generation = getExperienceDeviceGeneration();
  for (const [key, grant] of allowed) if (!isExperienceOfflineGrant(grant, { scope, generation })) allowed.delete(key);
  if (!allowed.size) grants.delete(scope);
  return [...allowed.values()].sort((a, b) => b.issuedAt - a.issuedAt);
}
export function isExperienceSnapshotAuthorized(scope: string): boolean { return activeGrants(scope).length > 0; }
export function getExperienceOfflineGrant(scope: string, kind?: "staff" | "portable" | "base"): ExperienceOfflineGrant | null {
  const allowed = activeGrants(scope);
  if (kind) return allowed.find(grant => authority(grant) === kind) ?? null;
  const currentPath = typeof location !== "undefined" ? (location.pathname === "/pos/customer-display" ? "/pos/portable" : location.pathname + location.search) : "";
  return allowed.find(grant => grant.path === currentPath) ?? allowed[0] ?? null;
}
/** A display lease authorizes only its exact canonical path, never another cached page. */
export function getExperienceOfflineGrantForPath(scope: string, path: string): ExperienceOfflineGrant | null {
  return activeGrants(scope).find(grant => grant.path === path) ?? null;
}
function snapshotGrant({ scope, domain, params }: ExperienceSnapshotContext): ExperienceOfflineGrant | undefined {
  return activeGrants(scope).find(grant => {
    if (/^(?:staff-|draft:(?:staff-service|service-relay))/.test(domain)) {
      const staffId = params && typeof params === "object" ? (params as { staffId?: unknown }).staffId : null;
      return typeof staffId === "string" && grant.kind === "staff" && Boolean(grant.viewerId && grant.salonId) && isTrustedStaffOfflineBinding(grant.staffBinding, { staffId, viewerId: grant.viewerId!, salonId: grant.salonId! });
    }
    if (grant.kind === "owner") return true;
    if (grant.kind === "portable") return domain.startsWith("portable-");
    return /^(?:customer-|market(?:-|$)|notification(?:s|-)|public-|draft:(?:customer-|public-booking))/.test(domain);
  });
}
export function isExperienceSnapshotContextAuthorized(context: ExperienceSnapshotContext): boolean { return Boolean(snapshotGrant(context)); }
export function markExperienceScopeOnlineValidated(scope: string): void {
  onlineChecks.set(scope, Date.now());
  const grant = getExperienceOfflineGrant(scope);
  if (grant?.scope === scope) for (const allowed of grant.scopes) onlineChecks.set(allowed, Date.now());
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("reylumi:experience-online-authorized", { detail: { scope } }));
}
export function isExperienceScopeOnlineValidated(scope: string): boolean { return navigator.onLine && Date.now() - (onlineChecks.get(scope) ?? 0) < 30_000; }
/** Accept only the grant returned by a fresh authorized GET or a worker-verified boot. */
export async function acceptExperienceOfflineGrant(grant: ExperienceOfflineGrant): Promise<boolean> {
  if (!isExperienceOfflineGrant(grant, { generation: getExperienceDeviceGeneration() })) return false;
  const previous = [...(grants.get(grant.scope)?.values() ?? [])].find(value => authority(value) === authority(grant) && value.scope === grant.scope);
  if (previous?.scope === grant.scope && previous.grantRevision !== grant.grantRevision) {
    void clearExperienceSnapshots();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("reylumi:offline-grant-invalidated"));
      window.dispatchEvent(new CustomEvent("reylumi:experience-access-changed", { detail: { status: 409 } }));
    }
    return false;
  }
  const started = epoch;
  rememberGrant(grant);
  event();
  try {
    await serialized(async () => {
      if (started !== epoch) return;
      const all = await rows(); if (started !== epoch) return;
      const data = await db(); if (started !== epoch) return;
      const tx = data.transaction(STORE, "readwrite"); const done = complete(tx);
      const store = tx.objectStore(STORE), id = "grant:" + grant.path;
      const retained = all.filter((row): row is GrantRow => "grant" in row && row.id !== id && isExperienceOfflineGrant(row.grant, { generation: getExperienceDeviceGeneration() })).sort((a, b) => b.grant.issuedAt - a.grant.issuedAt).slice(0, MAX_GRANTS - 1);
      const keep = new Set(retained.map(row => row.id));
      for (const row of all) if ("grant" in row && row.id !== id && !keep.has(row.id)) store.delete(row.id);
      store.put({ id, grant } satisfies GrantRow); await done;
    });
  } catch { /* The active view remains usable when durable storage is unavailable. */ }
  return started === epoch;
}
export async function loadExperienceOfflineGrant(scope: string, path?: string, signal?: AbortSignal): Promise<ExperienceOfflineGrant | null> {
  if (clearingEpoch || signal?.aborted) return null;
  const started = epoch;
  try {
    const all = await rows();
    if (started !== epoch || signal?.aborted) return null;
    const candidates = all.filter((row): row is GrantRow => "grant" in row && isExperienceOfflineGrant(row.grant, { scope, path, generation: getExperienceDeviceGeneration() })).sort((a, b) => b.grant.issuedAt - a.grant.issuedAt);
    const grant = candidates[0]?.grant;
    if (!grant) return null;
    // A delayed older disk lease cannot replace a newer online admission.
    if ([...(grants.get(grant.scope)?.values() ?? [])].some(value => authority(value) === authority(grant) && value.scope === grant.scope && value.grantRevision !== grant.grantRevision)) return null;
    rememberGrant(grant);
    event(); return grant;
  } catch { return null; }
}
export async function readExperienceSnapshot<T>(context: ExperienceSnapshotContext): Promise<ExperiencePersistentSnapshot<T> | null> {
  if (!isExperienceSnapshotContextAuthorized(context)) return null;
  const started = epoch;
  try {
    const data = await db();
    const row = await result(data.transaction(STORE).objectStore(STORE).get(identity(context))) as RecordRow | undefined;
    if (started !== epoch || !isExperienceSnapshotContextAuthorized(context) || !row || row.scope !== context.scope || row.authorizationRevision !== snapshotGrant(context)?.grantRevision || row.retainUntil <= Date.now()) return null;
    return { data: row.data as T, updatedAt: row.updatedAt, retainUntil: row.retainUntil, revision: row.revision };
  } catch { return null; }
}
export async function writeExperienceSnapshot<T>(context: ExperienceSnapshotContext & { data: T; updatedAt?: number; revision?: string; retainForMs?: number }): Promise<boolean> {
  if (!isExperienceSnapshotContextAuthorized(context)) return false;
  const started = epoch;
  const authorizationRevision = snapshotGrant(context)!.grantRevision;
  try {
    const id = identity(context); const json = safeJson(context.data); if (!json) return false;
    const bytes = (json.length + id.length) * 2 + 256; if (bytes > MAX_RECORD) return false;
    const updatedAt = context.updatedAt ?? Date.now(); if (!Number.isFinite(updatedAt) || updatedAt > Date.now() + 60_000) return false;
    if (context.retainForMs !== undefined && !Number.isFinite(context.retainForMs)) return false;
    const retainUntil = updatedAt + Math.min(MAX_RETAIN, Math.max(0, context.retainForMs ?? MAX_RETAIN));
    return await serialized(async () => {
      if (started !== epoch || !isExperienceSnapshotContextAuthorized(context) || snapshotGrant(context)?.grantRevision !== authorizationRevision || retainUntil <= Date.now()) return false;
      const all = await rows(); const data = await db();
      if (started !== epoch || !isExperienceSnapshotContextAuthorized(context) || snapshotGrant(context)?.grantRevision !== authorizationRevision) return false;
      const existing = all.find((row): row is RecordRow => row.id === id && "scope" in row);
      if (existing && existing.updatedAt > updatedAt) return false;
      const live = all.filter((row): row is RecordRow => "scope" in row && row.id !== id && row.retainUntil > Date.now()).sort((a, b) => a.usedAt - b.usedAt);
      let total = live.reduce((sum, row) => sum + row.bytes, bytes);
      const removed = all.filter((row): row is RecordRow => "scope" in row && row.retainUntil <= Date.now()).map(row => row.id);
      while (live.length >= MAX_ENTRIES || total > MAX_BYTES) { const first = live.shift(); if (!first) break; removed.push(first.id); total -= first.bytes; }
      const tx = data.transaction(STORE, "readwrite"); const done = complete(tx); const store = tx.objectStore(STORE);
      for (const key of removed) store.delete(key);
      store.put({ id, scope: context.scope, authorizationRevision, data: JSON.parse(json), updatedAt, retainUntil, revision: context.revision, bytes, usedAt: Date.now() } satisfies RecordRow);
      await done; return started === epoch && isExperienceSnapshotAuthorized(context.scope);
    });
  } catch { return false; }
}
export async function listExperienceSnapshots(scope: string): Promise<{ id: string; updatedAt: number; retainUntil: number }[]> {
  if (!isExperienceSnapshotAuthorized(scope)) return [];
  const started = epoch;
  try { const all = await rows(); return started === epoch && isExperienceSnapshotAuthorized(scope) ? all.filter((row): row is RecordRow => "scope" in row && row.scope === scope && row.retainUntil > Date.now()).map(({ id, updatedAt, retainUntil }) => ({ id, updatedAt, retainUntil })) : []; } catch { return []; }
}
export async function removeExperienceSnapshot(context: ExperienceSnapshotContext): Promise<void> {
  const started = epoch;
  await serialized(async () => {
    if (started !== epoch || !isExperienceSnapshotContextAuthorized(context)) return;
    try { const data = await db(); if (started !== epoch) return; const tx = data.transaction(STORE, "readwrite"); const done = complete(tx); tx.objectStore(STORE).delete(identity(context)); await done; } catch { /* The current draft remains visible if storage is unavailable. */ }
  });
}
/** Invalidate synchronously before awaiting disk deletion; pending POS commands are in another database. */
export function clearExperienceSnapshots(options: { scope?: string; rotateGeneration?: boolean } = {}): Promise<void> {
  const started = ++epoch; clearingEpoch = started;
  if (options.scope) onlineChecks.delete(options.scope); else onlineChecks.clear();
  if (options.scope) grants.delete(options.scope); else grants.clear();
  if (options.rotateGeneration !== false) { volatileGeneration = crypto.randomUUID(); try { localStorage.setItem(GENERATION_KEY, volatileGeneration); } catch { /* Optional storage. */ } }
  event();
  return serialized(async () => {
    try {
      const all = await rows(); const data = await db(); const tx = data.transaction(STORE, "readwrite"); const done = complete(tx);
      for (const row of all) if (!options.scope || ("scope" in row ? row.scope === options.scope : row.grant.scopes.includes(options.scope))) tx.objectStore(STORE).delete(row.id);
      await done;
    } catch { /* A synchronous epoch still rejects every obsolete reader/writer. */ }
  }).finally(() => { if (clearingEpoch === started) clearingEpoch = 0; });
}
