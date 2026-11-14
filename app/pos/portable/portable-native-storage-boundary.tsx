"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { iosPortableDevice } from "@/lib/portable-device-storage";
import { preparePortableNativeStorage } from "@/lib/portable-native-client";
import { getAppLocalHost } from "@/lib/app-local-host";

type State = "checking" | "ready" | "failed" | "locked" | "expired";

/** Do not mount an editor until the native vault has durable scoped authority. */
export function PortableNativeStorageBoundary({ scope, children, nativeExpected = false }: { scope: string; children: ReactNode; nativeExpected?: boolean }) {
  const needsAdmission = nativeExpected || Boolean(iosPortableDevice());
  const [result, setResult] = useState<{ scope: string; state: State }>({ scope, state: needsAdmission ? "checking" : "ready" });
  const [openedScope, setOpenedScope] = useState<string | null>(needsAdmission ? null : scope);
  const [attempt, setAttempt] = useState(0);
  const lockedScope = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    let revoked = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const publish = (state: State) => { if (active) setResult({ scope, state }); };
    const lock = () => { lockedScope.current = scope; revoked = true; publish("locked"); };
    const reset = () => { if (lockedScope.current === scope) return; revoked = true; publish("checking"); setAttempt(value => value + 1); };
    window.addEventListener("kingpos:portable-lock", lock);
    window.addEventListener("kingpos:native-portable-lock", lock);
    window.addEventListener("reylumi:app-local-reset", reset);
    window.addEventListener("kingpos:native-writer-reset", reset);
    if (lockedScope.current === scope) publish("locked");
    else {
      if (iosPortableDevice()) publish("checking");
      void preparePortableNativeStorage(scope).then(readiness => {
        if (!active || revoked) return;
        setOpenedScope(scope);
        publish("ready");
        if (readiness) expiry = setTimeout(() => publish("expired"), Math.max(0, Math.min(2_147_483_647, Date.parse(readiness.expiresAt) - Date.now())));
      }).catch(() => { if (!revoked) publish("failed"); });
    }
    return () => { active = false; clearTimeout(expiry); window.removeEventListener("kingpos:portable-lock", lock); window.removeEventListener("kingpos:native-portable-lock", lock); window.removeEventListener("reylumi:app-local-reset", reset); window.removeEventListener("kingpos:native-writer-reset", reset); };
  }, [scope, attempt]);
  const state = result.scope === scope ? result.state : "checking";
  const message = state === "checking" ? "Opening POS storage…" : state === "locked" ? "POS is locked. Your saved tickets remain on this iPad." : state === "expired" ? "Reconnect to renew this POS session. Your saved tickets remain on this iPad." : "Could not open device storage. Your saved tickets remain on this iPad.";
  return <>
    {openedScope === scope && <div className="flex h-full min-h-0 w-full flex-1 flex-col" hidden={state !== "ready"} inert={state !== "ready"} style={state !== "ready" ? { display: "none" } : undefined} aria-hidden={state !== "ready"}>{children}</div>}
    {state !== "ready" && <section className="grid h-full min-h-64 place-items-center p-6 text-center" aria-busy={state === "checking"} data-portable-native-storage={state}><div className="max-w-md space-y-4">
    <p role={state === "checking" ? "status" : "alert"}><WorkspaceText text={message} /></p>
    {state === "failed" && <button type="button" className="min-h-12 rounded-xl border bg-white px-6" onClick={() => setAttempt(value => value + 1)}><WorkspaceText text="Try again" /></button>}
    {(state === "locked" || state === "expired") && <button type="button" className="min-h-12 rounded-xl border bg-white px-6" onClick={() => {
      const host = getAppLocalHost();
      if (host.isNative) void host.openOnline("/pos/portable"); else location.assign("/pos/portable");
    }}><WorkspaceText text="Open Portable POS" /></button>}
    </div></section>}
  </>;
}
