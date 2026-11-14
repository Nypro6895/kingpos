"use client";

import { useEffect } from "react";
import { iosPortableDevice } from "@/lib/portable-device-storage";
import { preparePortableNativeWorkspace } from "@/lib/portable-native-preparation";
import type { PortablePosCapability } from "@/lib/pos-portable-capabilities";

export function PortableNativePreparation({ scope, capabilities }: { scope: string; capabilities: readonly PortablePosCapability[] }) {
  useEffect(() => {
    if (!iosPortableDevice()) return;
    let active = true, running = false;
    const prepare = async () => {
      if (!active || running || document.visibilityState !== "visible") return;
      running = true;
      try { await preparePortableNativeWorkspace(scope, capabilities, () => active); }
      catch { /* Keep the current POS; readiness stays incomplete until a retry succeeds. */ }
      finally { running = false; }
    };
    const timer = setTimeout(() => void prepare(), 1500);
    const retry = setInterval(() => void prepare(), 60_000);
    const lock = () => { active = false; };
    window.addEventListener("online", prepare);
    window.addEventListener("kingpos:portable-lock", lock);
    return () => { active = false; clearTimeout(timer); clearInterval(retry); window.removeEventListener("online", prepare); window.removeEventListener("kingpos:portable-lock", lock); };
  }, [scope, capabilities]);
  return null;
}
