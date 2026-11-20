"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorkspaceText as T } from "@/components/workspace-language";
import type { OwnerAttentionData, OwnerAttentionItem } from "@/types/owner-financial-attention";
import s from "./owner-attention.module.css";
import { attentionMoney, attentionPresentation, attentionTime } from "@/lib/owner-attention-presentation";

export const attentionHref = (key: string) => `/staff/today/attention?item=${encodeURIComponent(key)}`;
async function call(salonId: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const transport = new AbortController(), abort = () => transport.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 12000);
  try {
    const read = args.op === "read";
    const query = new URLSearchParams({ salonId });
    if (args.item !== undefined) query.set("item", String(args.item));
    if (args.page !== undefined) query.set("page", String(args.page));
    const response = await fetch(read ? `/api/owner-attention?${query}` : "/api/owner-attention", { method: read ? "GET" : "POST", ...(read ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ salonId, ...args }) }), cache: "no-store", signal: transport.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to load financial checks");
    return data;
  } catch (error) {
    if (transport.signal.aborted && !signal?.aborted) throw new Error("Financial checks timed out. Please retry.");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export function AttentionActions({ salonId, viewerId, item, onSaved, closing = false, compact = false, ignoreOnly = false }: { salonId: string; viewerId: string; item: OwnerAttentionItem; onSaved?: () => void; closing?: boolean; compact?: boolean; ignoreOnly?: boolean }) {
  const router = useRouter();
  const facts = item.facts;
  const report = facts?.report as { entered?: boolean } | undefined;
  const tickets = facts?.tickets as Array<{ facts?: { status?: string } }> | undefined;
  const canConfirm = Boolean(facts?.collection || report?.entered) && !tickets?.some(ticket => ticket.facts?.status === "open");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(op: string) {
    setBusy(true); setError("");
    try {
      await call(salonId, { op, item: item.item_key, viewerId });
      window.dispatchEvent(new CustomEvent("owner-attention-updated", { detail: { salonId, item: item.item_key } }));
      onSaved?.();
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save"); }
    finally { setBusy(false); }
  }
  return <><div className={`${s.actions} ${compact ? s.compactActions : ""}`}>
    {!closing && !ignoreOnly && <Link href={attentionHref(item.item_key)}><span><T text="View details" /></span></Link>}
    {closing && item.kind === "closing" && <button className={s.primary} disabled={busy || !canConfirm} onClick={() => void save("review_closing")}><T text="Confirm day reviewed" /></button>}
    {!item.ignored && <button disabled={busy} onClick={() => void save("ignore")}><span><T text={busy ? "Saving…" : item.kind === "discount" || item.kind === "ticket_change" ? "Mark reviewed" : "Ignore"} /></span></button>}
    {item.ignored && <span className={s.meta}><T text={item.kind === "discount" || item.kind === "ticket_change" ? "Reviewed · hidden from Attention" : "Ignored · hidden from Attention"} /></span>}
  </div>{closing && item.kind === "closing" && !canConfirm && <p className={s.detail}><T text="Enter actual collections and finish open receipts in Reports before confirming." /></p>}{error && <p role="alert" className={s.error}>{error}</p>}</>;
}

export function ClosingNotification({ data, item, onSaved }: { data: Pick<OwnerAttentionData, "salonId" | "viewerId" | "today">; item: OwnerAttentionItem; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const breakdownId = useId();
  const difference = item.difference ?? Number(item.facts?.serviceDifference);
  const previous = new Date(`${data.today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10) === item.business_date;
  return <article className={`${s.item} ${s.inlineClosing}`}>
    <div className={s.inlineClosingHeading}>
      <h3><button className={s.closingToggle} type="button" aria-expanded={open} aria-controls={breakdownId} onClick={() => setOpen(value => !value)}>
        <span><T text={yesterday ? "Yesterday's closing" : "Closing"} />{!yesterday && <> {item.business_date}</>} · {Number.isFinite(difference) ? <><T text={difference < 0 ? "Short" : "Over"} /> <strong>{attentionMoney(Math.abs(difference))}</strong></> : item.label}</span>
        <span aria-hidden="true" className={s.closingCaret}>{open ? "⌃" : "⌄"}</span>
      </button></h3>
      <AttentionActions salonId={data.salonId} viewerId={data.viewerId} item={item} onSaved={onSaved} ignoreOnly />
    </div>
    <div id={breakdownId} hidden={!open}>
      <dl className={s.closingBreakdown}>
        <div><dt><T text="Collected" /></dt><dd>{attentionMoney(item.collected ?? item.facts?.actualService)}</dd></div>
        <div><dt><T text="Expected" /></dt><dd>{attentionMoney(item.expected ?? item.facts?.expectedService)}</dd></div>
      </dl>
      <div className={`${s.actions} ${s.inlineClosingActions}`}>
        <Link href={`/reports?date=${item.business_date}#daily-closing`}><T text="Daily Report" /></Link>
        <Link href={`/pos-tickets?date=${item.business_date}`}><T text="Tickets" /></Link>
      </div>
    </div>
  </article>;
}

export function OwnerAttentionPanel({ salonId }: { salonId: string }) {
  const [data, setData] = useState<OwnerAttentionData | null>(null), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    try {
      const next = await call(salonId, { op: "read" }, current.signal) as OwnerAttentionData;
      if (!current.signal.aborted) { setData(next); setError(""); }
    } catch (e) { if (!current.signal.aborted) setError(e instanceof Error ? e.message : "Checks unavailable"); }
  }, [salonId]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.salonId === salonId) {
        setData(previous => previous ? { ...previous, total: Math.max(0, previous.total - Number(previous.items.some(item => item.item_key === detail.item))), items: previous.items.filter(item => item.item_key !== detail.item) } : previous);
        void load();
      }
    };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("owner-attention-updated", update);
    window.addEventListener("shop-money-updated", refresh);
    return () => { clearTimeout(initial); controller.current?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("owner-attention-updated", update); window.removeEventListener("shop-money-updated", refresh); };
  }, [load, salonId]);
  return <section className={s.panel} aria-busy={!data && !error}>
    <div className={s.heading}><h2><T text="Needs Attention" /></h2><span className={s.badge}><T text={error ? "Check unavailable" : data ? `${data.total} to review` : "Checking…"} /></span></div>
    {error && <div role="status"><p className={s.error}>{error}</p><button onClick={() => void load()}><T text="Try again" /></button></div>}
    {data && data.salonId === salonId && data.items.slice(0, 5).map(item => <AttentionNotification key={item.item_key} data={data} item={item} />)}
    {data && !error && data.total === 0 && <p className={s.detail}><T text="No financial items awaiting review." /></p>}
    {data && data.total > 5 && <div className={s.actions}><Link href="/staff/today/attention"><T text={`View all ${data.total} items`} /></Link></div>}
  </section>;
}

