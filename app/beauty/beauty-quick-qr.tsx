"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { QrCodeTile } from "@/components/qr-code-tile";
import { loadPersonalQr } from "@/app/qr/actions";
import type { BeautyProfileSummary } from "@/types/beauty";
import type { PersonalQrWorkspace } from "@/types/personal-qr";
import { BeautyHomeIcon } from "./beauty-home-icon";

export function BeautyQuickQr({ viewerId, profile }: { viewerId: string; profile: BeautyProfileSummary }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const [data, setData] = useState<PersonalQrWorkspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const requests = generation;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(timer); requests.current++; };
  }, [viewerId, open]);

  async function refresh() {
    const request = ++generation.current;
    setData(null);
    setError("");
    setBusy(true);
    try {
      const result = await loadPersonalQr(viewerId);
      if (request !== generation.current || !dialog.current?.open) return;
      setNow(Date.now());
      if (result.data?.userId === viewerId && Date.parse(result.data.expiresAt) > Date.now()) setData(result.data);
      else setError(result.error ? "Your QR could not be loaded. Please try again." : "Refresh to display your Personal ID QR.");
    } catch {
      if (request === generation.current) setError("Reconnect and try again.");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  function close() {
    generation.current++;
    setOpen(false);
    setData(null);
    setBusy(false);
    trigger.current?.focus();
  }

  return <>
    <button className="beauty-home-qr-trigger" type="button" ref={trigger} aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); setOpen(true); void refresh(); }}><BeautyHomeIcon name="qr"/><span>My QR</span></button>
    <dialog className="beauty-quick-qr" ref={dialog} aria-labelledby="beauty-quick-qr-title" onClose={close} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
    }}>
      <div className="beauty-quick-qr-handle" aria-hidden="true"/>
      <div className="beauty-quick-qr-header"><h2 id="beauty-quick-qr-title">My QR</h2><button type="button" className="beauty-quick-qr-close" aria-label="Close My QR" onClick={() => dialog.current?.close()}>×</button></div>
      <div className="beauty-quick-qr-body" aria-live="polite" aria-busy={busy}>
        <div className="beauty-home-avatar">{profile.avatarUrl ? <Image src={profile.avatarUrl} alt="" width={52} height={52}/> : profile.initials}</div>
        <span>{profile.displayName}</span>
        {busy ? <p>Loading your QR…</p> : data && data.userId === viewerId && now < Date.parse(data.expiresAt) ? <><div className="beauty-quick-qr-code"><QrCodeTile valueToEncode={data.code} ariaLabel="Your Personal ID QR" fallbackMessage="Open My QR to refresh your code."/></div><p>Show this QR to connect with a salon.</p></> : <><p role="status">{error || "Your QR expired. Refresh to display a new code."}</p><button className="beauty-quick-qr-retry" type="button" onClick={() => void refresh()}>Refresh QR</button></>}
      </div>
      <Link href="/qr" className="beauty-quick-qr-open" onClick={() => dialog.current?.close()}>Open My QR →</Link>
    </dialog>
  </>;
}
