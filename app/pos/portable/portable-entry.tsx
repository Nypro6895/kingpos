"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { desktopDevice } from "@/lib/portable-device-storage";
import { workstationRequest } from "@/lib/portable-workstation-client";
import { getAppLocalHost } from "@/lib/app-local-host";
import type { PortableWorkstationSession } from "@/types/portable-workstation";
import { PortablePosLoginForm } from "./portable-login-form";
import { PortableInstallHelp } from "./portable-install-help";
import styles from "./portable-devices.module.css";

const ROLE_KEY = "reylumi:portable-role:v1";
const subscribe = () => () => {};
const desktopSnapshot = () => Boolean(desktopDevice()?.display);
function savedRole(): "staff" | "customer" | null { try { const role=sessionStorage.getItem(ROLE_KEY) ?? localStorage.getItem(ROLE_KEY); return role === "staff" || role === "customer" ? role : null; } catch { return null; } }

/** Role is a navigation preference only. Every request still checks its own grant. */
export function PortableEntry({ rememberedAccessId = "", initialRole = "staff" }: {
  rememberedAccessId?: string; initialRole?: "staff" | "customer";
}) {
  const t = useWorkspaceTranslation();
  const router = useRouter();
  const [choice, setChoice] = useState<"staff" | "customer" | null>(null);
  const storedRole = useSyncExternalStore(subscribe, savedRole, () => null);
  const role = choice ?? (initialRole === "customer" ? initialRole : storedRole ?? initialRole);
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, () => true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (desktop) return;
    try { sessionStorage.setItem(ROLE_KEY, role); } catch { /* Optional per-window preference. */ }
    if (role !== "customer") return;
    let alive = true;
    void workstationRequest<PortableWorkstationSession>(undefined, "customer").then(session => {
      if (alive && session.role === "customer" && session.current) router.replace("/pos/portable/display");
    }).catch(() => { /* Pairing remains available for an unregistered device. */ });
    return () => { alive = false; };
  }, [desktop, role, router]);
  function choose(next: "staff" | "customer") {
    setChoice(next); setError("");
    try { sessionStorage.setItem(ROLE_KEY, next); localStorage.setItem(ROLE_KEY, next); } catch { /* Optional preference. */ }
  }
  async function pair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await workstationRequest<PortableWorkstationSession>({ action: "pair", code: code.replace(/\s/g, "") });
      if (result.role !== "customer" || !result.current) throw new Error("The display could not be connected. Try a new code.");
      try { localStorage.setItem(ROLE_KEY, "customer"); } catch { /* Cookie stores enrollment. */ }
      const host = getAppLocalHost();
      if (host.isNative) await host.openOnline("/pos/portable/display");
      else { router.replace("/pos/portable/display"); router.refresh(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The display could not be connected."); }
    finally { setBusy(false); }
  }
  return <section className={styles.entry} aria-label={t("Reylumi POS")}>
    {!desktop && <div className={styles.roles} role="group" aria-label={t("Use this device as")}>
      <button type="button" aria-pressed={role === "staff"} onClick={() => choose("staff")}><WorkspaceText text="Employee" /></button>
      <button type="button" aria-pressed={role === "customer"} onClick={() => choose("customer")}><WorkspaceText text="Customer screen" /></button>
    </div>}
    {desktop || role === "staff" ? <PortablePosLoginForm rememberedAccessId={rememberedAccessId} /> : <>
      <form className={styles.pairForm} onSubmit={pair}>
        <h1><WorkspaceText text="Connect customer screen" /></h1>
        <p><WorkspaceText text="On the employee POS, open Devices for this counter and create a connection code. Enter it here once." /></p>
        <label><WorkspaceText text="Connection code" /><input name="pairing_code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,12}" maxLength={12} required value={code} onChange={event => setCode(event.target.value.replace(/[^0-9 ]/g, ""))} /></label>
        {error && <p role="alert">{t(error)}</p>}
        <button className={styles.primary} type="submit" disabled={busy}><WorkspaceText text={busy ? "Connecting…" : "Connect this screen"} /></button>
        <p><WorkspaceText text="No camera needed. This screen stays connected until it is replaced or removed from the counter." /></p>
      </form>
      <PortableInstallHelp />
    </>}
  </section>;
}
