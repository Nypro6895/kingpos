"use client";
import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "./supabase/browser";
import { getPosStaffRealtimeChannel } from "./pos-staff-realtime";

export type PosResource = "staff" | "tickets" | "booking" | "report" | "waiting" | "settings" | "catalog";
export type PosChange = { resource: PosResource; ids?: string[]; reason?: "poll" | "resume" | "reconnect" };
const all: PosResource[] = ["staff", "tickets", "booking", "report", "waiting", "settings", "catalog"];
const sourceResources: Record<string, PosResource[]> = {
  attendance: ["staff"], staff: ["staff"], turn_adjust: ["staff", "report"],
  pos: ["staff", "tickets", "report", "waiting", "booking"], booking: ["booking", "waiting"],
  waiting: ["waiting"], catalog:["catalog"], settings: ["settings"], report: ["report"],
};
type Listener = (change: PosChange) => void;
const brokers = new Map<string, { listeners: Set<Listener>; close(): void }>();

// Broadcasts are hints only. Data is always fetched through a scoped, authorized
// endpoint. A missed socket message is repaired on reconnect/focus and by polling.
export function subscribePosChanges(salonId: string, listener: Listener) {
  let broker = brokers.get(salonId);
  if (!broker) {
    const listeners = new Set<Listener>();
    const emit = (change: PosChange) => { for (const callback of listeners) callback(change); };
    const wake = () => { if (navigator.onLine && document.visibilityState === "visible") all.forEach(resource => emit({ resource, reason: "resume" })); };
    let ticks = 0, subscribed = false;
    const poll = () => {
      ticks++;
      if (!navigator.onLine || document.visibilityState !== "visible") return;
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
    window.addEventListener("online", wake); window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
    broker = { listeners, close() { clearInterval(timer); local?.close(); if (channel) void supabase?.removeChannel(channel); window.removeEventListener("online", wake); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); } };
    brokers.set(salonId, broker);
  }
  broker.listeners.add(listener);
  return () => { broker.listeners.delete(listener); if (!broker.listeners.size) { broker.close(); brokers.delete(salonId); } };
}

export function usePosResourceRefresh(salonId: string | null | undefined, resource: PosResource, refresh: (ids?: string[]) => Promise<void>, { initialReconcile = true, enabled = true, snapshotAt }: {initialReconcile?: boolean; enabled?: boolean; snapshotAt?:number} = {}) {
  const current = useRef(refresh);
  useEffect(() => { current.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!salonId || !enabled) return;
    let alive = true, running = false, pending = false, full = false;
    const reconcileInitial=initialReconcile || (snapshotAt!==undefined && Date.now()-snapshotAt>=10000);
    let lastRefresh = reconcileInitial ? 0 : snapshotAt ?? Date.now();
    const ids = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function run() {
      timer = undefined;
      if (!alive || running || !navigator.onLine || document.visibilityState !== "visible") return;
      running = true; pending = false;
      const requested = full || !ids.size ? undefined : [...ids]; full = false; ids.clear();
      try { await current.current(requested); lastRefresh = Date.now(); } catch { /* Preserve the last snapshot and all local work. */ }
      finally { running = false; if (alive && pending) timer = setTimeout(run, 100); }
    }
    const unsubscribe = subscribePosChanges(salonId, change => {
      if (change.resource !== resource) return;
      if (change.reason && change.reason !== "reconnect" && Date.now() - lastRefresh < 10000) return;
      pending = true;
      if (!change.ids?.length) full = true; else change.ids.forEach(id => ids.add(id));
      if (!running && !timer) timer = setTimeout(run, 100);
    });
    const resume = () => { if (pending && !running && !timer) timer = setTimeout(run,100); };
    document.addEventListener("visibilitychange",resume);
    // Offline snapshots and unseeded providers reconcile immediately; freshly
    // rendered owner views wait for a change or the fallback poll.
    if (reconcileInitial) { full = true; pending = true; timer = setTimeout(run, 0); }
    return () => { alive = false; unsubscribe(); if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange",resume); };
  }, [salonId, resource, initialReconcile, enabled, snapshotAt]);
}
