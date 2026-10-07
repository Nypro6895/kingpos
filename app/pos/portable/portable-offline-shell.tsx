"use client";
import { desktopDevice } from "@/lib/portable-device-storage";
import { useEffect } from "react";
import { usePortableWorkspaceState } from "./portable-workspace-state";

export function PortableOfflineShell() {
  const workspace = usePortableWorkspaceState();
  const scope = workspace?.offlineEnabled ? workspace.scope : undefined;
  useEffect(() => {
    if (!scope) return;
    const native = desktopDevice()?.offline;
    let active = true, running = false;
    const prepare = async () => {
      if (!navigator.onLine || !active || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        if (native) {
          await native.prepare(scope, performance.getEntriesByType("resource").map(entry => entry.name));
          return;
        }
        if (!("serviceWorker" in navigator)) return;
        await navigator.serviceWorker.register("/portable-sw.js", { scope: "/pos/" });
        const registration = await navigator.serviceWorker.ready;
        if (!active) return;
        registration.active?.postMessage({ kind: "portable-prepare", scope,
          assets: performance.getEntriesByType("resource").map(entry => entry.name) });
      } catch { /* Local commands still work if shell caching is unavailable. */ }
      finally { running = false; }
    };
    const lock = () => {
      active = false;
      native?.lock();
      navigator.serviceWorker.controller?.postMessage({kind:"portable-lock"});
      void caches.delete("kingpos-portable-shell-v1");
    };
    const timer = setTimeout(() => { void prepare(); }, 3000);
    const retry = setInterval(() => { void prepare(); }, 60000);
    window.addEventListener("online", prepare);
    window.addEventListener("kingpos:portable-lock", lock);
    return () => { active = false; clearTimeout(timer); clearInterval(retry); window.removeEventListener("online", prepare); window.removeEventListener("kingpos:portable-lock", lock); };
  }, [scope]);
  return null;
}
