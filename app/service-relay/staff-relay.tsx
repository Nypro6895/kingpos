"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScopedUiDraft } from "@/lib/use-scoped-ui-draft";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { WorkspaceText } from "@/components/workspace-language";
import { loadServiceRelay, respondServiceRelay, saveServiceRelay, findServiceRelay } from "./actions";
import type { RelayTicket, RelayOffer, RelayWorkspace } from "@/types/service-relay";
import styles from "./service-relay.module.css";

export function StaffRelay({ salonId, scope, initialData, managedRead = false, refreshResource }: { salonId: string; scope?: string; initialData?: RelayWorkspace; managedRead?: boolean; refreshResource?: () => Promise<void> }) {
  const [data, setData] = useState<RelayWorkspace | null>(initialData ?? null);
  const [source, setSource] = useState(initialData);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [code, setCode] = useState("");
  if (managedRead && initialData && source !== initialData) { setSource(initialData); setData(initialData); setError(""); }
  const loading = useRef(false);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try { if (managedRead && refreshResource) { await refreshResource(); return; } const result = await loadServiceRelay(); if (result.data) { setData(result.data); setError(""); } else setError(result.error ?? "Could not refresh."); }
    catch { setError("Reconnect to see your next customer. Your current entries are kept."); }
    finally { loading.current = false; }
  }, [managedRead, refreshResource]);
  useEffect(() => {
    const timer = !managedRead ? setTimeout(() => { void refresh(); }, 0) : undefined;
    const unsubscribe = subscribePosChanges(salonId, change => { if (["staff", "waiting", "tickets"].includes(change.resource)) void refresh(); });
    return () => { if(timer !== undefined) clearTimeout(timer); unsubscribe(); };
  }, [salonId, refresh, managedRead]);
  useEffect(() => {
    if (!data?.installed) return;
    const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [data?.installed, refresh]);
  async function respond(id: string, accept: boolean) {
    if (busy) return;
    setBusy(true);
    try { const result = await respondServiceRelay(id, accept); if (result.error) { await refresh(); setError(result.error); } else await refresh(); }
    catch { setError("Connection interrupted. Refresh before accepting another customer."); }
    finally { setBusy(false); }
  }
  if (!data?.installed) return error ? <p role="status">{error}</p> : null;
  if (!data.tickets.some(ticket => !ticket.scanMode)) return null;
  return <section className={styles.panel} aria-label="Phone Checkin">
    <div className={styles.header}><h2><WorkspaceText text="Your next customer" /></h2><button onClick={() => setFinding(!finding)}><WorkspaceText text="Find customer" /></button></div>
    {finding && <form className={styles.actions} onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true);
      try { const result = await findServiceRelay(code); if (result.error) setError(result.error); else { setFinding(false); setCode(""); await refresh(); } }
      catch { setError("Reconnect to find the customer."); }
      finally { setBusy(false); }
    }}><input aria-label="Check-in number or QR link" placeholder="Check-in number or QR link" value={code} onChange={e => setCode(e.target.value)} /><RelayScanner onCode={setCode} /><button disabled={busy} className={styles.primary}>Find</button></form>}
    {!data.tickets.length && <div className={styles.waiting}><span className={styles.badge}>Ready</span><p>POS will send your next customer here.</p></div>}
    {data.tickets.map(ticket => {
      if (ticket.scanMode) return null;
      const offer = ticket.offers.find(o => o.staffId === data.staffId && ["offered", "working"].includes(o.status));
      if (!offer) return null;
      return offer.status === "offered" ? <article key={offer.id} className={styles.card} role="status"><h3>{ticket.customerName} · #{ticket.queueNumber}</h3><p>{offer.serviceName}</p><p className={styles.muted}>POS assigned this customer. Please respond within 60 seconds.</p><div className={styles.actions}><button disabled={busy} className={styles.primary} onClick={() => void respond(offer.id, true)}>Accept</button><button disabled={busy} onClick={() => void respond(offer.id, false)}>Decline</button></div></article>
        : <StaffServiceEditor key={offer.id} scope={scope} staffId={offer.staffId} ticket={ticket} offer={offer} services={data.services} onSaved={refresh} />;
    })}
    {error && <p role="alert" className={styles.notice}>{error}</p>}
  </section>;
}
function StaffServiceEditor({ ticket, offer, services, onSaved, scope, staffId }: { scope?: string; staffId: string; ticket: RelayTicket; offer: RelayOffer; services: RelayWorkspace["services"]; onSaved: () => Promise<void> }) {
  const initial = ticket.lines.filter(l => l.offerId === offer.id);
  const [lines, setLines] = useState(() => initial.length ? initial.map(l => ({ id: l.id, serviceId: l.serviceId, amount: String(l.amount) })) : [{ id: crypto.randomUUID(), serviceId: offer.serviceId ?? services[0]?.id ?? "", amount: "" }]);
  const [revision, setRevision] = useState(ticket.revision);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const [needsReview, setNeedsReview] = useState(false);
  const draft = useScopedUiDraft({
    scope, domain: "staff-service", params: { staffId, offerId: offer.id }, value: { lines, revision }, dirty,
    validate: (value: unknown): value is { lines: typeof lines; revision: number } => {
      const item = value as { lines?: typeof lines; revision?: number } | null;
      return Boolean(item && Number.isInteger(item.revision) && Number(item.revision) >= 0 && Array.isArray(item.lines) && item.lines.length > 0 && item.lines.length <= 100 &&
        item.lines.every(line => typeof line.id === "string" && line.id.length <= 100 && typeof line.serviceId === "string" && (!line.serviceId || services.some(service => service.id === line.serviceId)) && typeof line.amount === "string" && /^\d*(\.\d{0,2})?$/.test(line.amount)));
    },
    onRestore: saved => { setLines(saved.lines); setRevision(saved.revision); setDirty(true); setNeedsReview(true); },
  });
  useEffect(() => {
    // Old unowned records cannot be assigned to whichever account signs in next.
    try { localStorage.removeItem(`reylumi:service-relay:${offer.id}`); } catch { /* Optional storage. */ }
  }, [offer.id]);
  useEffect(() => { if (!dirty && !busy) queueMicrotask(() => setRevision(ticket.revision)); }, [ticket.revision, dirty, busy]);
  const [keepAwake, setKeepAwake] = useState(false);
  useEffect(() => {
    if (!keepAwake || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined, alive = true;
    async function acquire() { if (document.visibilityState !== "visible") return; try { const next = await navigator.wakeLock.request("screen"); if (!alive) await next.release(); else lock = next; } catch { /* Device can refuse without blocking service. */ } }
    void acquire(); document.addEventListener("visibilitychange", acquire);
    return () => { alive = false; document.removeEventListener("visibilitychange", acquire); void lock?.release(); };
  }, [keepAwake]);
  async function save(done: boolean) {
    if (pending.current) return;
    if (!navigator.onLine) { setNeedsReview(true); setError("Reconnect and review your entries before sending to POS."); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await saveServiceRelay({ offerId: offer.id, lines, done, revision });
      if (result.error) setError(result.error);
      else { setRevision(revision + 1); setDirty(false); setNeedsReview(false); await onSaved(); }
    } catch { setNeedsReview(true); setError("Connection interrupted. Your entries are kept. Reconnect and review before retrying.");
    } finally { pending.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!dirty || needsReview || busy || error || lines.some(l => !l.serviceId || !/^\d+(\.\d{1,2})?$/.test(l.amount) || Number(l.amount) <= 0)) return;
    const timer = setTimeout(() => { void save(false); }, 900);
    return () => clearTimeout(timer);
    // The debounce is tied to the exact edits and their server revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, revision, dirty, needsReview, busy, error]);
  useEffect(() => { const retry = () => setError(""); window.addEventListener("online", retry); return () => window.removeEventListener("online", retry); }, []);
  // Preserve unsent edits on polling, reconnect and server conflicts.
  function edit(index: number, patch: Partial<(typeof lines)[number]>) { draft.markEdited(); setNeedsReview(false); setError(""); setDirty(true); setLines(rows => rows.map((l, i) => i === index ? { ...l, ...patch } : l)); }
  return <article className={styles.card}><h3>{ticket.customerName} · #{ticket.queueNumber}</h3><p className={styles.muted}>Working · {dirty ? "Changes not sent" : "Synced with POS"}</p>
    {lines.map((line, index) => <div className={styles.line} key={line.id}><select disabled={busy} aria-label={`Service ${index + 1}`} value={line.serviceId} onChange={e => edit(index, { serviceId: e.target.value })}><option value="">Service</option>{services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><input disabled={busy} aria-label={`Price ${index + 1}`} inputMode="decimal" placeholder="$0.00" value={line.amount} onChange={e => { if (/^\d*(\.\d{0,2})?$/.test(e.target.value)) edit(index, { amount: e.target.value }); }} /><button disabled={busy || lines.length === 1} aria-label="Remove service" onClick={() => { draft.markEdited(); setNeedsReview(false); setDirty(true); setLines(rows => rows.filter(l => l.id !== line.id)); }}>×</button></div>)}
    <button disabled={busy} onClick={() => { draft.markEdited(); setNeedsReview(false); setDirty(true); setLines(rows => [...rows, { id: crypto.randomUUID(), serviceId: services[0]?.id ?? "", amount: "" }]); }}>+ Service</button>
    <div className={styles.actions}><button disabled={busy || !dirty} onClick={() => void save(false)}>Send to POS</button><button disabled={busy} className={styles.primary} onClick={() => void save(true)}>{busy ? "Sending…" : "Done"}</button></div>
    <label className={styles.muted}><input type="checkbox" style={{ width: 18, minHeight: 18, marginRight: 8 }} checked={keepAwake} onChange={e => setKeepAwake(e.target.checked)} />Keep screen awake</label>
    {error && <p role="alert" className={styles.notice}>{error} Your entries are kept. <button disabled={busy} onClick={async () => {
      const result = await loadServiceRelay();
      const latest = result.data?.tickets.find(t => t.visitId === ticket.visitId);
      if (latest) { setRevision(latest.revision); setError(`Latest POS entries: ${latest.lines.filter(l => l.offerId === offer.id).map(l => `${l.serviceName} $${l.amount}`).join(", ") || "none"}. Review your entries, then tap Send to POS.`); await onSaved(); }
      else setError(result.error ?? "This work is no longer active. Refresh your customer list.");
    }}>Review latest revision</button></p>}
  </article>;
}
function RelayScanner({ onCode }: { onCode: (code: string) => void }) {
  const [active, setActive] = useState(false), [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | undefined, stopped = false, timer: ReturnType<typeof setTimeout>;
    const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) { queueMicrotask(() => { if (!stopped) setError("Camera scan is unavailable here. Enter the check-in number or paste its link."); }); return () => { stopped = true; }; }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(async next => {
      stream = next; if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      if (!video.current) return; video.current.srcObject = stream; await video.current.play();
      const detector = new Detector({ formats: ["qr_code"] });
      const scan = async () => { if (stopped || !video.current) return; try { const codes = await detector.detect(video.current); if (codes[0]) { onCode(codes[0].rawValue); setActive(false); return; } } catch { /* Retry camera frames. */ } timer = setTimeout(scan, 300); };
      void scan();
    }).catch(() => setError("Camera unavailable. Enter the check-in number."));
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, [active, onCode]);
  return <><button type="button" onClick={() => { setError(""); setActive(!active); }}>{active ? "Stop scan" : "Scan QR"}</button>{active && <video ref={video} muted playsInline className={styles.scan} />}{error && <p role="status">{error}</p>}</>;
}
