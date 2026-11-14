"use client";
import { portableDevice, iosPortableDevice } from "./portable-device-storage";

export type PortableOperation = {
  sequence?: number; id: string; scope: string; kind: "receipt" | "attendance" | "booking" | "visit";
  occurredAt: string; payload: Record<string, unknown>;
  state: "pending" | "synced" | "attention" | "cancelled"; result?: Record<string, unknown>; error?: string;
  cancelledAt?: string;
  syncedAt?: string; rejected?: boolean;
};
export const PORTABLE_OPERATIONS_CHANGED = "kingpos:operations-changed";
let database: Promise<IDBDatabase> | undefined;
const workers = new Map<string, Promise<void>>();
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("kingpos-portable-operations", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("operations", { keyPath: "sequence", autoIncrement: true });
      request.result.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Unable to save on this device."));
  });
}
function changed() { window.dispatchEvent(new Event(PORTABLE_OPERATIONS_CHANGED)); }
/** Copy legacy WebKit outbox entries before native POS editors can mount.
 * IDs, payloads and ordering stay unchanged, including uncertain upload outcomes.
 * The source remains intact and a native terminal record always wins on retry.
 */
export async function migratePortableOperationsToNative(scope: string): Promise<void> {
  const native = iosPortableDevice();
  if (!native || typeof indexedDB === "undefined") return;
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    if (!databases.some(item => item.name === "kingpos-portable-operations")) return;
  }
  const source = await db();
  const legacy = await new Promise<PortableOperation[]>((resolve, reject) => {
    const request = source.transaction("operations").objectStore("operations").getAll();
    request.onsuccess = () => resolve(request.result.filter((operation: PortableOperation) => operation.scope === scope));
    request.onerror = () => reject(request.error);
  });
  if (!legacy.length) return;
  const existing = await native.request<PortableOperation[]>({ action: "operations.list", scope });
  const ids = new Set(existing.map(operation => operation.id.toLowerCase()));
  for (const operation of legacy.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))) {
    if (ids.has(operation.id.toLowerCase())) continue;
    let checkpointAt: number | undefined;
    if (operation.kind === "receipt" && typeof operation.payload.localDraftKey === "string") {
      checkpointAt = await new Promise<number | undefined>((resolve, reject) => {
        const request = source.transaction("meta").objectStore("meta").get(`receipt:${scope}:${operation.payload.localDraftKey}`);
        request.onsuccess = () => resolve(typeof request.result === "number" ? request.result : undefined);
        request.onerror = () => reject(request.error);
      });
    }
    const result = await native.request<{ ok: boolean }>({ action: "operations.import", scope, operation, ...(checkpointAt === undefined ? {} : { checkpointAt }) });
    if (result?.ok !== true) throw new Error("Could not preserve this iPad's saved tickets. Please try again.");
    ids.add(operation.id.toLowerCase());
  }
}
export async function listPortableOperations(scope: string): Promise<PortableOperation[]> {
  const device = portableDevice();
  if (device) return device.operations.list(scope);
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("operations").objectStore("operations").getAll();
    request.onsuccess = () => resolve(request.result.filter((op: PortableOperation) => op.scope === scope));
    request.onerror = () => reject(request.error);
  });
}
export async function portableCheckpoint(scope: string, draftKey: string): Promise<number> {
  const device = portableDevice();
  if (device) return device.operations.checkpoint(scope, draftKey);
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("meta").objectStore("meta").get(`receipt:${scope}:${draftKey}`);
    request.onsuccess = () => resolve(request.result ?? 0);
    request.onerror = () => reject(request.error);
  });
}
export async function savePortableOperation(scope: string, kind: PortableOperation["kind"], payload: Record<string, unknown>) {
  const operation: PortableOperation = { id: crypto.randomUUID(), scope, kind,
    occurredAt: new Date().toISOString(), payload: structuredClone(payload), state: "pending" };
  const device = portableDevice();
  if (device) {
    await device.operations.save(operation);
    changed();
    void syncPortableOperations(scope).catch(() => {});
    return operation;
  }
  const database = await db();
  const tx = database.transaction(["operations", "meta"], "readwrite", { durability: "strict" });
  const done = complete(tx);
  tx.objectStore("operations").add(operation);
  // A crash after commit and before clearing the form cannot resurrect a
  // submitted cart. The checkpoint and queued ticket commit atomically.
  if (kind === "receipt" && typeof payload.localDraftKey === "string") tx.objectStore("meta").put(Date.now(), `receipt:${scope}:${payload.localDraftKey}`);
  await done;
  changed();
  void syncPortableOperations(scope).catch(() => {});
  return operation;
}
async function update(operation: PortableOperation) {
  const device = portableDevice();
  if (device) { await device.operations.save(operation); changed(); return; }
  const database = await db(); const tx = database.transaction("operations", "readwrite");
  const done = complete(tx); tx.objectStore("operations").put(operation); await done; changed();
}
export async function syncPortableOperations(scope: string): Promise<void> {
  if (!navigator.onLine) return;
  if (workers.has(scope)) return workers.get(scope);
  const run = async () => {
    const blockedStaff = new Set<string>();
    for (const operation of await listPortableOperations(scope)) {
      if (operation.state === "synced" || operation.state === "cancelled") continue;
      if (!navigator.onLine) break;
      // Keep dependent staff work ordered while letting unrelated work upload.
      if (operation.state === "attention" && !(operation.kind === "attendance" && operation.error === "Staff is already checked in.")) {
        if (operation.kind === "attendance") blockedStaff.add(String(operation.payload.staffId));
        continue;
      }
      if (operation.kind === "attendance" && blockedStaff.has(String(operation.payload.staffId))) continue;
      if (operation.kind === "receipt" && Array.isArray(operation.payload.lines) &&
          operation.payload.lines.some(line => blockedStaff.has(String(line.staffId)))) continue;
      try {
        const response = await fetch(scope.startsWith("owner:") ? "/api/pos/owner/operations" : "/api/pos/portable/operations", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operation), signal: AbortSignal.timeout(15_000), cache: "no-store",
        });
        if (response.status >= 500 || response.status === 429 || response.status === 401) break;
        if (!response.ok) { await update({ ...operation, state: "attention", error: "Unable to upload this item." }); if (operation.kind === "attendance") blockedStaff.add(String(operation.payload.staffId)); continue; }
        const result = await response.json();
        if (result.kind === "retry") break;
        if (result.kind !== "ok") {
          await update({ ...operation, state: "attention", rejected: result.rejected === true, error: result.message ?? "Please review this item." }); if (operation.kind === "attendance") blockedStaff.add(String(operation.payload.staffId)); continue;
        }
        await update({ ...operation, state: "synced", syncedAt: new Date().toISOString(), result: result.data, error: undefined });
      } catch { break; }
    }
  };
  const running = Promise.resolve(navigator.locks ? navigator.locks.request(`kingpos-operations:${scope}`, run) : run())
    .then(() => {})
    .finally(() => { workers.delete(scope); changed(); });
  workers.set(scope, running);
  return running;
}

