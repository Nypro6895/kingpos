"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QrCodeTile } from "@/components/qr-code-tile";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import { WorkspaceText } from "@/components/workspace-language";
import { StaffQrScanner } from "@/app/staff/scan/qr-scanner";
import { historyTicketTotals } from "@/lib/booking-history";
import { personalSalonEntry, personalVisitLabel } from "@/lib/personal-qr";
import type { PersonalQrCatalog, PersonalQrVisit, PersonalQrWorkspace } from "@/types/personal-qr";
import { checkinPersonalQr, loadPersonalQr, loadPersonalQrCatalog } from "./actions";
import styles from "./personal-qr.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
export function PersonalQrClient({ viewerId, initial, initialError, entry, initialCatalog, initialVisitId }: {
  viewerId: string; initial: PersonalQrWorkspace | null; initialError?: string;
  entry?: string; initialCatalog?: PersonalQrCatalog; initialVisitId?: string;
}) {
  const [data, setData] = useState(initial), [error, setError] = useState(initialError ?? "");
  const [online, setOnline] = useState(true), [now, setNow] = useState(() => Date.now());
  const [camera, setCamera] = useState(false), [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState(initialCatalog ?? null), [entryId, setEntryId] = useState(entry ?? "");
  const [selected, setSelected] = useState<string[]>([]), [visitId, setVisitId] = useState(initialVisitId ?? null);
  const [manualCode, setManualCode] = useState("");
  const requestId = useRef<string | null>(null), pending = useRef(false), loading = useRef(false), epoch = useRef(0);
  const closeCamera = useCallback(() => setCamera(false), []);
  const refresh = useCallback(async () => {
    if (loading.current || !navigator.onLine) return;
    loading.current = true; const generation = epoch.current;
    try {
      const result = await loadPersonalQr(viewerId);
      if (generation !== epoch.current) return;
      if (result.data?.userId === viewerId) { setData(result.data); setError(""); setNow(Date.now()); }
      else setError(result.error ?? "Could not refresh My QR.");
    } catch { if (generation === epoch.current) setError("Reconnect to update status and prices."); }
    finally { loading.current = false; }
  }, [viewerId]);
  useEffect(() => {
    const connection = () => { setOnline(navigator.onLine); setNow(Date.now()); if (navigator.onLine && document.visibilityState === "visible") void refresh(); };
    const reset = () => { epoch.current++; setData(null); setCatalog(null); setVisitId(null); setCamera(false); setError(""); };
    const timer = setInterval(() => { setNow(Date.now()); if (navigator.onLine && document.visibilityState === "visible") void refresh(); }, 5000);
    const first = setTimeout(connection, 0);
    window.addEventListener("online", connection); window.addEventListener("offline", connection); window.addEventListener("focus", connection);
    document.addEventListener("visibilitychange", connection); window.addEventListener("reylumi:experience-reset", reset);
    return () => {
      // Pending snapshots cannot cross a retained-page/account boundary.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      clearInterval(timer); clearTimeout(first); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); window.removeEventListener("focus", connection);
      document.removeEventListener("visibilitychange", connection); window.removeEventListener("reylumi:experience-reset", reset);
    };
  }, [refresh]);
  async function scan(code: string) {
    const nextEntry = personalSalonEntry(code);
    if (!nextEntry) { setCamera(false); setError("Scan the QR on the salon check-in screen."); return; }
    if (pending.current || !online) return;
    pending.current = true; setBusy(true); setCamera(false); setError(""); const generation = ++epoch.current;
    try {
      const result = await loadPersonalQrCatalog(viewerId, nextEntry);
      if (generation !== epoch.current) return;
      if (result.catalog) { setCatalog(result.catalog); setEntryId(nextEntry); setSelected([]); requestId.current = null; setVisitId(null); }
      else setError(result.error ?? "Check-in is unavailable.");
    } catch { if (generation === epoch.current) setError("Reconnect and scan the salon QR again."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function checkin() {
    if (pending.current || !online || !selected.length) return;
    pending.current = true; setBusy(true); setError(""); requestId.current ??= crypto.randomUUID(); const generation = ++epoch.current;
    try {
      const result = await checkinPersonalQr(viewerId, { entry: entryId, services: selected, requestId: requestId.current });
      if (generation !== epoch.current) return;
      if (result.visitId) { setVisitId(result.visitId); setCatalog(null); await refresh(); }
      else setError(result.error ?? "Could not check in. Your selections are kept.");
    } catch { if (generation === epoch.current) setError("Connection interrupted. Retry with the same selections to recover your check-in."); }
    finally { pending.current = false; setBusy(false); }
  }
  const visit = data?.visits.find(item => item.visitId === visitId);
  const activeVisits = data?.visits.filter(item => !["paid", "cancelled"].includes(item.status)) ?? [];
  return <main className={styles.page} data-personal-qr>
    <h1 data-personal-qr-title><WorkspaceText text={catalog ? "Choose services" : visitId ? "Your check-in" : "My QR"} /></h1>
    {!online && <p role="status" className={styles.notice}><WorkspaceText text="Offline. Showing the last saved status and prices." /></p>}
    {error && <div role="alert" className={styles.notice}><WorkspaceText text={error} /><div><button type="button" disabled={!online || busy} onClick={() => void refresh()}><WorkspaceText text="Refresh" /></button> <Link href="/account"><WorkspaceText text="Account" /></Link></div></div>}
    {catalog ? <section className={styles.card} aria-label="Choose check-in services">
      <h2>{catalog.salonName}</h2>
      <form onSubmit={event => { event.preventDefault(); void checkin(); }}>
        <p className={styles.muted}><WorkspaceText text="Select up to 8 services." /></p>
        <fieldset className={styles.services} disabled={busy || !online}><legend><WorkspaceText text="Services" /></legend>{catalog.services.map(service => <label key={service.id}><input type="checkbox" checked={selected.includes(service.id)} disabled={!selected.includes(service.id) && selected.length >= 8} onChange={event => { requestId.current = null; setSelected(values => event.target.checked ? values.length < 8 ? [...values, service.id] : values : values.filter(id => id !== service.id)); }} /><span>{service.name}</span></label>)}</fieldset>
        <button type="submit" className={`${styles.primary} ${styles.full}`} disabled={busy || !online || !selected.length}><WorkspaceText text={busy ? "Checking in…" : "Check in"} /></button>
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => { setCatalog(null); setSelected([]); }}><WorkspaceText text="Cancel" /></button></div>
      </form>
    </section> : visitId ? <>
      <button type="button" className={styles.topLink} onClick={() => setVisitId(null)}><WorkspaceText text="My personal QR" /></button>
      {visit ? <PersonalVisit visit={visit} online={online} /> : <p role="status" className={styles.empty}><WorkspaceText text="Refreshing your check-in…" /></p>}
    </> : <>
      <section className={`${styles.card} ${styles.identity}`} aria-label="Personal identity QR">
        {data && now < Date.parse(data.expiresAt) ? <QrCodeTile className={styles.qrTile} valueToEncode={data.code} ariaLabel="Your Personal ID QR" fallbackMessage="Refresh to display your Personal ID QR." /> : <p className={styles.empty}><WorkspaceText text="Reconnect to refresh your Personal ID QR." /></p>}
        <h2><WorkspaceText text="Personal ID" /></h2><p className={styles.muted}><WorkspaceText text="Show this QR to connect with a salon." /></p>
      </section>
      {camera ? <StaffQrScanner onCode={code => void scan(code)} onClose={closeCamera} hint="Point at the QR on the salon check-in screen." fallbackMessage="Allow camera access, or paste the salon check-in link below." /> : <button type="button" className={styles.scan} disabled={busy || !online || !data} onClick={() => setCamera(true)}><WorkspaceNavigationIcon name="qr" /><WorkspaceText text="Scan salon QR" /></button>}
      <details className={styles.manual}><summary><WorkspaceText text="Have a check-in link?" /></summary><form onSubmit={event => { event.preventDefault(); void scan(manualCode); }}><input type="text" aria-label="Salon check-in link" value={manualCode} onChange={event => setManualCode(event.target.value)} /><button type="submit" disabled={!online || busy}><WorkspaceText text="Open check-in" /></button></form></details>
      {!!activeVisits.length && <section className={styles.list} aria-label="Current check-ins"><h2><WorkspaceText text="Your check-ins" /></h2>{activeVisits.map(item => <VisitRow key={item.visitId} visit={item} onOpen={() => setVisitId(item.visitId)} />)}</section>}
      <div className={styles.heading}><h2><WorkspaceText text="Recent visits" /></h2><Link href="/activity"><WorkspaceText text="History" /></Link></div>
      <div className={styles.list}>{data?.visits.filter(item => ["paid", "cancelled"].includes(item.status)).slice(0, 3).map(item => <VisitRow key={item.visitId} visit={item} onOpen={() => setVisitId(item.visitId)} />)}</div>
    </>}
    {data && <p className={styles.muted}><WorkspaceText text="Last updated" /> · {new Date(data.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
  </main>;
}

function VisitRow({ visit, onOpen }: { visit: PersonalQrVisit; onOpen: () => void }) {
  return <button type="button" className={styles.visitRow} onClick={onOpen}><span><strong>{visit.salonName}</strong><span className={styles.muted}>#{visit.queueNumber ?? "—"}</span></span><span className={`${styles.badge} ${visit.ready ? styles.readyBadge : ""}`}><WorkspaceText text={personalVisitLabel(visit.status, Boolean(visit.ready))} /></span></button>;
}
function PersonalVisit({ visit, online }: { visit: PersonalQrVisit; online: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const finished = ["paid", "cancelled"].includes(visit.status);
  const totals = visit.receipt ? historyTicketTotals(visit.receipt) : null;
  const lines = visit.receipt ? visit.receipt.services.map(line => ({ id: line.id, serviceName: line.name, staffName: line.staffName ?? "", amount: line.lineTotal })) : visit.lines;
  return <section className={styles.card} aria-label="Visit status and prices">
    <div className={styles.heading}><h2>{visit.salonName}</h2><span className={`${styles.badge} ${visit.ready ? styles.readyBadge : ""}`}><WorkspaceText text={personalVisitLabel(visit.status, Boolean(visit.ready))} /></span></div>
    <p>#{visit.queueNumber ?? "—"}</p>
    {visit.ready && <div role="status" className={styles.ready}><strong><WorkspaceText text="Your staff is ready" /></strong><p>{visit.ready.staffName ?? ""}{visit.ready.chair && <> · <WorkspaceText text="Chair" /> {visit.ready.chair}</>}</p></div>}
    {!!visit.workingStaff.length && !finished && <p className={styles.muted}>{visit.workingStaff.join(" · ")} · <WorkspaceText text="Working" /></p>}
    {!finished && <div className={visit.status === "waiting" || expanded ? "" : styles.smallQr}>
      <QrCodeTile className={styles.qrTile} ariaLabel="Your check-in QR" valueToEncode={`reylumi:checkin:${visit.visitId}`} fallbackMessage="Tell staff your check-in number." />
      <p className={styles.muted}><WorkspaceText text="Show this visit QR to your staff." /></p>
      {visit.status !== "waiting" && <button type="button" onClick={() => setExpanded(!expanded)}><WorkspaceText text={expanded ? "Hide QR" : "Show QR"} /></button>}
    </div>}
    {lines.length ? <>{lines.map(line => <div className={styles.row} key={line.id}><span>{line.serviceName}<small>{line.staffName}</small></span><strong>{money(Number(line.amount))}</strong></div>)}
      {totals && <><div className={styles.row}><span><WorkspaceText text="Tip" /></span><strong>{money(totals.tip_amount)}</strong></div>{totals.discount_amount > 0 && <div className={styles.row}><span><WorkspaceText text="Discount" /></span><strong>−{money(totals.discount_amount)}</strong></div>}{totals.tax_amount > 0 && <div className={styles.row}><span><WorkspaceText text="Tax" /></span><strong>{money(totals.tax_amount)}</strong></div>}</>}
      <div className={styles.total}><span><WorkspaceText text={visit.status === "paid" ? "Total paid" : "Current services total"} /></span><strong>{money(totals?.total ?? lines.reduce((sum, line) => sum + Number(line.amount), 0))}</strong></div>
    </> : <><h3><WorkspaceText text="Requested services" /></h3>{visit.requestedServices.map(service => <p key={service.id}>{service.name}</p>)}<p className={styles.muted}><WorkspaceText text="Prices appear when staff save them." /></p></>}
    {!finished && <p className={styles.muted}><WorkspaceText text={online ? "Amount may change until POS finalizes." : "Reconnect to refresh status and prices."} /></p>}
    {visit.status === "paid" && visit.ticketId && <Link className={styles.receiptLink} href={`/activity/receipts/${visit.ticketId}`}><WorkspaceText text="View receipt" /></Link>}
    {finished && <p className={styles.muted}><WorkspaceText text={visit.status === "cancelled" ? "Visit cancelled. This visit QR is no longer active." : "Visit completed. This visit QR is no longer active."} /></p>}
  </section>;
}
