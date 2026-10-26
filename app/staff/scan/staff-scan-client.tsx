"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { scanOffer, validScanLines } from "@/lib/staff-scan";
import type { RelayTicket } from "@/types/service-relay";
import type { ScanEntryLine, StaffScanWorkspace } from "@/types/staff-scan";
import { cancelStaffScan, connectStaffScan, loadStaffScan, saveStaffScan } from "./actions";
import { StaffQrScanner } from "./qr-scanner";
import styles from "./scan.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const draftPrefix = (salonId: string, staffId: string) => `reylumi:staff-scan:${salonId}:${staffId}:`;

export function StaffScanClient({ salonId, staffId, initial, initialError }: { salonId: string; staffId: string; initial: StaffScanWorkspace | null; initialError?: string }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError ?? "");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
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
      const active = new Set(result.data.current.flatMap(ticket => ticket.offers.filter(o => o.staffId === result.data!.staffId && o.status === "working").map(o => o.id)));
      const prefix = draftPrefix(salonId, result.data.staffId);
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key?.startsWith(prefix) && !active.has(key.slice(prefix.length))) sessionStorage.removeItem(key);
        }
      } catch { /* Editing still works when optional storage is unavailable. */ }
      setEditing(current => {
        if (!current) return null;
        const ticket = result.data!.current.find(t => t.visitId === current);
        if (ticket && scanOffer(ticket, result.data!.staffId)?.status === "working") return current;
        return null;
      });
    } catch { if (requestEpoch === epoch.current) setError("Reconnect to refresh. POS can still finish your saved work."); }
    finally { loading.current = false; }
  }, [salonId, staffId]);
  useEffect(() => {
    const connection = () => { setOnline(navigator.onLine); if (navigator.onLine) void refresh(); };
    const reset = () => { epoch.current++; setData(null); setEditing(null); setCamera(false); setError(""); };
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
    pending.current = true; setBusy(true); setCamera(false); setError(""); setNotice("");
    const requestEpoch = ++epoch.current;
    try {
      const result = await connectStaffScan({ salonId, staffId }, input);
      if (requestEpoch !== epoch.current) return;
      if (!result.ticket) { setError(result.error ?? "Could not connect this customer."); await refresh(); return; }
      const ticket = result.ticket;
      setData(current => current ? { ...current, current: [ticket, ...current.current.filter(t => t.visitId !== ticket.visitId)] } : current);
      setEditing(scanOffer(ticket, staffId)?.status === "working" ? ticket.visitId : null);
      await refresh();
    } catch { if (requestEpoch === epoch.current) { setError("Connection interrupted. Refresh before choosing another customer."); await refresh(); } }
    finally { pending.current = false; setBusy(false); }
  }
  const currentTicket = data?.current.find(ticket => ticket.visitId === editing);
  return <main className={styles.page} data-staff-scan>
    <h1 data-scan-title><WorkspaceText text="Scan" /></h1>
    {!online && <p className={styles.notice} role="status"><WorkspaceText text="Offline. POS can finish saved work. Reconnect before sending changes." /></p>}
    {error && <div className={styles.notice} role="alert"><WorkspaceText text={error} /> <button type="button" onClick={() => void refresh()}><WorkspaceText text="Refresh" /></button></div>}
    {notice && <p className={styles.saved} role="status"><WorkspaceText text={notice} /></p>}
    {currentTicket && data ? <ScanEditor key={scanOffer(currentTicket, data.staffId)?.id} ticket={currentTicket} workspace={data} salonId={salonId} online={online}
      onClose={() => setEditing(null)} onRefresh={refresh} onSaved={(ticket, done) => {
        epoch.current++;
        setData(current => current ? { ...current, current: [ticket, ...current.current.filter(t => t.visitId !== ticket.visitId)] } : current);
        setEditing(null); setNotice(done ? "Done. Turn updated." : "Saved with POS."); void refresh();
      }} /> : <>
      {!!data?.current.length && <section aria-label="Your current work" className={styles.section}>
        <div className={styles.heading}><h2><WorkspaceText text="Your current work" /></h2><Link href="/staff/my-work"><WorkspaceText text="Your tickets" /></Link></div>
        <div className={styles.list}>{data.current.map(ticket => {
          const offer = scanOffer(ticket, data.staffId); if (!offer) return null;
          const amount = ticket.lines.filter(line => line.staffId === data.staffId).reduce((sum, line) => sum + line.amount, 0);
          return <button type="button" className={`${styles.customer} ${styles.current}`} key={ticket.visitId} disabled={busy || offer.status === "done"} onClick={() => { setEditing(ticket.visitId); setNotice(""); }}>
            <span className={styles.avatar}>{ticket.customerName.slice(0, 1)}</span><span className={styles.details}><strong>{ticket.customerName} · #{ticket.queueNumber}</strong>
              <span className={styles.amount}>{amount ? money(amount) : <WorkspaceText text="Enter amount" />}</span>
              <span className={styles.meta}><span className={styles.badge}><WorkspaceText text={offer.status === "done" ? "Done" : "Working"} /></span>{offer.status === "working" && <span className={`${styles.badge} ${styles.holding}`}><WorkspaceText text="Holding" /></span>}</span>
              <span className={styles.muted}><WorkspaceText text={offer.status === "done" ? "Waiting for POS payment" : "Tap to edit or Done"} /></span>
            </span><span aria-hidden>›</span>
          </button>;
        })}</div>
      </section>}
      {camera ? <StaffQrScanner onCode={code => void connect({ code })} onClose={closeCamera} /> : <button type="button" className={styles.scanButton} disabled={busy || !online || !data?.enabled} onClick={() => setCamera(true)}><WorkspaceNavigationIcon name="qr" /><WorkspaceText text="Scan QR" /></button>}
      {data && !data.enabled && <p className={styles.empty}><WorkspaceText text="Scan requires Check-in Receipt or Phone Checkin for this salon." /></p>}
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

function ScanEditor({ ticket, workspace, salonId, online, onClose, onRefresh, onSaved }: {
  ticket: RelayTicket; workspace: StaffScanWorkspace; salonId: string; online: boolean;
  onClose: () => void; onRefresh: () => Promise<void>; onSaved: (ticket: RelayTicket, done: boolean) => void;
}) {
  const translate = useWorkspaceTranslation();
  const offer = scanOffer(ticket, workspace.staffId)!;
  const savedLines = ticket.lines.filter(line => line.offerId === offer.id);
  const [lines, setLines] = useState<ScanEntryLine[]>(() => savedLines.map(line => ({ id: line.id, serviceId: line.serviceId, amount: String(line.amount) })));
  const [revision, setRevision] = useState(ticket.revision);
  const [searching, setSearching] = useState(false), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const pending = useRef(false), alive = useRef(true);
  const amountInputs = useRef(new Map<string, HTMLInputElement>());
  const focusService = useRef<string | null>(null);
  const key = `${draftPrefix(salonId, workspace.staffId)}${offer.id}`;
  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => {
      try {
        const draft = JSON.parse(sessionStorage.getItem(key) ?? "null");
        if (draft && Array.isArray(draft.lines) && draft.lines.length <= 30 && draft.lines.every((line: ScanEntryLine) => line && typeof line.id === "string" && typeof line.serviceId === "string" && typeof line.amount === "string") && Number.isInteger(draft.revision) && Date.now() - draft.at < 12 * 60 * 60 * 1000) {
          setLines(draft.lines); setRevision(draft.revision); setDirty(true);
          if (draft.revision !== ticket.revision) setError("POS changed this work. Use the latest POS values before continuing.");
        }
      } catch { /* Optional drafts must never block entry. */ }
      setRestored(true);
    }, 0);
    return () => { alive.current = false; clearTimeout(timer); };
    // Restore once per offer. Live revisions are handled separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!restored) return;
    try { if (dirty) sessionStorage.setItem(key, JSON.stringify({ lines, revision, at: Date.now() })); else sessionStorage.removeItem(key); }
    catch { /* Entries remain in memory if storage is unavailable. */ }
  }, [lines, revision, dirty, restored, key]);
  const conflict = ticket.revision !== revision;
  useEffect(() => {
    if (focusService.current) { amountInputs.current.get(focusService.current)?.focus(); focusService.current = null; }
  }, [lines]);
  function choose(serviceId: string) {
    setDirty(true); setError("");
    if (amountInputs.current.has(serviceId)) amountInputs.current.get(serviceId)?.focus(); else focusService.current = serviceId;
    setLines(current => current.some(line => line.serviceId === serviceId) ? current : [...current, { id: crypto.randomUUID(), serviceId, amount: "" }]);
  }
  async function send(done: boolean) {
    if (pending.current || !restored) return;
    if (!online) { setError("Reconnect before sending. Your entries are kept; POS can finish saved work."); return; }
    if (conflict) { setError("POS changed this work. Use the latest POS values before continuing."); return; }
    if (!validScanLines(lines)) { setError("Choose a service and enter a positive amount for each service."); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await saveStaffScan({ salonId, staffId: workspace.staffId }, { offerId: offer.id, revision, lines, done });
      if (!alive.current) return;
      if (!result.ticket) { setError(result.error ?? "Could not save. Your entries are kept."); await onRefresh(); return; }
      try { sessionStorage.removeItem(key); } catch {} setDirty(false); onSaved(result.ticket, done);
    } catch { if (alive.current) { setError("Connection interrupted. Your entries are kept. Reconnect and review before retrying."); await onRefresh(); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function cancel() {
    if (pending.current) return;
    if (savedLines.length) { try { sessionStorage.removeItem(key); } catch {} setDirty(false); onClose(); return; }
    if (!online) { setError("Reconnect to release this customer. POS can still manage the connection."); return; }
    pending.current = true; setBusy(true);
    try {
      const result = await cancelStaffScan({ salonId, staffId: workspace.staffId }, { offerId: offer.id, revision });
      if (!alive.current) return;
      if (result.error) { setError(result.error); await onRefresh(); return; }
      try { sessionStorage.removeItem(key); } catch {} setDirty(false); onClose(); await onRefresh();
    } catch { if (alive.current) setError("Reconnect to release this customer."); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const requested = ticket.requestedServices;
  function standBy() { if (dirty && validScanLines(lines)) void send(false); else onClose(); }
  return <section className={styles.editor} aria-label="Enter services and amounts" data-scan-editor>
    <div className={styles.editorHeader}><div><h2>{ticket.customerName} · #{ticket.queueNumber}</h2><p className={styles.meta}><span className={styles.badge}><WorkspaceText text="Working" /></span><span className={`${styles.badge} ${styles.holding}`}><WorkspaceText text="Holding" /></span></p></div><button type="button" disabled={busy} onClick={standBy} aria-label={translate("Close")}>×</button></div>
    <h3><WorkspaceText text="Requested services" /></h3>
    <div className={styles.chips}>{requested.map(service => <button type="button" className={styles.chip} key={service.id} disabled={busy || !workspace.services.some(s => s.id === service.id)} aria-pressed={lines.some(line => line.serviceId === service.id)} onClick={() => choose(service.id)}>{service.name}</button>)}</div>
    {!requested.length && <p className={styles.muted}><WorkspaceText text="No services selected at check-in." /></p>}
    <button type="button" disabled={busy} onClick={() => setSearching(!searching)}><WorkspaceText text="Find & add service" /></button>
    {searching && <div className={styles.search}><input aria-label={translate("Find services")} placeholder={translate("Find services")} value={query} onChange={event => setQuery(event.target.value)} autoFocus /><div className={styles.searchResults}>{workspace.services.filter(service => service.name.toLowerCase().includes(query.toLowerCase()) && !lines.some(line => line.serviceId === service.id)).map(service => <button key={service.id} type="button" disabled={busy} onClick={() => { choose(service.id); setSearching(false); setQuery(""); }}>{service.name} <span className={styles.muted}>{money(service.price)}</span></button>)}</div></div>}
    <form onSubmit={event => { event.preventDefault(); void send(false); }}>
      {lines.map((line, index) => <div className={styles.line} key={line.id}><label>{workspace.services.find(service => service.id === line.serviceId)?.name ?? ticket.lines.find(saved => saved.id === line.id)?.serviceName ?? "Service"}<span className={styles.moneyInput}><span aria-hidden>$</span><input ref={node => { if (node) amountInputs.current.set(line.serviceId, node); else amountInputs.current.delete(line.serviceId); }} aria-label={translate("Amount") + ` ${index + 1}`} inputMode="decimal" enterKeyHint="done" placeholder="0.00" disabled={busy || !restored} value={line.amount} onChange={event => {
        if (/^\d*(\.\d{0,2})?$/.test(event.target.value)) { setDirty(true); setError(""); setLines(current => current.map(row => row.id === line.id ? { ...row, amount: event.target.value } : row)); }
      }} onBlur={event => {
        const next = event.relatedTarget;
        if ((!next || !(next instanceof Element) || !next.closest("[data-scan-editor]")) && dirty && validScanLines(lines) && !conflict) void send(false);
      }} /></span></label><button type="button" disabled={busy || (savedLines.length > 0 && lines.length === 1)} aria-label={translate("Remove service") + ` ${index + 1}`} onClick={() => { setDirty(true); setLines(current => current.filter(row => row.id !== line.id)); }}>×</button></div>)}
      <button type="submit" className={styles.hiddenSubmit} tabIndex={-1} aria-label="Finish amount entry" />
    </form>
    {!!lines.length && <div className={styles.total}><span><WorkspaceText text="Services total" /></span><strong>{money(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0))}</strong></div>}
    <p className={styles.muted}><WorkspaceText text="Finish entering amounts to save automatically." /></p>
    {(error || conflict) && <div className={styles.notice} role="alert"><WorkspaceText text={error || "POS changed this work. Use the latest POS values before continuing."} />{conflict && <button type="button" onClick={() => { setLines(savedLines.map(line => ({ id: line.id, serviceId: line.serviceId, amount: String(line.amount) }))); setRevision(ticket.revision); setDirty(false); setError(""); }}><WorkspaceText text="Use POS values" /></button>}{!conflict && validScanLines(lines) && <button type="button" disabled={busy || !online} onClick={() => void send(false)}><WorkspaceText text="Retry" /></button>}</div>}
    <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void cancel()}><WorkspaceText text="Cancel" /></button><button type="button" className={styles.primary} disabled={busy} onClick={standBy}><WorkspaceText text="Stand by" /></button></div>
    {savedLines.length > 0 && <div className={styles.actions}><button type="button" className={styles.finish} disabled={busy || !online || conflict} onClick={() => void send(true)}><WorkspaceText text={busy ? "Sending…" : "Done"} /></button></div>}
  </section>;
}
