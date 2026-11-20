"use client";
import { useEffect, useState } from "react";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import type { RelayWorkspace } from "@/types/service-relay";

// The launcher remains aware of arrivals even while the Saved tickets panel is closed.
export function useHeldTicketQueue(salonId?: string | null, load?: (desk: boolean) => Promise<{data?: RelayWorkspace; error?: string}>) {
  const [summary, setSummary] = useState<{open:number; ready:number} | undefined>();
  useEffect(() => {
    if (!salonId || !load) return;
    let alive=true, running=false;
    async function refresh() {
      if (!alive || running || !navigator.onLine) return;
      running=true;
      try { const result=await load!(true); if(alive&&!result.error&&result.data)setSummary({open:result.data.tickets.length,ready:result.data.tickets.filter(t=>t.status==="checkout").length}); }
      catch { /* Keep last known count; the picker reports connection failures. */ }
      finally { running=false; }
    }
    const first=setTimeout(()=>{void refresh();},0), timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},15000);
    const unsubscribe=subscribePosChanges(salonId,change=>{if(["waiting","tickets","staff"].includes(change.resource))void refresh();});
    const wake=()=>{void refresh();};window.addEventListener("focus",wake);window.addEventListener("online",wake);
    return()=>{alive=false;clearTimeout(first);clearInterval(timer);unsubscribe();window.removeEventListener("focus",wake);window.removeEventListener("online",wake);};
  },[salonId,load]);
  return summary;
}
