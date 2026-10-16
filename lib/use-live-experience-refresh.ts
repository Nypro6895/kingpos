"use client";

import { useEffect, useRef } from "react";
import { subscribePosChanges, type PosResource } from "@/lib/pos-workspace-sync";

export function useLiveExperienceRefresh(salonId: string, resources: readonly PosResource[], refresh: () => Promise<unknown>, enabled = true) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true, running = false, pending = false;
    let lastRefresh = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!alive || running || timer || !pending || !navigator.onLine || document.visibilityState !== "visible") return;
      timer = setTimeout(run, 100);
    };
    async function run() {
      timer = undefined;
      if (!alive || !navigator.onLine || document.visibilityState !== "visible") return;
      running = true; pending = false;
      try { await latest.current(); lastRefresh = Date.now(); } catch { /* Keep the last authorized snapshot during a temporary failure. */ }
      finally { running = false; schedule(); }
    }
    const unsubscribe = subscribePosChanges(salonId, change => {
      if (!resources.includes(change.resource)) return;
      if (change.reason && !["reconnect", "foreground"].includes(change.reason) && Date.now() - lastRefresh < 10000) return;
      pending = true; schedule();
    });
    window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => { alive = false; unsubscribe(); if (timer) clearTimeout(timer); window.removeEventListener("online", schedule); document.removeEventListener("visibilitychange", schedule); };
  }, [salonId, resources, enabled]);
}
