"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorkspaceText as T } from "@/components/workspace-language";
import type { OwnerAttentionData, OwnerAttentionItem } from "@/types/owner-financial-attention";
import s from "./owner-attention.module.css";

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

export function AttentionActions({ salonId, viewerId, item, onSaved, closing = false, compact = false }: { salonId: string; viewerId: string; item: OwnerAttentionItem; onSaved?: () => void; closing?: boolean; compact?: boolean }) {
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
    {!closing && <Link href={attentionHref(item.item_key)}><span><T text="View details" /></span></Link>}
    {closing && item.kind === "closing" && <button className={s.primary} disabled={busy || !canConfirm} onClick={() => void save("review_closing")}><T text="Confirm day reviewed" /></button>}
    {!item.ignored && <button disabled={busy} onClick={() => void save("ignore")}><span><T text={busy ? "Saving…" : "Ignore"} /></span></button>}
    {item.ignored && <span className={s.meta}><T text="Ignored · hidden from Attention" /></span>}
  </div>{closing && item.kind === "closing" && !canConfirm && <p className={s.detail}><T text="Enter actual collections and finish open receipts in Reports before confirming." /></p>}{error && <p role="alert" className={s.error}>{error}</p>}</>;
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
    {data && data.salonId === salonId && data.items.slice(0, 5).map(item => <article className={`${s.item} ${s.notification}`} key={item.item_key}>
      <div className={s.message}><h3>{item.label}</h3><p className={s.meta}>{item.business_date} · {new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: data.timezone }).format(new Date(item.occurred_at))}</p>
      <p className={s.detail}>{item.detail}</p></div><div className={s.notificationActions}><AttentionActions salonId={salonId} viewerId={data.viewerId} item={item} compact /></div>
    </article>)}
    {data && !error && data.total === 0 && <p className={s.detail}><T text="No financial items awaiting review." /></p>}
    {data && data.total > 5 && <div className={s.actions}><Link href="/staff/today/attention"><T text={`View all ${data.total} items`} /></Link></div>}
  </section>;
}
