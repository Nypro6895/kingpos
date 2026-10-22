import { isCatalogPartition, isServicesCatalog, SERVICES_CATALOG_TTL_MS, type CatalogPartition, type ServicesCatalog } from "./services-catalog-cache";

export const SERVICES_CATALOG_ADMISSION_MS = 30_000;
export type CatalogState = { phase: "checking" | "cache" | "fresh" | "unavailable"; data?: ServicesCatalog; updatedAt?: number; error?: string; stale?: boolean; run: number };
export type CatalogStore = {
  observeAccount(viewerId: string, accountId: string): Promise<void>;
  read(partition: CatalogPartition): Promise<{ data: ServicesCatalog; updatedAt: number } | null>;
  write(partition: CatalogPartition, data: ServicesCatalog, updatedAt?: number): Promise<boolean>;
  purge(): Promise<void>;
  removeScope(scope: string): Promise<void>;
};
export type CatalogMetric = { name: "admission-ready" | "cache-ready" | "fresh-data-ready"; durationMs: number; run: number };

/** No persisted authority, speculative display or offline writes. One active context owns every continuation. */
export function createServicesCatalogController(options: {
  scope: string; store: CatalogStore;
  admit(signal: AbortSignal): Promise<CatalogPartition>;
  fetchFresh(partition: CatalogPartition, signal: AbortSignal): Promise<ServicesCatalog>;
  now?: () => number; monotonic?: () => number;
  metric?: (metric: CatalogMetric) => void;
}) {
  const now = options.now ?? Date.now, monotonic = options.monotonic ?? (() => performance.now());
  let state: CatalogState = { phase: "checking", run: 0 }, epoch = 0;
  let presentationValidUntil = 0;
  let refreshStarted = 0;
  let request: AbortController | undefined, expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const emit = (next: CatalogState) => { state = next; for (const listener of listeners) listener(); };
  const stop = () => { ++epoch; request?.abort(); request = undefined; if (expiry) clearTimeout(expiry); expiry = undefined; };
  const invalidate = (purge = false) => {
    stop(); emit({ phase: "unavailable", error: "Connect to verify your access.", run: epoch });
    return purge ? options.store.purge() : Promise.resolve();
  };
  async function refresh() {
    stop(); const run = epoch, started = monotonic(), admissionStarted = now(); refreshStarted = started; request = new AbortController(); const signal = request.signal;
    emit({ phase: "checking", run });
    let validUntil = 0, fresh = false;
    let admitted: CatalogPartition | undefined;
    let cached: Promise<void> | undefined;
    const current = () => run === epoch && !signal.aborted;
    const allowed = () => current() && now() < validUntil;
    try {
      const partition = await options.admit(signal);
      if (!current()) return;
      if (!isCatalogPartition(partition) || partition.scope !== options.scope) throw new Error("Workspace changed. Open Services again.");
      admitted = partition;
      validUntil = admissionStarted + SERVICES_CATALOG_ADMISSION_MS;
      presentationValidUntil = validUntil;
      if (now() >= validUntil) throw new Error("Access verification expired.");
      options.metric?.({ name: "admission-ready", durationMs: monotonic() - started, run });
      // Expiry withdraws synchronously in this document; focus/resume checks again.
      expiry = setTimeout(() => { if (current()) void invalidate(); }, validUntil - now());
      await options.store.observeAccount(partition.viewerId, partition.accountId).catch(() => {});
      if (!allowed()) { if (current()) await invalidate(); return; }
      cached = options.store.read(partition).then(value => {
        if (allowed() && !fresh && value && Number.isFinite(value.updatedAt) && value.updatedAt <= now() && value.updatedAt + SERVICES_CATALOG_TTL_MS > now() && isServicesCatalog(value.data)) {
          presentationValidUntil = Math.min(validUntil, value.updatedAt + SERVICES_CATALOG_TTL_MS);
          if (expiry) clearTimeout(expiry);
          expiry = setTimeout(() => { if (current()) void invalidate(); }, presentationValidUntil - now());
          emit({ phase: "cache", data: value.data, updatedAt: value.updatedAt, run });
          options.metric?.({ name: "cache-ready", durationMs: monotonic() - started, run });
        }
      }).catch(() => {});
      const data = await options.fetchFresh(partition, signal);
      if (!allowed()) { if (current()) await invalidate(); return; }
      if (!isServicesCatalog(data)) throw Object.assign(new Error("Services could not be loaded."), { invalidData: true });
      fresh = true;
      presentationValidUntil = validUntil;
      if (expiry) clearTimeout(expiry);
      expiry = setTimeout(() => { if (current()) void invalidate(); }, validUntil - now());
      emit({ phase: "fresh", data, updatedAt: now(), run });
      options.metric?.({ name: "fresh-data-ready", durationMs: monotonic() - started, run });
      // A slow read may never overwrite the freshly fetched response.
      await cached;
      if (allowed()) await options.store.write(partition, data, now()).catch(() => false);
    } catch (error) {
      if (!current()) return;
      const failure = error as { status?: number; kind?: string; invalidData?: boolean } | null;
      const status = failure?.status;
      const deny = async (code: number) => {
        await invalidate();
        if (code === 401) await options.store.purge();
        else await options.store.removeScope(options.scope);
      };
      if (status && [401, 403, 404, 409].includes(status)) { await deny(status); return; }
      if (failure?.invalidData) { await invalidate(); await options.store.removeScope(options.scope); return; }
      // A known transport failure may arrive before the bounded disk read.
      // Let that already-admitted read finish; its callback still checks the
      // request epoch, admission deadline, catalog TTL and projection. Denials
      // above never wait for storage, and this wait cannot renew authority.
      if (admitted && allowed() && !state.data && (failure?.kind === "network" || failure?.kind === "timeout")) {
        await cached;
        if (!current()) return;
      }
      // A transport failure is not a permission denial. Keep only this already
      // admitted, unexpired read-only projection; never extend its authority.
      if (admitted && allowed() && now() < presentationValidUntil && state.data) {
        if (failure?.kind === "network" || failure?.kind === "timeout") {
          emit({ ...state, stale: true, error: "Could not update services. Showing previously loaded details." }); return;
        }
        // R6 can encode final authority rejection as HTTP 503. Do not classify
        // that ambiguous server response as transport loss or change auth policy.
        const retained = state; fresh = true;
        emit({ phase: "checking", run });
        try {
          const confirmation = await options.admit(signal);
          if (!allowed() || now() >= presentationValidUntil) { if (current()) await invalidate(); return; }
          if (!isCatalogPartition(confirmation) || (Object.keys(admitted) as (keyof CatalogPartition)[]).some(key => confirmation[key] !== admitted![key])) { await deny(409); return; }
          emit({ ...retained, stale: true, error: "Could not update services. Showing previously loaded details." }); return;
        } catch (confirmationError) {
          if (!current()) return;
          const code = (confirmationError as { status?: number } | null)?.status;
          if (code && [401, 403, 404, 409].includes(code)) { await deny(code); return; }
        }
      }
      // Unknown/expired admission withdraws presentation, but is not evidence
      // that otherwise valid durable data must be erased.
      await invalidate();
    }
  }
  return {
    refresh, invalidate,
    getStartedAt: () => refreshStarted,
    getSnapshot: () => {
      // Timers can be throttled in a background tab. A retained Activity must
      // never paint old private rows while its reveal effect is still pending.
      if (state.data && now() >= presentationValidUntil) state = { phase: "unavailable", error: "Connect to verify your access.", run: epoch };
      return state;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { stop(); state = { phase: "checking", run: epoch }; listeners.clear(); },
  };
}
