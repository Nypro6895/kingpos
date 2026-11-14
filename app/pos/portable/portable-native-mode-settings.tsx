"use client";

import { useEffect, useState } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { iosPortableDevice } from "@/lib/portable-device-storage";
import { getAppLocalHost } from "@/lib/app-local-host";
import { portableNativeReadiness, PORTABLE_NATIVE_READY_CHANGED, type PortableNativeReadiness } from "@/lib/portable-native-client";

/** Device-local launch preference: switching it never discards an open cart. */
export function PortableNativeModeSettings() {
  const [mode, setMode] = useState<"portable" | "personal" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readiness, setReadiness] = useState<PortableNativeReadiness | null>(null);
  useEffect(() => {
    const native = iosPortableDevice();
    if (!native) return;
    let active = true;
    const read = () => {
      void native.request<{ mode: "portable" | "personal" }>({ action: "mode.get" }).then(value => { if (active) setMode(value.mode); }).catch(() => { if (active) setError("Unable to read this device setting. Please try again."); });
      void portableNativeReadiness().then(value => { if (active) setReadiness(value); }).catch(() => { if (active) setReadiness(null); });
    };
    read();
    window.addEventListener(PORTABLE_NATIVE_READY_CHANGED, read);
    const timer = setInterval(read, 30_000);
    return () => { active = false; clearInterval(timer); window.removeEventListener(PORTABLE_NATIVE_READY_CHANGED, read); };
  }, []);
  async function changeMode() {
    const native = iosPortableDevice();
    if (!native || !mode) return;
    setBusy(true); setError("");
    const next = mode === "portable" ? "personal" : "portable";
    try {
      const reply = await native.request<{ mode: "portable" | "personal" }>({ action: "mode.set", mode: next });
      if (reply.mode !== next) throw new Error();
      setMode(next);
    } catch { setError("Unable to save this device setting. Please try again."); }
    finally { setBusy(false); }
  }
  async function returnToReylumi() {
    const native = iosPortableDevice();
    if (!native) return;
    const result = { saved: true, busy: false };
    window.dispatchEvent(new CustomEvent("kingpos:desktop-flush", { detail: result }));
    if (!result.saved || result.busy) { setError("Keep POS open until your ticket is saved on this device."); return; }
    setBusy(true); setError("");
    try {
      const reply = await native.request<{ mode: string }>({ action: "mode.set", mode: "personal" });
      if (reply.mode !== "personal") throw new Error();
      setMode("personal");
      const host = getAppLocalHost();
      if (host.isNative) await host.openOnline("/"); else location.assign("/");
    } catch { setError("Could not open Reylumi. Your saved tickets remain on this device."); }
    finally { setBusy(false); }
  }
  if (!mode && !error) return null;
  return <section className="device-setting-section" aria-label="iPad POS" data-portable-native-settings>
    <h3><WorkspaceText text="POS on this device" /></h3>
    <div className="device-list-row"><span><WorkspaceText text="Open POS when the app starts" /></span><button type="button" aria-pressed={mode === "portable"} disabled={busy || !mode} onClick={() => void changeMode()}><WorkspaceText text={busy ? "Saving…" : mode === "portable" ? "Turn off" : "Turn on"} /></button></div>
    <p><WorkspaceText text="This changes the start screen on this device. Your open ticket stays available." /></p>
    {readiness && <p role="status" data-portable-native-offline={readiness.offlineReady ? "ready" : "preparing"}><WorkspaceText text={readiness.offlineReady ? "Ready for offline work on this device." : "Connect and keep POS open to finish preparing offline work."} />{(readiness.pending ?? 0) > 0 && <> <WorkspaceText text="Waiting to sync" />: {readiness.pending}</>}</p>}
    {readiness?.offlineReady && <p><WorkspaceText text="Reconnect before" /> {new Date(readiness.expiresAt).toLocaleString()}. <WorkspaceText text="Saved tickets stay on this device." /></p>}
    {mode === "portable" && typeof location !== "undefined" && !location.pathname.startsWith("/pos/portable") && <a className="inline-flex min-h-11 items-center underline" href="/pos/portable"><WorkspaceText text="Open Portable POS" /></a>}
    {typeof location !== "undefined" && location.pathname.startsWith("/pos/portable") && <button type="button" className="inline-flex min-h-11 items-center underline" disabled={busy} onClick={() => void returnToReylumi()}><WorkspaceText text="Return to Reylumi" /></button>}
    {error && <p role="alert"><WorkspaceText text={error} /></p>}
  </section>;
}
