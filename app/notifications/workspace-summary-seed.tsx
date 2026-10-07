"use client";

import { useEffect } from "react";
import type { CustomerNotificationSummary } from "@/app/customer-shell-context";
import { NOTIFICATIONS_SEED } from "@/lib/notification-client";

export function WorkspaceSummarySeed({summary,scope}:{summary:CustomerNotificationSummary;scope:string}) {
  useEffect(()=>{
    let active=true;
    // The shell subscribes in the same commit; dispatch after its effect starts.
    queueMicrotask(()=>{if(active)window.dispatchEvent(new CustomEvent(NOTIFICATIONS_SEED,{detail:{summary,scope}}));});
    return()=>{active=false;};
  },[summary,scope]);
  return null;
}