export async function retryPortableOperation(scope: string, id: string) {
  await withOperationLock(scope, async () => {
    const operation = (await listPortableOperations(scope)).find(item => item.id === id);
    if (!operation || operation.state !== "attention") return;
    await update({ ...operation, state: "pending", error: undefined });
  });
  await syncPortableOperations(scope);
}

// This business-rule rejection rolls back the receipt transaction. Network
// failures and uncertain upload outcomes must never be treated as cancellable.
export function canCancelPortableOperation(operation: PortableOperation) {
  return operation.state === "attention" &&
    (operation.kind === 'receipt' && operation.error === "Assigned staff must be checked in and working." ||
      operation.rejected===true && /^(This customer visit already has a ticket\.|This customer visit is no longer available\.|This staff member changed on another device\.)/.test(operation.error??''));
}
async function withOperationLock(scope: string, action: () => Promise<void>) {
  if (navigator.locks) return navigator.locks.request(`kingpos-operations:${scope}`, action);
  await workers.get(scope);
  return action();
}
export async function cancelPortableOperation(scope: string, id: string) {
  await withOperationLock(scope, async () => {
    const operation = (await listPortableOperations(scope)).find(item => item.id === id);
    if (!operation || !canCancelPortableOperation(operation)) throw new Error("This ticket cannot be cancelled. Check its upload status first.");
    await update({ ...operation, state: "cancelled", cancelledAt: new Date().toISOString() });
  });
}
