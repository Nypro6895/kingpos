/** A limited private read cache, never an authorization source or a command queue.
 * Callers must freshly admit services.view before observeAccount/read on every entry.
 * It intentionally does not share the global offline-lease store: switching salons
 * invalidates that store, whereas this pilot preserves only this catalog's partitions.
 */
export const SERVICES_CATALOG_DATABASE = "reylumi-services-catalog-pilot-v1";
export const SERVICES_CATALOG_STORE = "records";
export const SERVICES_CATALOG_TTL_MS = 15 * 60 * 1000;
export const SERVICES_CATALOG_MAX_ENTRIES = 8;
export const SERVICES_CATALOG_MAX_BYTES = 1024 * 1024;
export const SERVICES_CATALOG_MAX_RECORD_BYTES = 256 * 1024;

export type CatalogPartition = { viewerId: string; accountId: string; salonId: string; scope: string; permissionRevision: string };
export type CatalogService = { id: string; name: string; category: string | null; description: string | null; basePrice: number; durationMinutes: number };
export type ServicesCatalog = { services: CatalogService[] };
type AccountRow = { id: "account"; schemaVersion: 1; viewerId: string; accountId: string; generation: string };
type NativeGenerationRow = { id: "native-generation"; schemaVersion: 1; generation: string };
type AdmissionRow = { id: string; schemaVersion: 1; partition: CatalogPartition; usedAt: number };
type CatalogRow = { id: string; schemaVersion: 1; partition: CatalogPartition; data: ServicesCatalog; updatedAt: number; expiresAt: number; usedAt: number };
export type ServicesCatalogStore = ReturnType<typeof createServicesCatalogStore>;

const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const text = (value: unknown, max: number, nonempty = false): value is string => typeof value === "string" && value.length <= max && (!nonempty || value.trim().length > 0);
const nullableText = (value: unknown, max: number) => value === null || text(value, max);
export function isCatalogPartition(value: unknown): value is CatalogPartition {
  return plain(value) && keys(value, ["viewerId", "accountId", "salonId", "scope", "permissionRevision"])
    && ["viewerId", "accountId", "salonId"].every(key => text(value[key], 128, true))
    && text(value.scope, 128, true) && text(value.permissionRevision, 8192, true);
}
/** Exact projection only: future additions to manager DTOs cannot silently persist. */
export function isServicesCatalog(value: unknown): value is ServicesCatalog {
  if (!plain(value) || !keys(value, ["services"]) || !Array.isArray(value.services) || value.services.length > 500) return false;
  const ids = new Set<string>();
  return value.services.every(service => {
    if (!plain(service) || !keys(service, ["id", "name", "category", "description", "basePrice", "durationMinutes"])
      || !text(service.id, 128, true) || ids.has(service.id) || !text(service.name, 512, true)
      || !nullableText(service.category, 256) || !nullableText(service.description, 4096)
      || typeof service.basePrice !== "number" || !Number.isFinite(service.basePrice) || service.basePrice < 0
      || typeof service.durationMinutes !== "number" || !Number.isFinite(service.durationMinutes) || service.durationMinutes < 0) return false;
    ids.add(service.id); return true;
  });
}
const identity = (partition: CatalogPartition) => JSON.stringify([partition.viewerId, partition.accountId, partition.salonId, partition.scope, partition.permissionRevision]);
const accountKey = (viewerId: string, accountId: string) => JSON.stringify([viewerId, accountId]);
const catalogId = (partition: CatalogPartition) => "catalog:" + identity(partition);
const admissionId = (partition: CatalogPartition) => "admission:" + JSON.stringify([partition.viewerId, partition.accountId, partition.salonId]);
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const validTime = (value: unknown, now: number): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= now;
function validRow(value: unknown, now: number): value is CatalogRow {
  return plain(value) && keys(value, ["id", "schemaVersion", "partition", "data", "updatedAt", "expiresAt", "usedAt"])
    && value.schemaVersion === 1 && isCatalogPartition(value.partition) && value.id === catalogId(value.partition)
    && isServicesCatalog(value.data) && validTime(value.updatedAt, now) && validTime(value.usedAt, now)
    && value.expiresAt === value.updatedAt + SERVICES_CATALOG_TTL_MS && value.expiresAt > now
    && byteLength(value) <= SERVICES_CATALOG_MAX_RECORD_BYTES;
}
function validAdmission(value: unknown, now: number): value is AdmissionRow {
  return plain(value) && keys(value, ["id", "schemaVersion", "partition", "usedAt"])
    && value.schemaVersion === 1 && isCatalogPartition(value.partition) && value.id === admissionId(value.partition)
    && validTime(value.usedAt, now);
}
function validAccount(value: unknown): value is AccountRow {
  return plain(value) && keys(value, ["id", "schemaVersion", "viewerId", "accountId", "generation"]) && value.id === "account" && value.schemaVersion === 1
    && text(value.viewerId, 128, true) && text(value.accountId, 128, true) && text(value.generation, 128, true);
}
function validNativeGeneration(value: unknown): value is NativeGenerationRow {
  return plain(value) && keys(value, ["id", "schemaVersion", "generation"]) && value.id === "native-generation"
    && value.schemaVersion === 1 && text(value.generation, 128, true);
}

