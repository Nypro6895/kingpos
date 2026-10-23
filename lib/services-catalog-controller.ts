import { isCatalogPartition, isServicesCatalog, SERVICES_CATALOG_TTL_MS, type CatalogPartition, type ServicesCatalog } from "./services-catalog-cache";

export const SERVICES_CATALOG_ADMISSION_MS = 30_000;
// Optional storage gets at most the existing open1.5s + transaction1.5s budget,
// including queue delay. This is a liveness cap, not a performance claim.
const SERVICES_CATALOG_STORAGE_WAIT_MS = 3_000;

function waitForOptionalStorage<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<{ ok: true; value: T } | { ok: false }> {
  if (signal.aborted) return Promise.resolve({ ok: false });
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: { ok: true; value: T } | { ok: false }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", unavailable);
      resolve(result);
    };
    const unavailable = () => finish({ ok: false });
    const timer = setTimeout(unavailable, SERVICES_CATALOG_STORAGE_WAIT_MS);
    signal.addEventListener("abort", unavailable, { once: true });
    if (signal.aborted) { unavailable(); return; }
    // Timing out ignores late delivery; the store still owns epoch/generation
    // fencing for work already queued. No auth/network request is cancelled here.
    try { void operation().then(value => finish({ ok: true, value }), unavailable); }
    catch { unavailable(); }
  });
}

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
  const wallNow = options.now ?? Date.now, monotonic = options.monotonic ?? (() => performance.now());
  let state: CatalogState = { phase: "checking", run: 0 }, epoch = 0;
  let presentationValidUntil = 0;
  let presentationClock = () => Number.POSITIVE_INFINITY;
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
    stop(); const run = epoch, started = monotonic(), admissionStarted = wallNow(); refreshStarted = started; request = new AbortController(); const signal = request.signal;
    let observedWall = admissionStarted, observedMonotonic = started, validityTime = admissionStarted;
    let invalidClock = !Number.isFinite(admissionStarted) || !Number.isFinite(started);
    // Validity advances with elapsed monotonic time even if wall time stalls.
    // A sampled clock regression is latched for this run; a later200 cannot
    // revive it after the clock recovers. Neither clock/admission is persisted.
    const now = () => {
      const wall = wallNow(), elapsed = monotonic();
      if (!Number.isFinite(wall) || !Number.isFinite(elapsed) || wall < observedWall || elapsed < observedMonotonic) invalidClock = true;
      validityTime = Math.max(wall, validityTime + elapsed - observedMonotonic);
      observedWall = wall; observedMonotonic = elapsed;
      return invalidClock ? Number.POSITIVE_INFINITY : validityTime;
    };
    presentationClock = now;
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
      const observed = await waitForOptionalStorage(() => options.store.observeAccount(partition.viewerId, partition.accountId), signal);
      if (!allowed()) { if (current()) await invalidate(); return; }
      let cacheUsable = observed.ok;
      cached = cacheUsable ? waitForOptionalStorage(() => options.store.read(partition), signal).then(result => {
        if (!result.ok) { cacheUsable = false; return; }
        const value = result.value;
        if (allowed() && !fresh && value && Number.isFinite(value.updatedAt) && value.updatedAt <= now() && value.updatedAt + SERVICES_CATALOG_TTL_MS > now() && isServicesCatalog(value.data)) {
          presentationValidUntil = Math.min(validUntil, value.updatedAt + SERVICES_CATALOG_TTL_MS);
          if (expiry) clearTimeout(expiry);
          expiry = setTimeout(() => { if (current()) void invalidate(); }, presentationValidUntil - now());
          emit({ phase: "cache", data: value.data, updatedAt: value.updatedAt, run });
          options.metric?.({ name: "cache-ready", durationMs: monotonic() - started, run });
        }
      }).catch(() => {}) : Promise.resolve();
      const data = await options.fetchFresh(partition, signal);
      if (!allowed()) { if (current()) await invalidate(); return; }
      if (!isServicesCatalog(data)) throw Object.assign(new Error("Services could not be loaded."), { invalidData: true });
      fresh = true;
      presentationValidUntil = validUntil;
      if (expiry) clearTimeout(expiry);
      expiry = setTimeout(() => { if (current()) void invalidate(); }, validUntil - now());
      // Store only an observed wall timestamp, never the synthesized validity
      // clock, which may be ahead of wall time after a stalled clock.
      emit({ phase: "fresh", data, updatedAt: observedWall, run });
      options.metric?.({ name: "fresh-data-ready", durationMs: monotonic() - started, run });
      // A slow read may never overwrite the freshly fetched response.
      await cached;
      if (allowed() && cacheUsable) await waitForOptionalStorage(() => options.store.write(partition, data, observedWall), signal);
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
      const expired = presentationClock() >= presentationValidUntil;
      if (state.data && expired) state = { phase: "unavailable", error: "Connect to verify your access.", run: epoch };
      return state;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { stop(); state = { phase: "checking", run: epoch }; listeners.clear(); },
  };
}
