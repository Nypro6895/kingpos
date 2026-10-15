"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { marketQuote } from "@/lib/market-commerce";
import type { MarketBankBillingState, MarketBankOrder, MarketBankOrderStatus } from "@/types/market-bank-billing";
import { cancelMarketBankOrder, createMarketBankOrder, refreshMarketBankBilling } from "./bank-payment-actions";
import styles from "./market.module.css";

const STATUS_LABELS: Record<MarketBankOrderStatus, string> = {
  awaiting_payment: "Awaiting bank transfer", partially_paid: "Partially received", paid: "Payment confirmed",
  cancelled: "Cancelled", expired: "Expired", refund_pending: "Refund in progress",
  partially_refunded: "Partially refunded", refunded: "Refunded",
};
function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function when(value: string) { return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }); }
function pending(order: MarketBankOrder) { return ["awaiting_payment", "partially_paid"].includes(order.status); }
function active(order: MarketBankOrder, now: number) {
  return ["paid", "refund_pending", "partially_refunded"].includes(order.status)
    && order.refunded_applied_cents < order.total_cents && order.service_end && Date.parse(order.service_end) > now;
}

export type BankCheckoutPanelProps = {
  pluginId: string;
  pluginName: string;
  billingState: MarketBankBillingState;
  hasActiveSubscription?: boolean;
  paidUntil?: string | null;
  onStateChange?: (state: MarketBankBillingState) => void;
};

