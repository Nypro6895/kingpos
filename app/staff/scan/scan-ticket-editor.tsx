"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { scanOffer, validScanLines } from "@/lib/staff-scan";
import { readStaffScanDraft, removeStaffScanDraft, scanDraftPrefix, staffDraftStorageWarning, writeStaffScanDraft } from "@/lib/staff-scan-draft";
import type { RelayTicket } from "@/types/service-relay";
import type { ScanEntryLine, StaffScanWorkspace } from "@/types/staff-scan";
import { saveStaffScan } from "./actions";
import styles from "./scan.module.css";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
export { scanDraftPrefix } from "@/lib/staff-scan-draft";

export function ScanTicketEditor({ ticket, workspace, salonId, online, onRefresh, onSaved }: {
  ticket: RelayTicket; workspace: StaffScanWorkspace; salonId: string; online: boolean;
  onRefresh: () => Promise<void>; onSaved: (ticket: RelayTicket, done: boolean) => void;
}) {
  const translate = useWorkspaceTranslation();
  const offer = scanOffer(ticket, workspace.staffId)!;
  const savedLines = ticket.lines.filter(line => line.offerId === offer.id);
  const initialLines = () => {
    if (savedLines.length) return savedLines.map(l => ({ id: l.id, serviceId: l.serviceId, amount: String(l.amount) }));
    if (ticket.requestedServices.length !== 1) return [];
    if (ticket.lines.some(line => line.serviceId === ticket.requestedServices[0].id && line.staffId !== workspace.staffId)) return [];
    const service = workspace.services.find(s => s.id === ticket.requestedServices[0].id);
    return service ? [{ id: crypto.randomUUID(), serviceId: service.id, amount: service.price > 0 ? String(service.price) : "" }] : [];
  };
  const [lines, setLines] = useState<ScanEntryLine[]>(initialLines);
  const [revision, setRevision] = useState(ticket.revision);
  const [activeId, setActiveId] = useState<string | null>(() => lines.length === 1 && ticket.requestedServices.length <= 1 ? lines[0].id : null);
  const [picker, setPicker] = useState<"add" | "change" | null>(null);
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false), [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [recovered, setRecovered] = useState(false);
  const replace = useRef(true), pending = useRef(false), alive = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = `${scanDraftPrefix(salonId, workspace.staffId)}${offer.id}`;
  const conflict = revision !== ticket.revision;
  const inline = lines.length === 1 && ticket.requestedServices.length <= 1 && !picker;
  const active = lines.find(l => l.id === activeId) ?? (inline ? lines[0] : undefined);

  useEffect(() => {
    alive.current = true;
    const timer = setTimeout(() => {
      const { draft, warning } = readStaffScanDraft(key);
      if (draft) {
        setLines(draft.lines); setRevision(draft.revision); setDirty(true); setRecovered(true);
        setActiveId(draft.lines.length === 1 ? draft.lines[0].id : null);
      }
      setStorageWarning(warning ?? "");
      setRestored(true);
    }, 0);
    return () => { alive.current = false; clearTimeout(timer); };
  }, [key]);
  useEffect(() => {
    if (!restored) return;
    const saved = dirty ? writeStaffScanDraft(key, { lines, revision, at: Date.now() }) : removeStaffScanDraft(key);
    // Effects report persistence failures without replacing the entries in memory.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStorageWarning(saved ? "" : staffDraftStorageWarning);
  }, [lines, revision, dirty, restored, key]);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if ((picker || (active && !inline)) && !node.open) node.showModal();
    else if (!picker && (!active || inline) && node.open) node.close();
  }, [picker, active, inline]);

  function select(id: string) { replace.current = true; setActiveId(id); setError(""); }
  function choose(serviceId: string) {
    const existing = lines.find(l => l.serviceId === serviceId);
    if (existing && picker !== "change") { select(existing.id); setPicker(null); return; }
    const service = workspace.services.find(s => s.id === serviceId);
    if (!service) return;
    const id = picker === "change" && active ? active.id : crypto.randomUUID();
    const line = { id, serviceId, amount: service.price > 0 ? String(service.price) : "" };
    setLines(current => picker === "change" ? current.map(l => l.id === id ? line : l) : [...current, line]);
    setDirty(true); setPicker(null); setQuery(""); select(id);
  }
  function amount(value: string) {
    if (!active || !/^\d*(\.\d{0,2})?$/.test(value)) return;
    setLines(current => current.map(l => l.id === active.id ? { ...l, amount: value } : l));
    setDirty(true); setError("");
  }
  function press(key: string) {
    if (!active || busy) return;
    const previous = replace.current ? "" : active.amount;
    const value = key === "Backspace" ? previous.slice(0, -1) : key === "." ? previous.includes(".") ? previous : `${previous || "0"}.` : `${previous}${key}`;
    replace.current = false; amount(value);
  }
  async function send(done: boolean, values = lines) {
    if (pending.current || !restored) return;
    if (!online) { setError("Reconnect before sending. Your entries are kept; POS can finish saved work."); return; }
    if (conflict) { setError("POS changed this work. Use the latest POS values before continuing."); return; }
    if ((values.length > 0 || done) && !validScanLines(values)) { setError("Choose a service and enter a positive amount for each service."); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await saveStaffScan({ salonId, staffId: workspace.staffId }, { offerId: offer.id, revision, lines: values, done });
      if (!alive.current) return;
      if (!result.ticket) { setError(result.error ?? "Could not save. Your entries are kept."); await onRefresh(); return; }
      removeStaffScanDraft(key);
      setDirty(false); onSaved(result.ticket, done);
    } catch {
      if (alive.current) { setError("Connection interrupted. Your entries are kept. Reconnect and review before retrying."); await onRefresh(); }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function remove() {
    if (!active) return;
    const next = lines.filter(l => l.id !== active.id);
    // Delete persists the remaining own lines; it cannot remove another staff's
    // work or the visit. The last row releases this staff's empty draft.
    void send(false, next);
  }
  const serviceName = (id: string) => workspace.services.find(s => s.id === id)?.name ?? ticket.lines.find(l => l.serviceId === id)?.serviceName ?? "Service";
  const feedback = <>{storageWarning && <p className={styles.notice} role="alert"><WorkspaceText text={storageWarning} /></p>}{recovered && !storageWarning && <p className={styles.muted} role="status"><WorkspaceText text="Recovered unsent entries on this device. Review, then Stand by or Done." /></p>}{(error || conflict) && <div className={styles.notice} role="alert"><WorkspaceText text={error || "POS changed this work. Use the latest POS values before continuing."} />{conflict && <button type="button" disabled={busy} onClick={() => {
    const latest = savedLines.map(l => ({ id: l.id, serviceId: l.serviceId, amount: String(l.amount) }));
    setLines(latest); setRevision(ticket.revision); setDirty(false); setError(""); setActiveId(latest.length === 1 ? latest[0].id : null); replace.current = true;
  }}><WorkspaceText text="Use POS values" /></button>}</div>}</>;
  const entry = active && <>
    <label className={styles.singleMoney}><span>{serviceName(active.serviceId)}</span><span className={styles.moneyInput}><span aria-hidden>$</span><input aria-label={translate("Amount")} inputMode="none" autoComplete="off" value={active.amount} disabled={busy || !restored} onFocus={e => { replace.current = true; e.target.select(); }} onChange={e => { replace.current = false; amount(e.target.value); }} onKeyDown={e => {
      if (/^[0-9.]$/.test(e.key) || e.key === "Backspace") { e.preventDefault(); press(e.key); }
      else if (e.key === "Enter") { e.preventDefault(); void send(false); }
    }} /></span></label>
    <div className={styles.editorTools}><button type="button" disabled={busy} onClick={() => { setPicker("add"); setQuery(""); }}><WorkspaceText text="+ Service" /></button><button type="button" disabled={busy} onClick={() => { setPicker("change"); setQuery(""); }}><WorkspaceText text="Edit service" /></button><button type="button" className={styles.delete} disabled={busy || !online || conflict} onClick={remove}><WorkspaceText text="Delete" /></button></div>
    <div className={styles.keypad} aria-label={translate("Keypad")}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "Backspace"].map(key => <button type="button" disabled={busy || !restored} key={key} aria-label={translate(key)} onClick={() => press(key)}>{key === "Backspace" ? "⌫" : key}</button>)}
    </div>
    {feedback}<div className={styles.actions}><button type="button" disabled={busy || !restored} onClick={() => void send(false)}><WorkspaceText text="Stand by" /></button><button type="button" className={styles.primary} disabled={busy || !restored} onClick={() => void send(true)}><WorkspaceText text={busy ? "Sending…" : "Done"} /></button></div>
  </>;
  return <section className={styles.editor} aria-label="Enter services and amounts" data-scan-editor>
    <div className={styles.editorHeader}><h2>{ticket.customerName} · #{ticket.queueNumber}</h2><button type="button" aria-label={translate("Close and save")} disabled={busy || !restored} onClick={() => void send(false)}>×</button></div>
    {inline ? entry : <>
      <div className={styles.serviceList}>
        {lines.map(line => <button type="button" key={line.id} disabled={busy} onClick={() => select(line.id)}><span>{serviceName(line.serviceId)}</span><strong>{line.amount ? money(Number(line.amount)) : translate("Enter amount")}</strong><span aria-hidden>›</span></button>)}
        {ticket.requestedServices.filter(s => !lines.some(l => l.serviceId === s.id)).map(service => {
          const other = ticket.lines.find(l => l.serviceId === service.id && l.staffId !== workspace.staffId);
          return <button type="button" disabled={busy || !workspace.services.some(s => s.id === service.id)} key={service.id} onClick={() => choose(service.id)}><span>{service.name}</span><small>{other ? `${other.staffName} · ${translate("Add for me")}` : translate("Select service")}</small><span aria-hidden>›</span></button>;
        })}
      </div>
      <div className={styles.editorTools}><button type="button" disabled={busy} onClick={() => { setPicker("add"); setQuery(""); }}><WorkspaceText text="+ Service" /></button></div>
      {!lines.length && !ticket.requestedServices.length && <p className={styles.muted}><WorkspaceText text="No services selected at check-in." /></p>}
      {feedback}<div className={styles.actions}><button type="button" disabled={busy || !restored} onClick={() => void send(false)}><WorkspaceText text="Stand by" /></button><button type="button" className={styles.primary} disabled={busy || !lines.length || !restored} onClick={() => void send(true)}><WorkspaceText text="Done" /></button></div>
    </>}
    <dialog ref={dialog} className={styles.serviceDialog} aria-label={translate(picker ? "Services" : "Enter amount")} onCancel={e => { e.preventDefault(); if (!busy) { setPicker(null); setActiveId(null); } }}>
      <div className={styles.editorHeader}><h2>{ticket.customerName} · #{ticket.queueNumber}</h2><button type="button" disabled={busy} aria-label={translate("Close")} onClick={() => { setPicker(null); setActiveId(null); }}>×</button></div>
      {picker ? <><input aria-label={translate("Find services")} placeholder={translate("Find services")} value={query} onChange={e => setQuery(e.target.value)} /><div className={styles.serviceList}>{workspace.services.filter(s => s.name.toLowerCase().includes(query.toLowerCase()) && !lines.some(l => l.serviceId === s.id && (picker !== "change" || l.id !== activeId))).map(service => <button type="button" key={service.id} disabled={busy} onClick={() => choose(service.id)}><span>{service.name}</span><strong>{money(service.price)}</strong></button>)}</div></> : !inline ? entry : null}
    </dialog>
  </section>;
}
