"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { loadServiceRelay, submitServiceRelay, saveServiceRelayAtDesk, notifyPersonalReady } from "./actions";
import { WorkspaceText } from "@/components/workspace-language";
import type { ScanDeskLine } from "@/types/staff-scan";
import { validScanLines } from "@/lib/staff-scan";
import type { RelayTicket, RelayWorkspace } from "@/types/service-relay";
import styles from "./service-relay.module.css";
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
type Submit = typeof submitServiceRelay;
type Save = typeof saveServiceRelayAtDesk;
type Notify = typeof notifyPersonalReady;
const defaultLoad = () => loadServiceRelay(true);
export function DeskRelay({ salonId, load = defaultLoad, submit = submitServiceRelay, save = saveServiceRelayAtDesk, notify = notifyPersonalReady }: { salonId: string; load?: () => Promise<{ data?: RelayWorkspace; error?: string }>; submit?: Submit; save?: Save; notify?: Notify }) {
  const [data, setData] = useState<RelayWorkspace | null>(null), [open, setOpen] = useState(false), [error, setError] = useState("");
  const loading = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  const refresh = useCallback(async () => { if (loading.current) return; loading.current = true; try { const result = await load(); if (result.data) { setData(result.data); setError(""); } else setError(result.error ?? "Could not refresh tickets."); } catch { setError("Reconnect to refresh service tickets."); } finally { loading.current = false; } }, [load]);
  useEffect(() => { const timer = setTimeout(() => { void refresh(); }, 0); const unsubscribe = subscribePosChanges(salonId, change => { if (["staff", "waiting", "tickets"].includes(change.resource)) void refresh(); }); return () => { clearTimeout(timer); unsubscribe(); }; }, [salonId, refresh]);
  useEffect(() => { if (!data?.installed) return; const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void refresh(); }, 15000); return () => clearInterval(timer); }, [data?.installed, refresh]);
  if (!data?.installed) return null;
  const ready = data.tickets.filter(t => t.status === "checkout").length;
  return <section className={styles.panel} style={{ margin: 0, padding: 0, border: 0 }}><button className={styles.deskButton} onClick={() => setOpen(true)}>Service tickets · {data.tickets.length} open{ready ? ` · ${ready} ready` : ""}</button>
    {open && <dialog ref={dialog} onCancel={() => setOpen(false)} aria-label="Service tickets" className={styles.drawer}><section className={styles.drawerContent}><div className={styles.header}><h2>Service tickets</h2><button onClick={() => setOpen(false)}>Close</button></div><p className={styles.muted}>Staff send services and prices here. Submit confirms payment collected.</p>{error && <p role="alert">{error}</p>}
      <div className={styles.cards}>{data.tickets.map(ticket => <DeskTicket key={ticket.visitId} ticket={ticket} workspace={data} submit={submit} save={save} notify={notify} onSubmitted={refresh} />)}</div>{!data.tickets.length && <p>No customers waiting.</p>}
    </section></dialog>}
  </section>;
}
function DeskTicket({ ticket, workspace, submit, save, notify, onSubmitted }: { ticket: RelayTicket; workspace: RelayWorkspace; submit: Submit; save: Save; notify: Notify; onSubmitted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [tip, setTip] = useState(""), [discount, setDiscount] = useState("");
  const [editing, setEditing] = useState(false);
  const pending = useRef(false);
  return <article className={`${styles.panel} ${styles.card}`}><div className={styles.header}><h3>{ticket.customerName} · #{ticket.queueNumber}</h3><span className={styles.badge}>{ticket.status === "checkout" ? "Ready to pay" : ticket.status === "in_service" ? "In service" : "Waiting"}</span></div>
    {ticket.offers.filter(o => o.status !== "done").map(o => <p key={o.id}>{o.staffName} · {o.serviceName} · {o.status === "working" ? "Working" : "Awaiting response"}</p>)}
    {ticket.canNotifyReady && <ReadyCustomer ticket={ticket} workspace={workspace} notify={notify} onNotified={onSubmitted} />}
    <table className={styles.rows}><tbody>{ticket.lines.map(l => <tr key={l.id}><td>{l.serviceName}<br /><small>{l.staffName}</small></td><td>{money(l.amount)}</td></tr>)}</tbody></table>
    {!editing && <button type="button" disabled={busy} onClick={() => setEditing(true)}>Edit services & amounts</button>}
    {editing && <DeskServiceEditor key={ticket.visitId} ticket={ticket} workspace={workspace} save={save} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await onSubmitted(); }} />}
    {(ticket.status === "checkout" || (ticket.scanMode && ticket.lines.length > 0)) && <div className={styles.adjustments}><label>Tip<input disabled={busy} inputMode="decimal" value={tip} onChange={e => { if (/^\d*(\.\d{0,2})?$/.test(e.target.value)) setTip(e.target.value); }} /></label><label>Discount<input disabled={busy} inputMode="decimal" value={discount} onChange={e => { if (/^\d*(\.\d{0,2})?$/.test(e.target.value)) setDiscount(e.target.value); }} /></label></div>}
    <p className={styles.total}>{money(Math.max(0, ticket.lines.reduce((sum, l) => sum + l.amount, 0) - Number(discount)) + Number(tip))}</p>
    {(ticket.status === "checkout" || (ticket.scanMode && ticket.lines.length > 0)) && <button className={styles.primary} disabled={busy || editing} onClick={async () => { if (pending.current) return; pending.current = true; setBusy(true); setError(""); try { const result = await submit({ visitId: ticket.visitId, revision: ticket.revision, tip: Number(tip), discount: Number(discount) }); if (result.error) { setError(result.error); await onSubmitted(); } else await onSubmitted(); } catch { setError("Connection interrupted. Refresh this ticket before retrying Submit."); } finally { pending.current = false; setBusy(false); } }}>{busy ? "Submitting…" : "Payment collected · Submit"}</button>}
    {error && <p role="alert" className={styles.notice}>{error}</p>}
  </article>;
}