export function BankCheckoutPanel({ pluginId, pluginName, billingState, hasActiveSubscription = false, paidUntil = null, onStateChange }: BankCheckoutPanelProps) {
  const router = useRouter();
  const [local, setLocal] = useState({ source: billingState, state: billingState });
  // A refresh can switch salons or provide newly settled orders.
  if (local.source !== billingState) setLocal({ source: billingState, state: billingState });
  const state = local.source === billingState ? local.state : billingState;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const [busy, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const requestId = useRef<{ key: string; scope: string } | null>(null);
  const orders = state.orders.filter(order => order.plugin_id === pluginId).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const openOrder = orders.find(order => pending(order));
  const order = orders.find(item => item.id === selectedId) ?? openOrder ?? orders[0];
  const item = state.catalog.find(item => item.plugin_id === pluginId);
  const paidPeriod = orders.find(order => active(order, now));
  const paidPeriodEnd = paidUntil && Date.parse(paidUntil) > now ? paidUntil : paidPeriod?.service_end;
  const paidAccess = Boolean(paidPeriodEnd);
  const owner = Boolean(state.salon_id);
  const canCreate = state.available && owner && state.settings.enabled && state.settings.ready && item?.published
    && item.fulfillment_ready && !openOrder && !paidAccess && !hasActiveSubscription;
  const quote = item ? marketQuote(item.price_cents, state.settings.tax_bps, state.settings.fee_bps, state.settings.fixed_fee_cents) : null;
  const outstanding = order ? Math.max(order.total_cents - order.received_cents, 0) : 0;
  const deadlinePassed = Boolean(order && Date.parse(order.expires_at) <= now);
  const canTransfer = Boolean(order && pending(order) && !deadlinePassed);
  const canCancel = Boolean(canTransfer && order?.received_cents === 0 && order.unapplied_cents === 0);

  function inform(text: string, error = false) { setMessage(text); setProblem(error); }
  function update(next: MarketBankBillingState, returnedOrder?: MarketBankOrder) {
    let updated = next.available && next.salon_id === state.salon_id ? next : state;
    if (returnedOrder) updated = { ...updated, orders: [returnedOrder, ...updated.orders.filter(item => item.id !== returnedOrder.id)] };
    setLocal({ source: billingState, state: updated });
    onStateChange?.(updated);
    if (returnedOrder) setSelectedId(returnedOrder.id);
  }
  function create() {
    if (!canCreate || busy) return;
    setConfirmCancel(false); setNotSent(false); inform("");
    startTransition(async () => {
      try {
        // Retain the same request after a lost response so a retry never duplicates an invoice.
        const scope = `${state.salon_id}:${pluginId}`;
        if (!requestId.current || requestId.current.scope !== scope) requestId.current = { key: crypto.randomUUID(), scope };
        const result = await createMarketBankOrder(pluginId, requestId.current.key);
        if (result.error || !result.order) { inform(result.error ?? "The invoice could not be created. Please refresh.", true); return; }
        update(result.state ?? state, result.order); requestId.current = null;
        inform("Invoice created. Use its reference for your bank transfer."); router.refresh();
      } catch { inform("The request could not be completed. Refresh before retrying; your invoice may already exist.", true); }
    });
  }
  function refresh() {
    inform("");
    startTransition(async () => {
      try {
        const next = await refreshMarketBankBilling();
        if (!next.available || next.salon_id !== state.salon_id) { inform(next.reason ?? "Payments could not be refreshed. Please try again.", true); return; }
        update(next); inform("Payment status refreshed."); router.refresh();
      } catch { inform("Payments could not be refreshed. Please try again.", true); }
    });
  }
  function cancel() {
    if (!canCancel || !notSent || !order) return;
    inform("");
    startTransition(async () => {
      try {
        const result = await cancelMarketBankOrder(order.id);
        if (result.error || !result.order) { inform(result.error ?? "The invoice could not be cancelled.", true); return; }
        update(result.state ?? state, result.order); setConfirmCancel(false); setNotSent(false);
        inform("Invoice cancelled. Do not transfer money using this reference."); router.refresh();
      } catch { inform("Cancellation could not be confirmed. Refresh to check the invoice status.", true); }
    });
  }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); inform(`${label} copied.`); }
    catch { inform(`Copy ${label.toLowerCase()} manually from the field.`, true); }
  }

  return <section aria-label={`${pluginName} bank payment`} className="mt-6 min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="!mt-0 !text-base">Pay by bank transfer</h3><p className="!mt-1">One month of {pluginName} for this salon.</p></div>
      {state.available && <span className="rounded-full bg-[#eef5ef] px-3 py-1 text-xs font-semibold text-[#285d4c]">USD · Manual payment</span>}
    </div>
    {pluginId === "booksms" && item?.monthly_sms_limit ? <p>Plan allowance: {item.monthly_sms_limit} SMS per calendar month (UTC).</p> : null}
    <p>Invoices do not renew automatically. Your plugin activates after Reylumi confirms the payment. Create a new invoice after your paid month ends.</p>
    {message && <p role={problem ? "alert" : "status"} className={`mt-3 rounded-lg px-3 py-2 text-sm ${problem ? "bg-[#fff4eb] text-[#974922]" : "bg-[#eef5ef] text-[#285d4c]"}`}>{message}</p>}
    {!state.available && <p role="status">{state.reason ?? "Bank payments are temporarily unavailable."}</p>}
    {state.available && !owner && <p>Choose an active salon in your Owner workspace to create an invoice.</p>}
    {state.available && owner && (!state.settings.enabled || !state.settings.ready) && <p>Bank checkout is currently unavailable. You can still review existing invoices below.</p>}
    {state.available && item && (!item.published || !item.fulfillment_ready) && <p>This plugin is not available for purchase yet.</p>}
    {hasActiveSubscription && <p>You already have a card subscription. Use Manage subscription for changes; another purchase is unavailable while it remains linked.</p>}
    {paidAccess && <p className="rounded-lg bg-[#eef5ef] px-3 py-2">Paid access is available until <strong>{when(paidPeriodEnd!)}</strong>. A new invoice becomes available after this period ends.</p>}

    {quote && !openOrder && !paidAccess && !hasActiveSubscription && <div className="mt-4 rounded-xl bg-[var(--surface-muted)] p-4" aria-label="Purchase total">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
        <dt>Plugin · one month</dt><dd className="text-right">{money(quote.baseCents)}</dd>
        <dt>{state.settings.tax_label || "Tax"} ({state.settings.tax_bps / 100}%)</dt><dd className="text-right">{money(quote.taxCents)}</dd>
        <dt>Processing fee</dt><dd className="text-right">{money(quote.feeCents)}</dd>
        <dt className="border-t border-[var(--border-subtle)] pt-2 font-bold">Total to transfer</dt><dd className="border-t border-[var(--border-subtle)] pt-2 text-right font-bold">{money(quote.totalCents)} USD</dd>
      </dl>
      <p className="!mb-0 !text-xs">Processing fee: {state.settings.fee_bps / 100}% of the plugin price plus tax + {money(state.settings.fixed_fee_cents)}. Your bank may charge its own fee separately. Transfer the invoice total in USD.</p>
    </div>}
    {!openOrder && !paidAccess && !hasActiveSubscription && item?.published && item.fulfillment_ready && <button type="button" className={`${styles.primary} mt-4 w-full sm:w-auto`} disabled={busy || !canCreate} onClick={create}>{busy ? "Preparing invoice…" : "Create bank payment invoice"}</button>}

    {order && <article aria-label="Payment invoice" className="mt-5 rounded-xl border border-[var(--border-subtle)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="break-all text-sm">{order.reference}</strong><span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold">{deadlinePassed && pending(order) ? "Deadline passed · refresh status" : STATUS_LABELS[order.status]}</span></div>
      {order.plugin_id === "booksms" && <p className="text-sm">Ordered allowance: {order.snapshot.monthly_sms_limit ?? 0} SMS per calendar month (UTC).</p>}
      <p className="!mb-1 !text-xs">Created {when(order.created_at)} · {order.publisher}</p>
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
        <dt>Plugin · one month</dt><dd className="text-right">{money(order.base_cents)}</dd>
        <dt>{order.snapshot.tax_label || "Tax"}</dt><dd className="text-right">{money(order.tax_cents)}</dd>
        <dt>Processing fee</dt><dd className="text-right">{money(order.fee_cents)}</dd>
        <dt className="font-bold">Invoice total</dt><dd className="text-right font-bold">{money(order.total_cents)} USD</dd>
        <dt>Payment received for invoice</dt><dd className="text-right">{money(order.received_cents)}</dd>
        {order.refunded_cents > 0 && <><dt>Refund confirmed</dt><dd className="text-right">{money(order.refunded_cents)}</dd></>}
        {order.unapplied_cents > 0 && <><dt>Extra payment awaiting resolution</dt><dd className="text-right">{money(order.unapplied_cents)}</dd></>}
        {canTransfer && <><dt className="border-t border-[var(--border-subtle)] pt-2 font-bold">Remaining to transfer</dt><dd className="border-t border-[var(--border-subtle)] pt-2 text-right font-bold">{money(outstanding)} USD</dd></>}
      </dl>
      {order.service_start && order.service_end && <p>Service period: {when(order.service_start)} – {when(order.service_end)}.</p>}
      {canTransfer && <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
        <p className="!mt-0"><strong>Transfer by {when(order.expires_at)}</strong>. Use the exact payment reference below. Only confirmed funds activate access.</p>
        {order.snapshot.bank.bank_name && order.snapshot.bank.beneficiary && order.snapshot.bank.account_number ? <>
          <dl className="grid gap-3 text-sm">
            <div><dt className="text-xs text-[var(--text-secondary)]">Receiving bank</dt><dd className="mt-1 break-words font-semibold">{order.snapshot.bank.bank_name}</dd></div>
            <div><dt className="text-xs text-[var(--text-secondary)]">Beneficiary</dt><dd className="mt-1 break-words font-semibold">{order.snapshot.bank.beneficiary}</dd></div>
          </dl>
          <div className="mt-3 grid min-w-0 gap-3">
            {[["Account number", order.snapshot.bank.account_number], ["Routing / SWIFT", order.snapshot.bank.routing], ["Payment reference", order.reference]].filter(([, value]) => value).map(([label, value]) => <div key={label} className="grid min-w-0 gap-1 text-xs text-[var(--text-secondary)]"><label htmlFor={`bank-${order.id}-${label}`}>{label}</label><span className="flex min-w-0 gap-2"><input id={`bank-${order.id}-${label}`} className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)]" value={value} readOnly onFocus={event => event.target.select()} /><button type="button" aria-label={`Copy ${label.toLowerCase()}`} className={styles.secondary} onClick={() => copy(value, label)}>Copy</button></span></div>)}
          </div>
          {order.snapshot.bank.instructions && <p className="whitespace-pre-wrap rounded-lg bg-[var(--surface-muted)] p-3">{order.snapshot.bank.instructions}</p>}
          <p className="!text-xs">Keep your bank confirmation. Bank processing can take time; use Refresh payment status to check confirmation. Do not send the payment twice.</p>
        </> : <p role="alert">Bank details could not be loaded. Refresh payment status before sending any money.</p>}
      </div>}
      {deadlinePassed && pending(order) && <p>Do not send money using this invoice. Refresh its status before creating a new invoice. If you already sent money, contact Reylumi with the payment reference.</p>}
      {order.status === "expired" && <p>This invoice has expired. If you already sent money, contact Reylumi with the payment reference before making another payment.</p>}
      {order.status === "cancelled" && <p>Do not transfer money using this cancelled reference.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={styles.secondary} disabled={busy} onClick={refresh}>{busy ? "Updating…" : "Refresh payment status"}</button>
        <a className={`${styles.secondary} inline-flex items-center`} href={`/market/orders/${order.id}`} target="_blank" rel="noopener">View invoice / receipt</a>
        {canCancel && !confirmCancel && <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setConfirmCancel(true); setNotSent(false); }}>Cancel unpaid invoice</button>}
      </div>
      {canCancel && confirmCancel && <div className="mt-4 rounded-lg bg-[#fff4eb] p-3 text-sm">
        <p className="!mt-0">Only cancel if you have not sent money. If a transfer is already on its way, keep this invoice open and contact Reylumi.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={notSent} onChange={event => setNotSent(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#d86232]" />I have not sent this payment.</label>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={styles.secondary} disabled={busy || !notSent} onClick={cancel}>Confirm cancellation</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmCancel(false)}>Keep invoice</button></div>
      </div>}
    </article>}
    {openOrder && order?.id !== openOrder.id && <button type="button" className={`${styles.secondary} mt-3`} onClick={() => { setSelectedId(openOrder.id); setConfirmCancel(false); }}>Return to awaiting payment invoice</button>}
    {orders.length > 1 && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Invoice history ({orders.length})</summary><ul className="!mt-2 !list-none !p-0">{orders.map(history => <li key={history.id} className="border-b border-[var(--border-subtle)] py-2"><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm" onClick={() => { setSelectedId(history.id); setConfirmCancel(false); }}><span className="break-all">{history.reference}<span className="block text-xs text-[var(--text-secondary)]">{when(history.created_at)}</span></span><span>{money(history.total_cents)} · {STATUS_LABELS[history.status]}</span></button></li>)}</ul></details>}
  </section>;
}
