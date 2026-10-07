"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition, useSyncExternalStore } from "react";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { createStaffRefreshQueue } from "@/lib/staff-refresh-queue";

function subscribeNetwork(listener: () => void) {
  window.addEventListener("online", listener); window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}
const networkOnline = () => navigator.onLine;
const serverOnline = () => true;

export function StaffDailyRefresh({ salonId, refreshedAt, viewKey }: { salonId: string; refreshedAt: string; viewKey: string }) {
  const router = useRouter();
  const online = useSyncExternalStore(subscribeNetwork, networkOnline, serverOnline);
  const [pending, startTransition] = useTransition();
  const completion = useRef<(() => void) | null>(null);
  useEffect(() => { if (!pending) completion.current?.(); }, [pending, refreshedAt]);
  useEffect(() => {
    const active = () => navigator.onLine && document.visibilityState === "visible";
    const queue = createStaffRefreshQueue({ active, refresh: () => new Promise<void>(resolve => {
      // router.refresh returns void; wait for React's transition/RSC commit.
      const watchdog = setTimeout(done, 20000);
      function done() { clearTimeout(watchdog); completion.current = null; resolve(); }
      completion.current = done;
      startTransition(() => router.refresh());
    }) });
    const unsubscribe = subscribePosChanges(salonId, change => {
      if (["staff", "tickets", "settings", "report", "catalog"].includes(change.resource)) queue.request();
    });
    // The workspace broker owns polling, reconnect and foreground recovery.
    // Keep pageshow for browser back/forward cache restoration only.
    const wake = (event: PageTransitionEvent) => { if (event.persisted) queue.request(); };
    window.addEventListener("pageshow", wake);
    return () => {
      queue.dispose(); completion.current?.(); unsubscribe();
      window.removeEventListener("pageshow", wake);
    };
  }, [salonId, router, viewKey]);
  return online ? null : <p role="status" className="mb-2 text-xs text-amber-800">Offline · showing the last loaded data. Reconnect to update.</p>;
}