function ReadyCustomer({ ticket, workspace, notify, onNotified }: { ticket: RelayTicket; workspace: RelayWorkspace; notify: Notify; onNotified: () => Promise<void> }) {
  const [staffId, setStaffId] = useState("");
  const [chair, setChair] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const request = useRef<string | null>(null), pending = useRef(false);
  return <section aria-label="Notify customer Ready"><div className={styles.adjustments}>
    <label><WorkspaceText text="Staff" /><select aria-label="Ready staff" disabled={busy} value={staffId} onChange={event => { request.current = null; setStaffId(event.target.value); }}><option value="">—</option>{workspace.staff?.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
    <label><WorkspaceText text="Chair" /><input aria-label="Ready chair" disabled={busy} maxLength={40} value={chair} onChange={event => { request.current = null; setChair(event.target.value); }} /></label>
  </div><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={async () => {
    if (pending.current) return; pending.current = true; setBusy(true); setMessage(""); request.current ??= crypto.randomUUID();
    try { const result = await notify({ visitId: ticket.visitId, staffId: staffId || null, chair, requestId: request.current }); setMessage(result.error ?? "Ready sent."); if (!result.error) await onNotified(); }
    catch { setMessage("Connection interrupted. Retry Ready; the request will not be duplicated."); }
    finally { pending.current = false; setBusy(false); }
  }}><WorkspaceText text={busy ? "Sending…" : "Notify Ready"} /></button></div>{message && <p role="status"><WorkspaceText text={message} /></p>}</section>;
}

function DeskServiceEditor({ ticket, workspace, save, onClose, onSaved }: { ticket: RelayTicket; workspace: RelayWorkspace; save: Save; onClose: () => void; onSaved: () => Promise<void> }) {
  const [revision] = useState(ticket.revision);
  const [lines, setLines] = useState<ScanDeskLine[]>(() => ticket.lines.map(line => ({ id: line.id, staffId: line.staffId, serviceId: line.serviceId, amount: String(line.amount) })));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  const staff = workspace.staff ?? ticket.offers.map(offer => ({ id: offer.staffId, name: offer.staffName }));
  return <section aria-label="POS service editor"><p className={styles.muted}>POS can finish this work even when the staff phone is offline.</p>
    {lines.map((line, index) => <div className={styles.card} key={line.id}>
      <label>Staff<select aria-label={`Staff ${index + 1}`} disabled={busy} value={line.staffId} onChange={event => setLines(rows => rows.map(row => row.id === line.id ? { ...row, staffId: event.target.value } : row))}>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label>Service<select aria-label={`Service ${index + 1}`} disabled={busy} value={line.serviceId} onChange={event => setLines(rows => rows.map(row => row.id === line.id ? { ...row, serviceId: event.target.value } : row))}><option value="">Choose service</option>{workspace.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <label>Amount<input aria-label={`POS amount ${index + 1}`} disabled={busy} inputMode="decimal" value={line.amount} onChange={event => { if (/^\d*(\.\d{0,2})?$/.test(event.target.value)) setLines(rows => rows.map(row => row.id === line.id ? { ...row, amount: event.target.value } : row)); }} /></label>
      <button type="button" disabled={busy} onClick={() => setLines(rows => rows.filter(row => row.id !== line.id))}>Remove service</button>
    </div>)}
    <div className={styles.actions}><button type="button" disabled={busy} onClick={() => setLines(rows => [...rows, { id: crypto.randomUUID(), serviceId: ticket.requestedServices[0]?.id ?? workspace.services[0]?.id ?? "", staffId: ticket.offers.find(offer => offer.status === "working")?.staffId ?? staff[0]?.id ?? "", amount: "" }])}>+ Service</button><button type="button" disabled={busy} onClick={onClose}>Cancel edit</button>
      <button type="button" className={styles.primary} disabled={busy || revision !== ticket.revision || !validScanLines(lines) || lines.some(line => !line.staffId)} onClick={async () => {
        if (pending.current) return; pending.current = true; setBusy(true); setError("");
        try { const result = await save({ visitId: ticket.visitId, revision, lines }); if (result.error) setError(result.error); else await onSaved(); }
        catch { setError("Reconnect and refresh before retrying. Your edits are kept."); }
        finally { pending.current = false; setBusy(false); }
      }}>Save & finish work</button></div>
    {revision !== ticket.revision && <p role="alert">Ticket changed. Close this editor and reopen it to use the latest values.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
