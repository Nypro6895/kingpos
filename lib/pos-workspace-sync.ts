"use client";
import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "./supabase/browser";
import { getPosStaffRealtimeChannel } from "./pos-staff-realtime";
import { canAutomaticallyRefreshRead, subscribeReadRefresh } from "./read-refresh-scheduler";

export type PosResource = "staff" | "tickets" | "booking" | "report" | "waiting" | "settings" | "catalog";
export type PosChange = { resource: PosResource; ids?: string[]; reason?: "poll" | "resume" | "reconnect" | "foreground" };
const all: PosResource[] = ["staff", "tickets", "booking", "report", "waiting", "settings", "catalog"];
const sourceResources: Record<string, PosResource[]> = {
  attendance: ["staff"], staff: ["staff"], turn_adjust: ["staff", "report"],
  pos: ["staff", "tickets", "report", "waiting", "booking"], booking: ["booking", "waiting"],
  waiting: ["waiting"], catalog:["catalog"], settings: ["settings"], report: ["report"],
};
type Listener = (change: PosChange) => void;
type RefreshState = { salonId: string; resource: PosResource; at: number; retryAfter: number; inFlight?: Promise<void>; pending: boolean; full: boolean; authoritative: boolean; ids: Set<string> };
const brokers = new Map<string, { listeners: Set<Listener>; close(): void }>();

// Broadcasts are hints only. Data is always fetched through a scoped, authorized
// endpoint. A missed socket message is repaired on reconnect/focus and by polling.
export function subscribePosChanges(salonId: string, listener: Listener) {
  let broker = brokers.get(salonId);
  if (!broker) {
    const listeners = new Set<Listener>();
    const emit = (change: PosChange) => { for (const callback of listeners) callback(change); };
    const unsubscribeWake = subscribeReadRefresh(reason => {
      all.forEach(resource => emit({ resource, reason: reason === "foreground" ? "foreground" : "resume" }));
    });
    let ticks = 0, subscribed = false;
    const poll = () => {
      ticks++;
      if (!canAutomaticallyRefreshRead()) return;
      // Catalog/config change rarely; realtime and focus still reconcile them.
      all.filter(resource => !["catalog", "settings"].includes(resource) || ticks % 5 === 0)
        .forEach(resource => emit({ resource, reason: "poll" }));
    };
    const receive = (payload: Record<string, unknown>) => {
      if (!payload || typeof payload !== "object") return;
      if (payload.salonId !== salonId) return;
      if (all.includes(payload.resource as PosResource)) {
        const ids = Array.isArray(payload.ids) ? payload.ids.filter((v): v is string => typeof v === "string" && /^[a-f0-9-]{36}$/i.test(v)).slice(0, 100) : undefined;
        emit({ resource: payload.resource as PosResource, ids });
        if(payload.resource === "tickets") {
          // Ticket IDs are not staff IDs. Reconcile dependent resource snapshots.
          for(const resource of ["staff","report","waiting","booking"] as const) emit({resource});
        }
      } else for (const resource of sourceResources[String(payload.source)] ?? []) emit({ resource });
    };
    const supabase = createSupabaseBrowserClient();
    const channel = supabase?.channel(getPosStaffRealtimeChannel(salonId))
      .on("broadcast", { event: "workspace_changed" }, ({ payload }) => receive(payload))
      .on("broadcast", { event: "staff_queue_changed" }, ({ payload }) => receive(payload))
      .subscribe(status => {
        if (status !== "SUBSCRIBED") return;
        // The first handshake is not a data change. SSR or the hook's initial
        // reconciliation already covers it; a subsequent handshake repairs gaps.
        if (subscribed) all.forEach(resource => emit({resource,reason:"reconnect"}));
        subscribed = true;
      });
    const local = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`kingpos:workspace:${salonId}`);
    if (local) local.onmessage = event => receive(event.data ?? {});
    const timer = setInterval(poll, 60000);
    broker = { listeners, close() { clearInterval(timer); unsubscribeWake(); local?.close(); if (channel) void supabase?.removeChannel(channel); } };
    brokers.set(salonId, broker);
  }
  broker.listeners.add(listener);
  return () => { broker.listeners.delete(listener); if (!broker.listeners.size) { broker.close(); brokers.delete(salonId); } };
}

