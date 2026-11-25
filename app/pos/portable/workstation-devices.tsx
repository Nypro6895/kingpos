"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useNativeDialogNavigation } from "@/components/overlay-dismissal";
import { desktopDevice } from "@/lib/portable-device-storage";
import { workstationRequest, workstationChanged } from "@/lib/portable-workstation-client";
import { getAppLocalHost } from "@/lib/app-local-host";
import type { PortableWorkstationSession } from "@/types/portable-workstation";
import styles from "./portable-devices.module.css";
const subscribe = () => () => {};
const desktopSnapshot = () => Boolean(desktopDevice()?.display);

export function WorkstationDevices() {
  const t = useWorkspaceTranslation();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useNativeDialogNavigation(dialog);
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, () => true);
  const [session, setSession] = useState<PortableWorkstationSession | null>(null);
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState<{code:string;expiresAt:string|number} | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "revoke" | "transfer" | null>(null);
  async function load() {
    setError(""); setBusy(true);
    try { setSession(await workstationRequest<PortableWorkstationSession>(undefined, "staff")); }
    catch(cause) { setError(cause instanceof Error ? cause.message : "Devices could not load."); }
    finally { setBusy(false); }
  }
  async function run(input: Record<string, unknown>, refresh = false) {
    if (busy) return;
    if (refresh) {
      const state = { allowed: true, error: "Save and close the current ticket before changing counters." };
      window.dispatchEvent(new CustomEvent("kingpos:workstation-can-change", {detail:state}));
      if (!state.allowed) { setError(state.error); return; }
    }
    setBusy(true); setError(""); setConfirm(null);
    try {
      const result = await workstationRequest<PortableWorkstationSession & {code?:string;expiresAt?:string|number}>(input);
      setSession(result);
      if (result.code) setCode({code:result.code,expiresAt:result.expiresAt ?? ""});
      else setCode(null);
      // Code/revocation also rotate the signed stream generation. Rejoin while
      // retaining the desk's original durable cart and writer callbacks.
      workstationChanged();
      if (refresh) {
        const host = getAppLocalHost();
        // The bundled router refreshes context, not its retained workspace DTO.
        // A guarded hosted transition loads the newly bound draft before edits.
        if (host.isNative) await host.openOnline("/pos/portable");
        else router.refresh();
      }
    } catch(cause) { setError(cause instanceof Error ? cause.message : "The device could not be updated."); }
    finally { setBusy(false); }
  }
  if (desktop) return null;
  const current = session?.current;
  return <>
    <button type="button" className={styles.trigger} aria-label={t("Devices for this counter")} title={t("Devices for this counter")} onClick={() => { dialog.current?.showModal(); void load(); }}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="2" y="3" width="14" height="11" rx="2"/><path d="M9 14v6m-4 0h8"/><rect x="18" y="8" width="4" height="12" rx="1"/></svg>
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-label={t("Devices for this counter")}>
      <header className={styles.header}><h2><WorkspaceText text="Devices for this counter" /></h2><button type="button" aria-label={t("Close")} onClick={() => dialog.current?.close()}>×</button></header>
      <div className={styles.content} aria-busy={busy}>
        {error && <p className={styles.error} role="alert">{t(error)}</p>}
        {!session && <button className={styles.secondary} disabled={busy} onClick={() => void load()}><WorkspaceText text={busy ? "Loading…" : "Try again"} /></button>}
        {current && <section className={styles.section}><h3>{current.label}</h3><p className={styles.status}><WorkspaceText text={current.customerPaired ? "Customer screen connected" : "No customer screen connected"} /></p>
          <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={() => current.customerPaired ? setConfirm("replace") : void run({action:"code"})}><WorkspaceText text={current.customerPaired ? "Replace customer screen" : "Connect customer screen"} /></button>
          {current.customerPaired && <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirm("revoke")}><WorkspaceText text="Remove customer screen" /></button>}</div>
          {code && <div role="status"><p><WorkspaceText text="On the customer device, open Reylumi POS, choose Customer screen and enter:" /></p><p className={styles.code}>{code.code}</p><p><WorkspaceText text="Valid until" /> {new Date(code.expiresAt).toLocaleTimeString()}.</p><p><WorkspaceText text="No camera needed. Connect once; the customer screen stays enrolled until replaced or removed." /></p></div>}
        </section>}
        {session && <section className={styles.section}><h3><WorkspaceText text={current ? "Move to another counter" : "Set up this employee device"} /></h3>
          <label><WorkspaceText text="Counter name" /><input maxLength={60} value={label} placeholder={t("Counter 1")} onChange={event => setLabel(event.target.value)} /></label>
          <button className={styles.secondary} disabled={busy || !label.trim()} onClick={() => void run({action:"create",label:label.trim()},true)}><WorkspaceText text="Create counter" /></button>
          {!!session.workstations?.length && <><label><WorkspaceText text="Use an existing counter" /><select value={selected} onChange={event => setSelected(event.target.value)}><option value="">{t("Choose a counter")}</option>{session.workstations.filter(item => item.id !== current?.id).map(item => <option key={item.id} value={item.id}>{item.label}{!item.canHandover ? ` — ${t("Save and close the other POS first")}` : ""}</option>)}</select></label>
          <button className={styles.secondary} disabled={busy || !selected} onClick={() => setConfirm("transfer")}><WorkspaceText text="Use this counter" /></button></>}
        </section>}
        {confirm && <section className={styles.warning} role="alertdialog" aria-label={t("Confirm device change")}><p><WorkspaceText text={confirm === "replace" ? "Remove the old customer screen and create a code for its replacement?" : confirm === "revoke" ? "Remove this customer screen? It will need a new code to reconnect." : "Move this counter to this device? Save and close the other employee POS first. Its customer screen stays connected."} /></p><div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => void run(confirm === "replace" ? {action:"code",replace:true} : confirm === "revoke" ? {action:"revoke"} : {action:"select",workstationId:selected},confirm === "transfer")}><WorkspaceText text="Continue" /></button><button className={styles.secondary} onClick={() => setConfirm(null)}><WorkspaceText text="Cancel" /></button></div></section>}
      </div>
    </dialog>
  </>;
}
