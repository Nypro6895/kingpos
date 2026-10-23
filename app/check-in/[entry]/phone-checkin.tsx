"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { phoneRelayCheckin } from "./actions";
import styles from "@/app/service-relay/service-relay.module.css";
export function PhoneRelayCheckin({ entry, salonName, services, initialName = "", initialPhone = "" }: { entry: string; salonName: string; services: { id: string; name: string }[]; initialName?: string; initialPhone?: string }) {
  const [name, setName] = useState(initialName), [phone, setPhone] = useState(initialPhone), [selected, setSelected] = useState<string[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const request = useRef<string | null>(null), inFlight = useRef(false);
  const router = useRouter();
  return <main className={`${styles.panel} ${styles.pass}`}><h1 className="text-2xl font-semibold">{salonName}</h1><p>Check in · Choose your services</p><form onSubmit={async event => {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); request.current ??= crypto.randomUUID();
    try { const result = await phoneRelayCheckin({ entry, phone, name, services: selected, request: request.current }); if (result.error) setError(result.error); else if (result.pass) router.replace(`/visit/${result.pass}`); else setError("Check-in saved. Ask the front desk for your number."); }
    catch { setError("Reconnect and retry. Your information is kept."); }
    finally { inFlight.current = false; setBusy(false); }
  }}><label>Name<input autoComplete="name" required maxLength={100} disabled={busy} value={name} onChange={e => setName(e.target.value)} /></label><label>Phone<input autoComplete="tel" type="tel" required maxLength={25} disabled={busy} value={phone} onChange={e => setPhone(e.target.value)} /></label><fieldset disabled={busy} className={styles.checklist}><legend>Services</legend>{services.map(s => <label key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />{s.name}</label>)}</fieldset><button className={styles.primary} disabled={busy || !selected.length}>{busy ? "Checking in…" : "Check in"}</button>{error && <p role="alert">{error}</p>}</form></main>;
}
