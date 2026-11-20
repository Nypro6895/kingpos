"use client";

import { useEffect, useRef } from "react";
import { subscribePosChanges, type PosResource } from "@/lib/pos-workspace-sync";
import { canAutomaticallyRefreshRead, subscribeReadRefresh } from "./read-refresh-scheduler";

type RefreshState = { key: string; at: number; retryAfter: number; pending: boolean; force: boolean; inFlight?: Promise<unknown> };

export function useLiveExperienceRefresh(salonId: string, resources: readonly PosResource[], refresh: () => Promise<unknown>, enabled = true,
  options: { automaticRefresh?: () => Promise<unknown>; freshForMs?: number } = {}) {
  const latest = useRef({ refresh, automaticRefresh: options.automaticRefresh });
  const retained = useRef<RefreshState | undefined>(undefined);
  useEffect(() => { latest.current = { refresh, automaticRefresh: options.automaticRefresh }; }, [refresh, options.automaticRefresh]);
  const freshForMs = options.freshForMs ?? 10000;
  useEffect(() => {
    if (!enabled) return;
    const key = JSON.stringify([salonId, resources]);
    if (retained.current?.key !== key) retained.current = { key, at: Date.now(), retryAfter: 0, pending: false, force: false };
    const state = retained.current;
    let alive = true, running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!state.force && state.retryAfter > Date.now()) return;
      if (!alive || running || timer || !state.pending || !canAutomaticallyRefreshRead()) return;
      timer = setTimeout(run, 100);
    };
    async function run() {
      timer = undefined;
      if (!alive || !canAutomaticallyRefreshRead()) return;
      if (state.inFlight) {
        running = true;
        try { await state.inFlight; } catch { /* The original reader preserves its failure policy. */ }
        finally { running = false; schedule(); }
        return;
      }
      if (!state.force && !latest.current.automaticRefresh && Date.now() - state.at < freshForMs) { state.pending = false; return; }
      running = true; state.pending = false;
      const read = state.force ? latest.current.refresh : latest.current.automaticRefresh ?? latest.current.refresh;
      state.force = false;
      const request = Promise.resolve().then(read);
      state.inFlight = request;
      try { await request; state.at = Date.now(); state.retryAfter = 0; }
      catch { state.retryAfter = Date.now() + 3000; /* Keep the last authorized snapshot; retry only on a later hint. */ }
      finally { if (state.inFlight === request) state.inFlight = undefined; running = false; schedule(); }
    }
    const unsubscribe = subscribePosChanges(salonId, change => {
      if (!resources.includes(change.resource)) return;
      const authoritative = !change.reason || change.reason === "reconnect";
      if (!authoritative && state.inFlight) return;
      if (!authoritative && !latest.current.automaticRefresh && Date.now() - state.at < freshForMs) return;
      state.force ||= authoritative;
      state.pending = true; schedule();
    });
    const unsubscribeWake = subscribeReadRefresh(schedule);
    schedule();
    return () => { alive = false; unsubscribe(); unsubscribeWake(); if (timer) clearTimeout(timer); };
  }, [salonId, resources, enabled, freshForMs]);
}