export function AttentionNotification({ data, item, onSaved }: { data: OwnerAttentionData; item: OwnerAttentionItem; onSaved?: () => void }) {
  if (item.kind === "closing") return <ClosingNotification data={data} item={item} onSaved={onSaved} />;
  const view = attentionPresentation(item);
  if (["gift_sale","gift_use","reward"].includes(item.kind)) return <article className={`${s.item} ${s.notification}`}>
    <Link className={s.alertLink} href={item.target_href}><div className={s.row}><h3>{item.label}</h3><span aria-hidden="true">›</span></div><p className={s.meta}>{attentionTime(item,data.timezone,data.today)}</p><p className={s.primaryChange}>{item.detail}</p></Link>
    <div className={s.notificationActions}><AttentionActions salonId={data.salonId} viewerId={data.viewerId} item={item} onSaved={onSaved} compact /></div>
  </article>;
  if (!view.ticket) return <article className={`${s.item} ${s.notification}`}>
    <div className={s.message}><h3>{item.label}</h3><p className={s.meta}>{attentionTime(item, data.timezone, data.today)}</p><p className={s.detail}>{item.detail}</p></div>
    <div className={s.notificationActions}><AttentionActions salonId={data.salonId} viewerId={data.viewerId} item={item} onSaved={onSaved} compact /></div>
  </article>;
  return <article className={s.item + " " + s.notification}>
    <Link className={s.alertLink} href={attentionHref(item.item_key)}>
      <div className={s.row}><h3>{view.title}</h3><span aria-hidden="true">›</span></div>
      <p className={s.meta}>{attentionTime(item, data.timezone, data.today)}{view.ticket && <> · @{view.customer}</>}</p>
      <p className={s.primaryChange}>{view.primary}</p>
      {view.ticket && <><p className={s.detail}>{view.service}</p><p className={s.meta}>{view.edited ? "Edited by" : view.created ? "Created by" : "Discount recorded by"} {view.actor} · {view.source}</p></>}
    </Link>
  </article>;
}
