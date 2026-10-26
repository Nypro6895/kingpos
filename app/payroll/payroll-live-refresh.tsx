"use client";
import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { usePayrollEdits } from "./payroll-edit-boundary";

const RefreshContext = createContext<(() => Promise<void>) | null>(null);
export function PayrollRefreshProvider({refresh,children}:{refresh:()=>Promise<void>;children:ReactNode}) { return <RefreshContext.Provider value={refresh}>{children}</RefreshContext.Provider>; }
export function usePayrollRefresh() { const local=useContext(RefreshContext); const router=useRouter(); return useCallback(async()=>{if(local) await local(); else router.refresh();},[local,router]); }

export function PayrollLiveRefresh({ salonId }: { salonId: string }) {
  const refreshResource = usePayrollRefresh(), { blocked } = usePayrollEdits();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (document.visibilityState !== "visible" || blocked || document.activeElement?.matches("input,textarea,select") || document.querySelector('[data-payroll-autosave][aria-busy="true"]')) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshResource(), 350);
    };
    const client = createSupabaseBrowserClient();
    let channel = client?.channel(`payroll-live:${salonId}`);
    for (const table of ["pos_daily_closings", "pos_ticket_staff_earnings", "staff_payroll_settings", "payroll_period_staff_inputs", "pos_ticket_items", "payroll_live_change_history"]) {
      channel = channel?.on("postgres_changes", { event: "*", schema: "public", table, filter: `salon_id=eq.${salonId}` }, refresh);
    }
    channel?.subscribe();
    const interval = setInterval(refresh, 20_000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { if (timer) clearTimeout(timer); clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); if (channel) void client?.removeChannel(channel); };
  }, [salonId, refreshResource, blocked]);
  return null;
}
