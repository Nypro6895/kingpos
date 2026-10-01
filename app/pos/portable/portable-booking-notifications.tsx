"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { portableBookingNotifications, portableManageBooking, type PortableBookAppointment } from "./actions";
import { usePosResourceRefresh } from "@/lib/pos-workspace-sync";
import styles from "./portable-booking-notifications.module.css";

export function PortableBookingNotifications({ salonId, timezone, canConfirm }: {
  salonId: string; timezone: string; canConfirm: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const revision = useRef(0);
  const confirming = useRef(false);
  const alive = useRef(true);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PortableBookAppointment[]>([]);
  const [confirmed, setConfirmed] = useState<PortableBookAppointment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const refresh = useCallback(async () => {
    if (!navigator.onLine || confirming.current) return;
    const version = ++revision.current;
    try {
      const appointments = await portableBookingNotifications();
      if (!alive.current || version !== revision.current) return;
      setRows(appointments);
      setConfirmed(previous => previous.filter(item => !appointments.some(row => row.id === item.id)));
      setLoaded(true);
      setError("");
    } catch {
      if (alive.current && version === revision.current) setError("Could not refresh appointments. Try again.");
    }
  }, []);
  usePosResourceRefresh(salonId, "booking", refresh);

  useEffect(() => {
    alive.current = true;
    const connectivity = () => setOffline(!navigator.onLine);
    connectivity();
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    return () => { alive.current = false; window.removeEventListener("online", connectivity); window.removeEventListener("offline", connectivity); };
  }, []);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() { setOpen(false); bell.current?.focus(); }

  async function confirm(item: PortableBookAppointment) {
    if (confirming.current || !canConfirm || !navigator.onLine) return;
    confirming.current = true;
    revision.current++;
    setBusy(item.id);
    setError("");
    try {
      const result = await portableManageBooking({ bookingId: item.id, action: "confirm", payload: { updatedAt: item.updatedAt } });
      if (!alive.current) return;
      if (!result.ok) { setError(result.error); return; }
      setRows(current => current.filter(row => row.id !== item.id));
      setConfirmed(current => [result.data, ...current.filter(row => row.id !== item.id)]);
      setAnnouncement(`Appointment for ${item.customerName || "Walk-in customer"} confirmed.`);
      closeButton.current?.focus();
      // The workspace broker receives this on its separate channel instance.
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(`kingpos:workspace:${salonId}`);
        channel.postMessage({ salonId, resource: "booking", ids: [item.id] });
        channel.close();
      }
    } catch {
      if (alive.current) setError("Could not confirm this appointment. Reconnect and try again.");
    } finally {
      confirming.current = false;
      if (alive.current) setBusy(null);
    }
  }

  return <div className={styles.root} ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("section button:not(:disabled)") ?? []);
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }}>
    <button ref={bell} type="button" className={styles.bell} aria-label={`Appointment notifications${loaded ? `, ${rows.length} pending` : ""}`} aria-expanded={open} aria-controls={id}
      onClick={() => { if (open) close(); else { setConfirmed([]); setOpen(true); void refresh(); } }}>
      <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {rows.length > 0 && <span aria-hidden="true" className={styles.badge}>{rows.length > 99 ? "99+" : rows.length}</span>}
    </button>
    <span className="sr-only" role="status">{announcement}</span>
    {open && <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
      <div className={styles.heading}><div><h2 id={`${id}-title`}>New appointments</h2><p>{loaded ? `${rows.length} pending` : "Loading…"}</p></div><button ref={closeButton} className={styles.close} type="button" aria-label="Close appointment notifications" onClick={close}>×</button></div>
      {offline && <p className={styles.message} role="status">Offline. Showing the last update. Reconnect to confirm appointments.</p>}
      {error && <div className={`${styles.message} ${styles.error}`} role="alert">{error} <button type="button" className={styles.close} disabled={offline || !!busy} onClick={() => void refresh()}>Retry</button></div>}
      {loaded && !error && rows.length === 0 && confirmed.length === 0 && <p className={styles.message}>No new appointments. You’re all caught up.</p>}
      {!canConfirm && <p className={styles.message}>This device can view appointments. Confirmation requires booking edit access.</p>}
      <ul className={styles.list}>{[...rows, ...confirmed].map(item => {
        const done = confirmed.some(row => row.id === item.id);
        const staffNames = [...new Set((item.lines ?? []).map(line => line.staffName?.trim()).filter((name): name is string => !!name))];
        const staffLabel = staffNames.join(", ") || item.staffName?.trim() || "Unassigned";
        return <li className={styles.item} key={item.id}>
          <div className={styles.details}>
          <strong>{item.customerName || "Walk-in customer"}</strong>
          <p><time dateTime={item.startAt}>{new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startAt))}</time></p>
          <p>{item.serviceNames.join(", ") || item.notes || "Appointment"}</p>
          <p className={styles.staff}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg><span>Staff: {staffLabel}</span></p>
          </div>
          <div className={styles.footer}><span className={`${styles.status} ${done ? styles.confirmed : ""}`}>{done ? "Confirmed" : "Pending"}</span>
            {!done && <button type="button" className={styles.confirm} disabled={!canConfirm || offline || !!busy} aria-label={`Confirm appointment for ${item.customerName || "Walk-in customer"}`} onClick={() => void confirm(item)}>{busy === item.id ? "Confirming…" : "Confirm"}</button>}
          </div>
        </li>;
      })}</ul>
    </section>}
  </div>;
}
