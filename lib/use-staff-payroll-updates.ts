"use client";
import { useEffect } from "react";
import { createSupabaseBrowserClient } from "./supabase/browser";

/** Realtime rows are only hints; read current amounts through the authorized resource. */
export function useStaffPayrollUpdates(salonId:string,staffId:string,refresh:()=>Promise<unknown>,enabled:boolean) {
  useEffect(()=>{
    if(!enabled)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const update=()=>{if(document.visibilityState!=="visible"||!navigator.onLine)return;if(timer)clearTimeout(timer);timer=setTimeout(()=>{void refresh().catch(()=>{});},250);};
    const client=createSupabaseBrowserClient();
    const channel=client?.channel(`staff-payroll-current:${salonId}:${staffId}`).on("postgres_changes",{event:"INSERT",schema:"public",table:"payroll_live_change_history",filter:`staff_id=eq.${staffId}`},update).subscribe();
    const interval=setInterval(update,20_000);
    return()=>{if(timer)clearTimeout(timer);clearInterval(interval);if(channel)void client?.removeChannel(channel);};
  },[salonId,staffId,refresh,enabled]);
}
