"use client";

import { useEffect } from "react";
import { workstationChanged, workstationRequest } from "@/lib/portable-workstation-client";

/** Session lifecycle only. The desk owns its original durable cart and callbacks. */
export function PairedWorkstationBridge() {
  useEffect(() => {
    const lock = () => { void workstationRequest({ action: "heartbeat", online: false }).catch(() => {}); };
    const resume = () => { if (document.visibilityState === "visible") workstationChanged(); };
    window.addEventListener("kingpos:portable-lock", lock);
    document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("kingpos:portable-lock", lock); document.removeEventListener("visibilitychange", resume); };
  }, []);
  return null;
}
