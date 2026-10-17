"use client";

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLiveExperienceRefresh } from "@/lib/use-live-experience-refresh";
import { usePayrollEdits } from "./payroll-edit-boundary";

const RefreshContext = createContext<(() => Promise<void>) | null>(null);
const resources = ["tickets", "report", "staff", "settings"] as const;

export function PayrollRefreshProvider({ refresh, children }: { refresh: () => Promise<void>; children: ReactNode }) {
  return <RefreshContext.Provider value={refresh}>{children}</RefreshContext.Provider>;
}

export function usePayrollRefresh() {
  const local = useContext(RefreshContext);
  const router = useRouter();
  return useCallback(async () => { if (local) await local(); else router.refresh(); }, [local, router]);
}

export function PayrollLiveRefresh({ salonId }: { salonId: string }) {
  const { blocked } = usePayrollEdits();
  const refresh = usePayrollRefresh();
  const deferred = useRef(false);
  useLiveExperienceRefresh(salonId, resources, async () => {
    if (blocked) { deferred.current = true; return; }
    await refresh();
  });
  useEffect(() => {
    if (!blocked && deferred.current) { deferred.current = false; void refresh(); }
  }, [blocked, refresh]);
  return null;
}
