"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { scanOffer } from "@/lib/staff-scan";
import { reconcileStaffScanDrafts, staffDraftStorageWarning } from "@/lib/staff-scan-draft";
import type { StaffScanWorkspace } from "@/types/staff-scan";
import { connectStaffScan, loadStaffScan } from "./actions";
import { StaffQrScanner } from "./qr-scanner";
import { ScanTicketEditor } from "./scan-ticket-editor";
import styles from "./scan.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export function StaffScanClient({ salonId, staffId, initial, initialError }: { salonId: string; staffId: string; initial: StaffScanWorkspace | null; initialError?: string }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError ?? "");
  const [scanError, setScanError] = useState("");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const loading = useRef(false), pending = useRef(false), epoch = useRef(0);
  const closeCamera = useCallback(() => setCamera(false), []);
  const refresh = useCallback(async () => {
    if (loading.current || !navigator.onLine) return;
    loading.current = true;
    const requestEpoch = epoch.current;
    try {
      const result = await loadStaffScan({ salonId, staffId });
      if (requestEpoch !== epoch.current) return;
      if (!result.data) { setError(result.error ?? "Could not refresh Scan."); return; }
      setData(result.data); setError("");
      // Reconcile first, then drop drafts for settled/reassigned work. Never replay.
      const active = new Set(result.data.current.flatMap(ticket => ticket.offers.filter(o => o.staffId === result.data!.staffId && ["working", "done"].includes(o.status)).map(o => o.id)));
      setStorageWarning(reconcileStaffScanDrafts(salonId, result.data.staffId, active) ? "" : staffDraftStorageWarning);
      setEditing(current => {
        if (!current) return null;
        const ticket = result.data!.current.find(t => t.visitId === current);
        if (ticket && scanOffer(ticket, result.data!.staffId)) return current;
        return null;
      });
    } catch { if (requestEpoch === epoch.current) setError("Reconnect to refresh. POS can still finish your saved work."); }
    finally { loading.current = false; }
  }, [salonId, staffId]);
  useEffect(() => {
    const connection = () => { setOnline(navigator.onLine); if (navigator.onLine) void refresh(); };
    const reset = () => { epoch.current++; setData(null); setEditing(null); setCamera(false); setError(""); setScanError(""); };
    const initialTimer = setTimeout(connection, 0);
    const unsubscribe = subscribePosChanges(salonId, change => { if (["waiting", "tickets", "staff", "catalog"].includes(change.resource)) void refresh(); });
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    window.addEventListener("reylumi:experience-reset", reset);
    return () => {
      // Invalidate pending requests when a retained page is hidden or unmounted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      clearTimeout(initialTimer); clearInterval(timer); unsubscribe(); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); window.removeEventListener("reylumi:experience-reset", reset);
    };
  }, [refresh, salonId]);
  async function connect(input: { visitId: string } | { code: string }) {
    if (pending.current || !online) return;
    pending.current = true; setBusy(true); setCamera(false); setError(""); setScanError(""); setNotice("");
    const requestEpoch = ++epoch.current;
    try {
      const result = await connectStaffScan({ salonId, staffId }, input);
      if (requestEpoch !== epoch.current) return;
      if (!result.ticket) { setScanError(result.error ?? "Could not connect this customer."); await refresh(); return; }
      const ticket = result.ticket;
      setData(current => current ? { ...current, current: [ticket, ...current.current.filter(t => t.visitId !== ticket.visitId)] } : current);
      setEditing(scanOffer(ticket, staffId) ? ticket.visitId : null);
      await refresh();
    } catch { if (requestEpoch === epoch.current) { setScanError("Connection interrupted. Refresh before choosing another customer."); await refresh(); } }
    finally { pending.current = false; setBusy(false); }
  }
  const currentTicket = data?.current.find(ticket => ticket.visitId === editing);
  return <main className={styles.page} data-staff-scan>
    <h1 data-scan-title><WorkspaceText text="Scan" /></h1>
    {!online && <p className={styles.notice} role="status"><WorkspaceText text="Offline. POS can finish saved work. Reconnect before sending changes." /></p>}
    {error && <div className={styles.notice} role="alert"><WorkspaceText text={error} /> <button type="button" onClick={() => void refresh()}><WorkspaceText text="Refresh" /></button></div>}
    {scanError && <div className={styles.notice} role="alert"><WorkspaceText text={scanError} /> <button type="button" onClick={() => setScanError("")}><WorkspaceText text="Close" /></button></div>}
    {notice && <p className={styles.saved} role="status"><WorkspaceText text={notice} /></p>}
    {storageWarning && !currentTicket && <p className={styles.notice} role="alert"><WorkspaceText text={storageWarning} /></p>}
    {currentTicket && data ? <ScanTicketEditor key={scanOffer(currentTicket, data.staffId)?.id} ticket={currentTicket} workspace={data} salonId={salonId} online={online}
      onRefresh={refresh} onSaved={(ticket, done) => {
        epoch.current++;
        setData(current => current ? { ...current, current: [ticket, ...current.current.filter(t => t.visitId !== ticket.visitId)] } : current);
        setEditing(null); setNotice(done ? "Done. Turn updated." : "Saved with POS."); void refresh();
      }} /> : <>
      {!!data?.current.length && <section aria-label="Your current work" className={styles.section}>
        <div className={styles.heading}><h2><WorkspaceText text="Held tickets" /></h2><Link href="/staff/my-work"><WorkspaceText text="Your tickets" /></Link></div>
        <div className={styles.list}>{data.current.map(ticket => {
          const offer = scanOffer(ticket, data.staffId); if (!offer) return null;
          const amount = ticket.lines.filter(line => line.staffId === data.staffId).reduce((sum, line) => sum + line.amount, 0);
          return <button type="button" className={`${styles.customer} ${styles.current}`} key={ticket.visitId} disabled={busy} onClick={() => { setEditing(ticket.visitId); setNotice(""); }}>
            <span className={styles.avatar}>{ticket.customerName.slice(0, 1)}</span><span className={styles.details}><strong>{ticket.customerName} · #{ticket.queueNumber}</strong>
              <span className={styles.amount}>{amount ? money(amount) : <WorkspaceText text="Enter amount" />}</span>
              <span className={styles.meta}><span className={styles.badge}><WorkspaceText text={offer.status === "done" ? "Waiting for POS payment" : "Stand by"} /></span>{offer.status === "working" && <span className={`${styles.badge} ${styles.holding}`}><WorkspaceText text="Holding" /></span>}</span>
              <span className={styles.muted}><WorkspaceText text="Tap to edit or Done" /></span>
            </span><span aria-hidden>›</span>
          </button>;
        })}</div>
      </section>}
      {camera ? <StaffQrScanner onCode={code => void connect({ code })} onClose={closeCamera} /> : <button type="button" className={styles.scanButton} disabled={busy || !online || !data?.enabled} onClick={() => setCamera(true)}><WorkspaceNavigationIcon name="qr" /><WorkspaceText text="Scan QR" /></button>}
      {data && !data.enabled && <p className={styles.empty}><WorkspaceText text="Your salon owner has not enabled Scan yet." /></p>}
      {data?.enabled && <section className={styles.section} aria-label="Waiting customers"><div className={styles.heading}><h2><WorkspaceText text="Waiting" /> · {data.waiting.filter(customer => !data.current.some(t => t.visitId === customer.visitId)).length}</h2></div>
        <p className={styles.muted}><WorkspaceText text="Checked in · Not paid" /></p>
        <div className={styles.list}>{data.waiting.filter(customer => !data.current.some(t => t.visitId === customer.visitId)).map(customer => <button type="button" className={styles.customer} key={customer.visitId} disabled={busy || !online} onClick={() => void connect({ visitId: customer.visitId })}>
          <span className={styles.avatar}>{customer.customerName.slice(0, 1)}</span><span className={styles.details}><strong>{customer.customerName} · #{customer.queueNumber}</strong>
            <span className={styles.muted}>{customer.requestedServices.map(service => service.name).join(" · ") || <WorkspaceText text="Choose services" />}</span>
            {customer.workingStaffName && <span className={styles.badge}><WorkspaceText text="Working" /> · {customer.workingStaffName}</span>}
          </span><span aria-hidden>›</span></button>)}</div>
        {!data.waiting.length && <p className={styles.empty}><WorkspaceText text="No customers waiting." /></p>}
      </section>}
    </>}
  </main>;
}