export function usePosResourceRefresh(salonId: string | null | undefined, resource: PosResource, refresh: (ids?: string[]) => Promise<void>, { initialReconcile = true, enabled = true, snapshotAt, freshForMs = 10000 }: {initialReconcile?: boolean; enabled?: boolean; snapshotAt?:number;freshForMs?:number} = {}) {
  const current = useRef(refresh);
  const completed = useRef<RefreshState | undefined>(undefined);
  useEffect(() => { current.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!salonId || !enabled) return;
    let alive = true, running = false;
    const firstReconcile = completed.current?.salonId !== salonId || completed.current.resource !== resource;
    if (firstReconcile) {
      completed.current = { salonId, resource, at: initialReconcile ? 0 : snapshotAt ?? Date.now(), retryAfter: 0, pending: false, full: false, authoritative: false, ids: new Set() };
    }
    const freshness = completed.current!;
    freshness.at = Math.max(freshness.at, snapshotAt ?? 0);
    const reconcileInitial = firstReconcile && initialReconcile || freshness.at === 0 || Date.now() - freshness.at >= freshForMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay = 100) => {
      if (!freshness.authoritative && freshness.retryAfter > Date.now()) return;
      if (alive && freshness.pending && !running && !timer && canAutomaticallyRefreshRead()) timer = setTimeout(run, delay);
    };
    async function run() {
      timer = undefined;
      if (!alive || running || !canAutomaticallyRefreshRead()) return;
      // Activity detaches effects while retaining this ref. Reentry joins the
      // earlier read instead of starting a second request for the same view.
      if (freshness.inFlight) {
        running = true;
        try { await freshness.inFlight; } catch { /* The original reader preserves its failure policy. */ }
        finally { running = false; schedule(); }
        return;
      }
      // A wake/poll during a successful read is covered by that result. Actual
      // data changes received during it must still produce a follow-up read.
      if (!freshness.authoritative && Date.now() - freshness.at < freshForMs) { freshness.pending = false; freshness.full = false; freshness.ids.clear(); return; }
      running = true; freshness.pending = false;
      const requested = freshness.full || !freshness.ids.size ? undefined : [...freshness.ids];
      freshness.full = false; freshness.authoritative = false; freshness.ids.clear();
      const read = current.current;
      const request = Promise.resolve().then(() => read(requested));
      freshness.inFlight = request;
      try { await request; freshness.at = Date.now(); freshness.retryAfter = 0; }
      catch { freshness.retryAfter = Date.now() + 3000; /* Keep local work. A later hint retries; failures never start a retry loop. */ }
      finally { if (freshness.inFlight === request) freshness.inFlight = undefined; running = false; schedule(); }
    }
    const unsubscribe = subscribePosChanges(salonId, change => {
      if (change.resource !== resource) return;
      const changed = !change.reason || change.reason === "reconnect";
      if (!changed && freshness.inFlight) return;
      if (!changed && Date.now() - freshness.at < freshForMs) return;
      freshness.authoritative ||= changed;
      freshness.pending = true;
      if (!change.ids?.length) freshness.full = true; else change.ids.forEach(id => freshness.ids.add(id));
      if (freshness.ids.size > 100) { freshness.full = true; freshness.ids.clear(); }
      schedule();
    });
    const unsubscribeWake = subscribeReadRefresh(() => schedule());
    // Offline snapshots and unseeded providers reconcile immediately; freshly
    // rendered owner views wait for a change or the fallback poll.
    if (reconcileInitial && !freshness.pending) {
      freshness.full = true; freshness.pending = true; freshness.authoritative = firstReconcile && initialReconcile;
    }
    schedule(reconcileInitial ? 0 : 100);
    return () => { alive = false; unsubscribe(); unsubscribeWake(); if (timer) clearTimeout(timer); };
  }, [salonId, resource, initialReconcile, enabled, snapshotAt, freshForMs]);
}
