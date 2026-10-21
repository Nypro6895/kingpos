"use client";
import { desktopDevice } from "@/lib/portable-device-storage";
import { lockExperienceOffline, prepareExperienceOfflinePath } from "@/lib/experience-offline-client";
import { registerPortableOfflineAdmission } from "@/lib/portable-offline-admission";
import { useEffect, useRef } from "react";
import { usePortableWorkspaceState } from "./portable-workspace-state";

export function PortableOfflineShell() {
  const workspace = usePortableWorkspaceState();
  const admissionScope = workspace?.scope;
  const admissionState = useRef<{ scope: string; revoked: boolean } | null>(null);
  useEffect(() => {
    if (!admissionScope) return;
    if (admissionState.current?.scope !== admissionScope) admissionState.current = { scope: admissionScope, revoked: false };
    if (admissionState.current.revoked) return;
    const release = registerPortableOfflineAdmission();
    // Online logout can leave the old shell mounted until server navigation.
    // Activity reveal must not re-admit that revoked shell in the meantime.
    const revoke = () => { admissionState.current = { scope: admissionScope, revoked: true }; release(); };
    window.addEventListener("kingpos:portable-lock", revoke);
    return () => { window.removeEventListener("kingpos:portable-lock", revoke); release(); };
  }, [admissionScope]);
  const scope = workspace?.offlineEnabled ? workspace.scope : undefined;
  useEffect(() => {
    if (!scope) return;
    if (admissionState.current?.scope === scope && admissionState.current.revoked) return;
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
        await prepareExperienceOfflinePath(location.pathname + location.search, { scope });
      } catch { /* Local commands still work if shell caching is unavailable. */ }
      finally { running = false; }
    };
    const lock = () => {
      active = false;
      native?.lock();
      lockExperienceOffline();
    };
    const timer = setTimeout(() => { void prepare(); }, 3000);
    const retry = setInterval(() => { void prepare(); }, 60000);
    window.addEventListener("online", prepare);
    window.addEventListener("kingpos:portable-lock", lock);
    return () => { active = false; clearTimeout(timer); clearInterval(retry); window.removeEventListener("online", prepare); window.removeEventListener("kingpos:portable-lock", lock); };
  }, [scope]);
  return scope ? <span hidden data-experience-offline-scope={scope} /> : null;
}
