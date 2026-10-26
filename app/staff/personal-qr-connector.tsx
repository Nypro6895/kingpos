"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceText } from "@/components/workspace-language";
import { StaffQrScanner } from "@/app/staff/scan/qr-scanner";
import { previewPersonalStaffQr, sendPersonalStaffQr } from "@/app/qr/actions";
import type { PersonalStaffPreview } from "@/types/personal-qr";
import styles from "@/app/qr/personal-qr.module.css";

export function PersonalQrStaffConnector({ salonId, viewerId, closeHref, children }: { salonId: string; viewerId: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const [camera, setCamera] = useState(false), [preview, setPreview] = useState<PersonalStaffPreview | null>(null);
  const [code, setCode] = useState(""), [manual, setManual] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef(false), epoch = useRef(0);
  const closeCamera = useCallback(() => setCamera(false), []);
  useEffect(() => {
    const reset = () => { epoch.current++; setPreview(null); setCode(""); setCamera(false); };
    window.addEventListener("reylumi:experience-reset", reset);
    return () => { reset(); window.removeEventListener("reylumi:experience-reset", reset); };
  }, []);
  async function scan(value: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setCamera(false); setError(""); const generation = epoch.current;
    try {
      const result = await previewPersonalStaffQr({ salonId, viewerId }, value);
      if (generation !== epoch.current) return;
      if (result.preview) { setPreview(result.preview); setCode(value); } else setError(result.error ?? "Could not read this Personal QR.");
    } catch { if (generation === epoch.current) setError("Reconnect and scan their Personal QR again."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function send() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); const generation = epoch.current;
    try {
      const result = await sendPersonalStaffQr({ salonId, viewerId }, code);
      if (generation !== epoch.current) return;
      if (result.error) setError(result.error);
      else { router.replace(closeHref); router.refresh(); }
    } catch { if (generation === epoch.current) setError("Connection interrupted. Retry Send; an existing invitation will be reused."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className={styles.page} style={{ padding: 0 }} data-personal-staff-connector>
    {error && <p role="alert" className={styles.notice}><WorkspaceText text={error} /></p>}
    {preview ? <section className={styles.card} aria-label="Scanned user information">
      <div className={styles.profile}><span className={styles.initial}>{preview.name.slice(0, 1)}</span><h2>{preview.name}</h2>{preview.phoneHint && <p>{preview.phoneHint}</p>}{preview.emailHint && <p>{preview.emailHint}</p>}</div>
      {preview.status !== "available" && <p role="status" className={styles.muted}><WorkspaceText text={preview.status === "connected" ? "This account is already connected to this salon." : "A connection request is already pending."} /></p>}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { setPreview(null); setCode(""); setError(""); }}><WorkspaceText text="Cancel" /></button><button type="button" className={styles.primary} disabled={busy || preview.status === "connected"} onClick={() => void send()}><WorkspaceText text={busy ? "Sending…" : "Send"} /></button></div>
    </section> : <>
      {camera ? <StaffQrScanner onCode={value => void scan(value)} onClose={closeCamera} hint="Scan their Personal ID QR from My QR." fallbackMessage="Allow camera access, or paste the Personal QR code below." /> : <button type="button" className={styles.scan} disabled={busy} onClick={() => setCamera(true)}><WorkspaceText text="Scan personal QR" /></button>}
      <details className={styles.manual}><summary><WorkspaceText text="Enter Personal QR code" /></summary><form onSubmit={event => { event.preventDefault(); void scan(manual); }}><input type="text" aria-label="Personal QR code" value={manual} onChange={event => setManual(event.target.value)} /><button type="submit" disabled={busy}><WorkspaceText text="Find account" /></button></form></details>
      {!camera && children}
    </>}
  </div>;
}