export function createServicesCatalogStore(options: { indexedDB?: IDBFactory; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let factory: IDBFactory | undefined;
  try { factory = options.indexedDB ?? (typeof indexedDB === "undefined" ? undefined : indexedDB); }
  catch { /* Some denied origins throw even when resolving the IndexedDB getter. */ }
  let opening: Promise<IDBDatabase> | undefined, connection: IDBDatabase | undefined;
  let queue: Promise<unknown> = Promise.resolve(), epoch = 0, observedAccount: string | undefined, observedGeneration: string | undefined;
  let nativeRequired = false, nativeGeneration: string | undefined, nativeRevision = 0;
  const serialize = <T,>(work: () => Promise<T>) => { const next = queue.catch(() => {}).then(work); queue = next; return next; };
  function db(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new Error("Catalog storage unavailable"));
    opening ??= new Promise((resolve, reject) => {
      let settled = false;
      const request = factory.open(SERVICES_CATALOG_DATABASE, 1);
      const fail = () => { if (settled) return; settled = true; opening = undefined; reject(new Error("Catalog storage unavailable")); };
      const timeout = setTimeout(fail, 1500);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(SERVICES_CATALOG_STORE)) request.result.createObjectStore(SERVICES_CATALOG_STORE, { keyPath: "id" }); };
      request.onblocked = request.onerror = () => { clearTimeout(timeout); fail(); };
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (settled) { request.result.close(); return; }
        settled = true; connection = request.result;
        connection.onversionchange = () => { connection?.close(); connection = undefined; opening = undefined; epoch++; };
        resolve(connection);
      };
    });
    return opening;
  }
  async function transaction<T>(work: (rows: unknown[], store: IDBObjectStore, recordKeys: IDBValidKey[]) => T): Promise<T> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(SERVICES_CATALOG_STORE, "readwrite"), store = tx.objectStore(SERVICES_CATALOG_STORE);
      let value: T;
      const timeout = setTimeout(() => { try { tx.abort(); } catch { /* Already completed. */ } reject(new Error("Catalog storage timed out")); }, 1500);
      tx.oncomplete = () => { clearTimeout(timeout); resolve(value); };
      tx.onabort = tx.onerror = () => { clearTimeout(timeout); reject(tx.error ?? new Error("Catalog storage unavailable")); };
      const request = store.getAll(), recordKeys = store.getAllKeys();
      // Requests execute in order in this transaction. Use actual primary keys
      // so malformed values cannot escape pruning by hiding/changing their id.
      recordKeys.onsuccess = () => { try { value = work(request.result, store, recordKeys.result); } catch { tx.abort(); } };
    });
  }
  const sameAccount = (rows: unknown[], partition: CatalogPartition, generation: string | undefined) => {
    const account = rows.find(row => plain(row) && row.id === "account");
    return nativeMatches(rows) && validAccount(account) && account.viewerId === partition.viewerId && account.accountId === partition.accountId
      && observedAccount === accountKey(partition.viewerId, partition.accountId) && account.generation === generation;
  };
  const nativeMatches = (rows: unknown[]) => !nativeRequired || rows.some(row => validNativeGeneration(row) && row.generation === nativeGeneration);
  function clearPrivate(rows: unknown[], store: IDBObjectStore) {
    const marker = rows.find(validNativeGeneration);
    store.clear();
    // This marker carries no authority or account information. Keep it to fence
    // another process still using the previous native session generation.
    if (marker) store.put(marker);
  }
  function fenceObservedInstances(rows: unknown[], store: IDBObjectStore) {
    const account = rows.find(validAccount);
    if (!account) return;
    const generation = crypto.randomUUID();
    if (observedAccount === accountKey(account.viewerId, account.accountId) && observedGeneration === account.generation) observedGeneration = generation;
    // This is a local write fence, never a permission/revocation version. Other
    // observed instances must observeAccount again after a fresh admission.
    store.put({ ...account, generation });
  }
  function prune(rows: unknown[], store: IDBObjectStore, time: number, recordKeys: IDBValidKey[]): CatalogRow[] {
    const live: CatalogRow[] = [];
    for (const [index, row] of rows.entries()) {
      if (validRow(row, time)) live.push(row);
      else if (!validAccount(row) && !validNativeGeneration(row) && !validAdmission(row, time)) store.delete(recordKeys[index]);
    }
    return live;
  }
  return {
    async observeNativeGeneration(generation: string): Promise<void> {
      nativeRequired = true;
      const next = text(generation, 128, true) ? generation : undefined;
      if (nativeGeneration !== next || !next) { epoch++; observedAccount = undefined; observedGeneration = undefined; }
      nativeGeneration = next;
      const started = ++nativeRevision;
      await serialize(async () => {
        if (started !== nativeRevision) return;
        try { await transaction((rows, store) => {
          if (started !== nativeRevision) return;
          const marker = rows.find(validNativeGeneration);
          if (!next || marker?.generation !== next) store.clear();
          if (next) store.put({ id: "native-generation", schemaVersion: 1, generation: next } satisfies NativeGenerationRow);
        }); } catch { /* A missing binding makes every cache read/write fail closed. */ }
      });
    },
    async observeAccount(viewerId: string, accountId: string): Promise<void> {
      const next = accountKey(viewerId, accountId);
      // Every newly admitted entry retires work started by the previous entry.
      epoch++; observedAccount = next; observedGeneration = undefined;
      const started = epoch;
      await serialize(async () => {
        if (started !== epoch) return;
        try {
          await transaction((rows, store) => {
            if (started !== epoch) return;
            if (!nativeMatches(rows)) return;
            if (!text(viewerId, 128, true) || !text(accountId, 128, true)) { clearPrivate(rows, store); observedAccount = undefined; return; }
            const account = rows.find(row => plain(row) && row.id === "account");
            const matching = validAccount(account) && account.viewerId === viewerId && account.accountId === accountId;
            if (!matching) clearPrivate(rows, store);
            observedGeneration = matching ? account.generation : crypto.randomUUID();
            store.put({ id: "account", schemaVersion: 1, viewerId, accountId, generation: observedGeneration } satisfies AccountRow);
          });
        } catch { /* Optional storage never blocks the live resource. */ }
      });
    },
    async read(partition: CatalogPartition): Promise<{ data: ServicesCatalog; updatedAt: number } | null> {
      if (!isCatalogPartition(partition)) return null;
      partition = { ...partition };
      const started = epoch, generation = observedGeneration;
      return serialize(async () => {
        if (started !== epoch) return null;
        try {
          const result = await transaction((rows, store, recordKeys) => {
            if (started !== epoch || !sameAccount(rows, partition, generation)) return null;
            const time = now(), live = prune(rows, store, time, recordKeys), admittedId = admissionId(partition);
            // A fresh caller admission replaces older permission/scope markers for
            // this salon. Old network writers may not install their own marker.
            for (const row of live) if (admissionId(row.partition) === admittedId && identity(row.partition) !== identity(partition)) store.delete(row.id);
            const admissions = rows.filter((row): row is AdmissionRow => validAdmission(row, time) && row.id !== admittedId).sort((a, b) => a.usedAt - b.usedAt);
            while (admissions.length >= SERVICES_CATALOG_MAX_ENTRIES) {
              const removed = admissions.shift()!; store.delete(removed.id);
              for (const row of live) if (admissionId(row.partition) === removed.id) store.delete(row.id);
            }
            const marker: AdmissionRow = { id: admittedId, schemaVersion: 1, partition, usedAt: time };
            store.put(marker);
            const keptIds = new Set([admittedId, ...admissions.map(row => row.id)]);
            const kept = live.filter(row => keptIds.has(admissionId(row.partition)) && (admissionId(row.partition) !== admittedId || identity(row.partition) === identity(partition))).sort((a, b) => a.usedAt - b.usedAt);
            let bytes = rows.filter(row => validAccount(row) || validNativeGeneration(row)).reduce<number>((sum, row) => sum + byteLength(row), 0) + byteLength(marker) + admissions.reduce((sum, row) => sum + byteLength(row), 0) + kept.reduce((sum, row) => sum + byteLength(row), 0);
            while (bytes > SERVICES_CATALOG_MAX_BYTES) { const removed = kept.shift(); if (!removed) break; store.delete(removed.id); bytes -= byteLength(removed); }
            const row = kept.find(row => row.id === catalogId(partition));
            if (!row) return null;
            store.put({ ...row, usedAt: time });
            return { data: row.data, updatedAt: row.updatedAt };
          });
          const completedAt = now();
          return started === epoch && result && validTime(result.updatedAt, completedAt) && result.updatedAt + SERVICES_CATALOG_TTL_MS > completedAt ? result : null;
        } catch { return null; }
      });
    },
    async write(partition: CatalogPartition, data: ServicesCatalog, updatedAt = now()): Promise<boolean> {
      if (!isCatalogPartition(partition) || !isServicesCatalog(data) || !validTime(updatedAt, now())) return false;
      partition = { ...partition };
      const started = epoch, generation = observedGeneration;
      const row: CatalogRow = { id: catalogId(partition), schemaVersion: 1, partition, data, updatedAt, expiresAt: updatedAt + SERVICES_CATALOG_TTL_MS, usedAt: now() };
      if (byteLength(row) > SERVICES_CATALOG_MAX_RECORD_BYTES) return false;
      // Copy at call time so a caller cannot add private fields while queued.
      const saved = JSON.parse(JSON.stringify(row)) as CatalogRow;
      return serialize(async () => {
        if (started !== epoch) return false;
        try {
          const written = await transaction((rows, store, recordKeys) => {
            const time = now();
            if (started !== epoch || !sameAccount(rows, partition, generation) || !validRow(saved, time)) return false;
            const admission = rows.find(row => plain(row) && row.id === admissionId(partition));
            if (!validAdmission(admission, time) || identity(admission.partition) !== identity(partition)) return false;
            const live = prune(rows, store, time, recordKeys), previous = live.find(row => row.id === saved.id);
            if (previous && previous.updatedAt > saved.updatedAt) return false;
            const retained = live.filter(row => row.id !== saved.id).sort((a, b) => a.usedAt - b.usedAt);
            const metadataBytes = rows.filter(row => validAccount(row) || validNativeGeneration(row) || validAdmission(row, time)).reduce<number>((sum, row) => sum + byteLength(row), 0);
            let bytes = retained.reduce((sum, row) => sum + byteLength(row), byteLength(saved) + metadataBytes);
            while (retained.length >= SERVICES_CATALOG_MAX_ENTRIES || bytes > SERVICES_CATALOG_MAX_BYTES) {
              const removed = retained.shift(); if (!removed) return false;
              store.delete(removed.id); bytes -= byteLength(removed);
            }
            store.put(saved); return true;
          });
          return started === epoch && written;
        } catch { return false; }
      });
    },
    async remove(partition: CatalogPartition): Promise<void> {
      epoch++;
      if (!isCatalogPartition(partition)) return;
      partition = { ...partition };
      await serialize(async () => {
        try { await transaction((rows, store) => {
          fenceObservedInstances(rows, store);
          for (const row of rows) if (plain(row) && isCatalogPartition(row.partition) && admissionId(row.partition) === admissionId(partition) && typeof row.id === "string") store.delete(row.id);
        }); } catch { /* Epoch still rejects this instance's pending replies. */ }
      });
    },
    async removeScope(scope: string): Promise<void> {
      epoch++;
      if (!text(scope, 128, true)) return;
      await serialize(async () => {
        try { await transaction((rows, store) => {
          fenceObservedInstances(rows, store);
          // The caller may have only the rejected request's scope. Preserve other
          // salons and any newer admission marker for this salon's new scope.
          for (const row of rows) if (plain(row) && isCatalogPartition(row.partition) && row.partition.scope === scope && typeof row.id === "string") store.delete(row.id);
        }); } catch { /* The controller still withdraws the rejected view. */ }
      });
    },
    async removeSalon(salonId: string): Promise<void> {
      epoch++;
      if (!text(salonId, 128, true)) return;
      await serialize(async () => {
        try { await transaction((rows, store) => {
          const account = rows.find(validAccount);
          if (!account) return;
          fenceObservedInstances(rows, store);
          // A successful online edit can enter through a different role without
          // restoring this pilot. Remove every scope for the exact salon in the
          // persisted account; an in-memory admission is not needed for deletion.
          for (const row of rows) if (plain(row) && isCatalogPartition(row.partition)
            && row.partition.viewerId === account.viewerId && row.partition.accountId === account.accountId
            && row.partition.salonId === salonId && typeof row.id === "string") store.delete(row.id);
        }); } catch { /* Presentation is separately invalidated even if optional disk removal fails. */ }
      });
    },
    async purge(): Promise<void> {
      epoch++; observedAccount = undefined; observedGeneration = undefined;
      await serialize(async () => { try { await transaction((rows, store) => { clearPrivate(rows, store); }); } catch { /* Fresh admission remains mandatory even when disk removal fails. */ } });
    },
    close(): void { epoch++; observedAccount = undefined; observedGeneration = undefined; connection?.close(); connection = undefined; opening = undefined; },
  };
}
