"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { loadServiceRelay, submitServiceRelay } from "./actions";
import type { RelayTicket, RelayWorkspace } from "@/types/service-relay";
import styles from "./service-relay.module.css";
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
type Submit = typeof submitServiceRelay;
const defaultLoad = () => loadServiceRelay(true);
export function DeskRelay({ salonId, load = defaultLoad, submit = submitServiceRelay }: { salonId: string; load?: () => Promise<{ data?: RelayWorkspace; error?: string }>; submit?: Submit }) {
  const [data, setData] = useState<RelayWorkspace | null>(null), [open, setOpen] = useState(false), [error, setError] = useState("");
  const loading = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  const refresh = useCallback(async () => { if (loading.current) return; loading.current = true; try { const result = await load(); if (result.data) { setData(result.data); setError(""); } else setError(result.error ?? "Could not refresh tickets."); } catch { setError("Reconnect to refresh service tickets."); } finally { loading.current = false; } }, [load]);
  useEffect(() => { const timer = setTimeout(() => { void refresh(); }, 0); const unsubscribe = subscribePosChanges(salonId, change => { if (["staff", "waiting", "tickets"].includes(change.resource)) void refresh(); }); return () => { clearTimeout(timer); unsubscribe(); }; }, [salonId, refresh]);
  useEffect(() => { if (!data?.installed) return; const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void refresh(); }, 15000); return () => clearInterval(timer); }, [data?.installed, refresh]);
  if (!data?.installed) return null;
  const ready = data.tickets.filter(t => t.status === "checkout").length;
  return <section className={styles.panel} style={{ margin: 0, padding: 0, border: 0 }}><button className={styles.deskButton} onClick={() => setOpen(true)}>Service tickets · {ready} ready</button>
    {open && <dialog ref={dialog} onCancel={() => setOpen(false)} aria-label="Service tickets" className={styles.drawer}><section className={styles.drawerContent}><div className={styles.header}><h2>Service tickets</h2><button onClick={() => setOpen(false)}>Close</button></div><p className={styles.muted}>Staff send services and prices here. Submit confirms payment collected.</p>{error && <p role="alert">{error}</p>}
      <div className={styles.cards}>{data.tickets.map(ticket => <DeskTicket key={ticket.visitId} ticket={ticket} submit={submit} onSubmitted={refresh} />)}</div>{!data.tickets.length && <p>No customers waiting.</p>}
    </section></dialog>}
  </section>;
}
function DeskTicket({ ticket, submit, onSubmitted }: { ticket: RelayTicket; submit: Submit; onSubmitted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [tip, setTip] = useState(""), [discount, setDiscount] = useState("");
  const pending = useRef(false);
  return <article className={`${styles.panel} ${styles.card}`}><div className={styles.header}><h3>{ticket.customerName} · #{ticket.queueNumber}</h3><span className={styles.badge}>{ticket.status === "checkout" ? "Ready to pay" : ticket.status === "in_service" ? "In service" : "Waiting"}</span></div>
    {ticket.offers.filter(o => o.status !== "done").map(o => <p key={o.id}>{o.staffName} · {o.serviceName} · {o.status === "working" ? "Working" : "Awaiting response"}</p>)}
    <table className={styles.rows}><tbody>{ticket.lines.map(l => <tr key={l.id}><td>{l.serviceName}<br /><small>{l.staffName}</small></td><td>{money(l.amount)}</td></tr>)}</tbody></table>
    {ticket.status === "checkout" && <div className={styles.adjustments}><label>Tip<input disabled={busy} inputMode="decimal" value={tip} onChange={e => { if (/^\d*(\.\d{0,2})?$/.test(e.target.value)) setTip(e.target.value); }} /></label><label>Discount<input disabled={busy} inputMode="decimal" value={discount} onChange={e => { if (/^\d*(\.\d{0,2})?$/.test(e.target.value)) setDiscount(e.target.value); }} /></label></div>}
    <p className={styles.total}>{money(Math.max(0, ticket.lines.reduce((sum, l) => sum + l.amount, 0) - Number(discount)) + Number(tip))}</p>
    {ticket.status === "checkout" && <button className={styles.primary} disabled={busy} onClick={async () => { if (pending.current) return; pending.current = true; setBusy(true); setError(""); try { const result = await submit({ visitId: ticket.visitId, revision: ticket.revision, tip: Number(tip), discount: Number(discount) }); if (result.error) setError(result.error); else await onSubmitted(); } catch { setError("Connection interrupted. Refresh this ticket before retrying Submit."); } finally { pending.current = false; setBusy(false); } }}>{busy ? "Submitting…" : "Payment collected · Submit"}</button>}
    {error && <p role="alert" className={styles.notice}>{error}</p>}
  </article>;
}
