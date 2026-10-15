"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { marketQuote } from "@/lib/market-commerce";
import { AdminActionForm } from "../_components/action-form";
import {
  cancelMarketBillingOrder,
  cancelMarketBillingRefund,
  completeMarketBillingRefund,
  recordMarketBankExpense,
  recordMarketBankReceipt,
  requestMarketBillingRefund,
  saveMarketBankAccount,
  saveMarketBillingCatalog,
  saveMarketBillingSettings,
} from "./billing-actions";
import type {
  MarketBankAccount,
  MarketBillingAdminState,
  MarketBillingCatalogItem,
  MarketBillingOrder,
  MarketBillingRefund,
  MarketBillingSettings,
} from "./billing-data";

const input = "mt-1 block min-h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 focus:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-200";
const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40";
const textSmall = "text-sm leading-6 text-zinc-600";
const format = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents: number | undefined) => typeof cents === "number" ? format.format(cents / 100) : "—";
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(value)) : "—";
const monthPrice = (cents: number) => (cents / 100).toFixed(2);
const PAGE_SIZE = 25;
const receivedTotal = (order: MarketBillingOrder) => order.received_cents + order.unapplied_cents + order.refunded_cents - order.refunded_applied_cents;

function Panel({ title, children, description, action }: { title: string; children: ReactNode; description?: string; action?: ReactNode }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-zinc-950">{title}</h2>{description && <p className={`mt-1 max-w-3xl ${textSmall}`}>{description}</p>}</div>{action}</div>{children}
  </section>;
}

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white p-4"><p className="text-sm text-zinc-500">{label}</p><p className="mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums">{value}</p>{note && <p className="mt-2 text-xs leading-5 text-zinc-500">{note}</p>}</div>;
}

const statusNames: Record<string, string> = {
  active: "Active", inactive: "Inactive", completed: "Completed",
  awaiting_payment: "Awaiting payment", pending: "Awaiting payment", partially_paid: "Partial payment", partial: "Partial payment",
  paid: "Paid", expired: "Expired", cancelled: "Cancelled", refunded: "Refunded", partially_refunded: "Partial refund", refund_pending: "Refund pending",
};

function Status({ value }: { value: string }) {
  const color = value === "paid" || value === "completed" || value === "active" ? "bg-emerald-50 text-emerald-800" : value === "expired" || value === "cancelled" || value === "refunded" || value === "inactive" ? "bg-zinc-100 text-zinc-600" : "bg-amber-50 text-amber-800";
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>{statusNames[value] ?? value.replaceAll("_", " ")}</span>;
}

function PageControls({ page, count, onPage }: { page: number; count: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-zinc-500">{count ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, count)} of ${count}` : "No results"}</p><div className="flex gap-2"><button type="button" className={secondary} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><button type="button" className={secondary} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</button></div></div>;
}

export function MarketBillingWorkspace({ state }: { state: MarketBillingAdminState }) {
  const [tab, setTab] = useState<"overview" | "configuration" | "orders" | "ledger">("overview");
  const bank = state.bank_accounts.find(account => account.id === state.settings.default_bank_account_id);
  const bankReady = Boolean(bank?.active && bank.bank_name && bank.beneficiary && bank.account_number);
  const sellable = state.catalog.filter(item => item.published && item.fulfillment_ready && item.price_cents > 0).length;
  const live = state.settings.enabled && bankReady;
  const summary = state.summary;
  const tabs = [{ id: "overview", label: "Overview" }, { id: "configuration", label: "Configuration" }, { id: "orders", label: "Orders & refunds" }, { id: "ledger", label: "Income & expenses" }] as const;
  return <div className="space-y-6">
    <div className={`flex flex-wrap items-start justify-between gap-4 rounded-2xl border p-4 sm:p-5 ${live ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div><p className="font-semibold">{live ? "Bank payments are available" : "Set up bank payments"}</p><p className={`mt-1 ${textSmall}`}>{live ? `Customers can create an order and transfer to ${bank?.label}. Plugin access begins after you verify received funds.` : "Add a receiving account, review prices and fees, then enable customer payments."}</p></div>
      <Link className={secondary} href="/market">Open customer Market ↗</Link>
    </div>
    <nav aria-label="Market payment sections" className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3">{tabs.map(item => <button type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} aria-controls={`billing-${item.id}`} onClick={() => setTab(item.id)} className={`min-h-11 rounded-xl px-4 py-2 text-sm font-medium ${tab === item.id ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>{item.label}</button>)}</nav>
    {tab === "overview" && <div id="billing-overview" className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Money received" value={money(summary.cash_in_cents)} note="Verified bank receipts, all time" /><Metric label="Money refunded" value={money(summary.cash_out_cents)} note="Completed customer bank refunds, all time" /><Metric label="Net bank cash" value={money(summary.net_cash_cents)} note="Received minus refunds and business expenses" /><Metric label="Late or excess customer funds" value={money(summary.unapplied_cents)} note="Unapplied funds to reconcile or refund" /></div>
      <Panel title="Ready to sell" description="Configuration applies to new bank orders. Every order keeps its original quote and receiving bank details.">
        <ul className="grid gap-3 sm:grid-cols-3">{[{ ready: bankReady, label: "Receiving bank", detail: bankReady ? `${bank?.label} · active` : "Choose a complete, active account" }, { ready: sellable > 0, label: "Plugin pricing", detail: `${sellable} published plugin${sellable === 1 ? "" : "s"} ready for paid access` }, { ready: live, label: "Customer payments", detail: live ? "Enabled · verified transfer required" : "Enable after checking configuration" }].map(item => <li key={item.label} className="rounded-xl border border-zinc-200 p-4"><p className="font-medium"><span aria-hidden="true" className={item.ready ? "text-emerald-700" : "text-amber-700"}>{item.ready ? "✓" : "○"}</span> {item.label}</p><p className={`mt-1 ${textSmall}`}>{item.detail}</p></li>)}</ul>
        <button type="button" onClick={() => setTab("configuration")} className={`mt-4 ${primary}`}>Manage configuration</button>
      </Panel>
      <Panel title="Daily payment workflow" description="Bank transfers are reconciled by an admin. A screenshot or customer message alone never activates a plugin.">
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{["Customer chooses a plugin and receives an order reference, exact amount and bank details.", "Match the reference and received money in your bank. Record the actual bank transaction once.", "Full, eligible payment activates the plugin for its stated service period. Partial or late funds remain visible for review.", "For refunds, create a refund request, transfer money from your bank and record the outgoing bank reference."].map((step, index) => <li key={step} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold">{index + 1}</span><p className={textSmall}>{step}</p></li>)}</ol>
        <div className="mt-5 flex flex-wrap gap-3"><button type="button" className={primary} onClick={() => setTab("orders")}>Review orders & refunds</button><button type="button" className={secondary} onClick={() => setTab("ledger")}>View income & expenses</button></div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-3"><Metric label="Awaiting payment" value={summary.awaiting_payment_count ?? "—"} note="Orders still waiting for full payment" /><Metric label="Paid orders" value={summary.paid_order_count ?? "—"} note="Successfully settled orders" /><Metric label="Refunds awaiting bank transfer" value={money(summary.pending_refund_cents)} note="Reserved for refund; excluded from money paid out until completed" /></div>
    </div>}
    {tab === "configuration" && <div id="billing-configuration" className="space-y-6">
      <Panel title="1. Receiving bank accounts" description="Keep multiple business accounts, choose one for new orders and retain previous accounts for reconciliation. Bank details appear to customers at checkout.">
        <div className="space-y-3">{state.bank_accounts.map(account => <details key={`${account.id}-${account.version}`} className="rounded-xl border border-zinc-200"><summary className="flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-2 p-4"><div><span className="font-medium">{account.label}</span><span className="ml-2 text-sm text-zinc-500">{account.bank_name} · ending {account.account_number.slice(-4)}</span></div><div className="flex gap-2">{state.settings.default_bank_account_id === account.id && <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs">Default</span>}<Status value={account.active ? "active" : "inactive"} /><span className="text-xs text-zinc-500">Edit ▾</span></div></summary><div className="border-t border-zinc-200 p-4"><BankForm account={account} /></div></details>)}</div>
        <details className="mt-4 rounded-xl border border-dashed border-zinc-300"><summary className="min-h-12 cursor-pointer p-4 font-medium">＋ Add receiving account</summary><div className="border-t border-zinc-200 p-4"><BankForm /></div></details>
      </Panel>
      <Panel title="2. Checkout, tax and fees" description="Tax applies to the listed plugin price. The transaction percentage applies to price plus tax; the fixed fee is added once per order. Values are rounded to cents."><SettingsForm key={state.settings.version} settings={state.settings} accounts={state.bank_accounts} catalog={state.catalog} /></Panel>
      <Panel title="3. Plugin prices and publication" description="USD per business, per month. Price changes affect future orders. Existing quotes and already paid service periods keep their terms.">
        <div className="grid gap-4 xl:grid-cols-2">{state.catalog.map(item => <CatalogForm key={`${item.plugin_id}-${item.version}`} item={item} settings={state.settings} />)}</div>
      </Panel>
      <Panel title="External plugins" description="Prepare a partner plugin and its pricing now. Preview plugins cannot collect a payment."><p className={textSmall}>Before opening paid sales for a partner, connect plugin activation and expiry, agree the refund policy and provider contract, then verify fulfillment. Platform commission and the amount owed to the publisher are tracked separately. Publisher balances shown here are liabilities; this workspace does not automatically send partner payouts.</p><details className="mt-4 rounded-xl border border-zinc-200"><summary className="min-h-12 cursor-pointer p-4 font-medium">＋ Prepare external plugin</summary><div className="border-t border-zinc-200 p-4"><ExternalPluginForm /></div></details><p className={`mt-4 ${textSmall}`}>Payroll Data Download stays free. Campaigns keeps its separate credit billing. Booking Deposit&apos;s customer deposits are a separate salon payment flow from this Market subscription.</p></Panel>
    </div>}
    {tab === "orders" && <div id="billing-orders"><Orders state={state} /></div>}
    {tab === "ledger" && <div id="billing-ledger"><Ledger state={state} /></div>}
  </div>;
}

function BankForm({ account }: { account?: MarketBankAccount }) {
  return <AdminActionForm action={saveMarketBankAccount} className="grid gap-4">
    <input type="hidden" name="bank_id" value={account?.id ?? ""} /><input type="hidden" name="version" value={account?.version ?? ""} />
    <div className="grid gap-4 sm:grid-cols-2">{([{ name: "label", label: "Account label", max: 120, required: true, placeholder: "Main USD account" }, { name: "bank_name", label: "Bank name", max: 160, required: true }, { name: "beneficiary", label: "Account holder / beneficiary", max: 160, required: true }, { name: "account_number", label: "Account number / IBAN", max: 100, required: true }, { name: "routing", label: "Routing number / SWIFT", max: 100, required: false }] as const).map(field => <label className="text-sm font-medium" key={field.name}>{field.label}<input name={field.name} className={input} defaultValue={account?.[field.name] ?? ""} maxLength={field.max} required={field.required} autoComplete="off" spellCheck={false} /></label>)}</div>
    <label className="text-sm font-medium">Transfer instructions<textarea name="instructions" className={input} defaultValue={account?.instructions ?? ""} rows={3} maxLength={2000} placeholder="Transfer in USD. Include the order reference. Your bank may charge a separate transfer fee." /></label>
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="active" defaultChecked={account?.active ?? true} className="mt-1 h-4 w-4" /><span><strong>Active receiving account</strong><span className="mt-1 block text-zinc-500">Inactive accounts remain in payment history. Select a different default account before deactivating the current one.</span></span></label>
    <div><button className={primary}>{account ? "Save receiving account" : "Add receiving account"}</button></div>
  </AdminActionForm>;
}

function readDecimal(value: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim())) throw new Error("Invalid value");
  const [whole, decimals = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
}

function localBankTime(value: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  const roundTrip = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  return roundTrip === value.slice(0, 16) ? parsed.toISOString().replace(/\.\d{3}Z$/, "Z") : "";
}

function SettingsForm({ settings, accounts, catalog }: { settings: MarketBillingSettings; accounts: MarketBankAccount[]; catalog: MarketBillingCatalogItem[] }) {
  const [tax, setTax] = useState(monthPrice(settings.tax_bps));
  const [fee, setFee] = useState(monthPrice(settings.fee_bps));
  const [fixed, setFixed] = useState(monthPrice(settings.fixed_fee_cents));
  const [selected, setSelected] = useState(settings.default_bank_account_id ?? "");
  const [enabled, setEnabled] = useState(settings.enabled);
  const bank = accounts.find(account => account.id === selected);
  const bankReady = Boolean(bank?.active && bank.bank_name && bank.beneficiary && bank.account_number);
  const quotes = catalog.filter(item => item.fulfillment_ready).map(item => {
    try { return { item, quote: marketQuote(item.price_cents, readDecimal(tax), readDecimal(fee), readDecimal(fixed)) }; }
    catch { return { item, quote: null }; }
  });
  let validRates = true;
  try { marketQuote(0, readDecimal(tax), readDecimal(fee), readDecimal(fixed)); } catch { validRates = false; }
  return <AdminActionForm action={saveMarketBillingSettings} className="grid gap-5">
    <input type="hidden" name="version" value={settings.version} />
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Default receiving account<select name="default_bank_account_id" className={input} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select an account</option>{accounts.map(account => <option key={account.id} value={account.id} disabled={!account.active}>{account.label} · {account.bank_name}{!account.active ? " (inactive)" : ""}</option>)}</select></label><label className="text-sm font-medium">Payment deadline (hours)<input type="number" name="order_expiry_hours" className={input} min={1} max={720} step={1} required defaultValue={settings.order_expiry_hours} /><span className="mt-1 block text-xs font-normal leading-5 text-zinc-500">1–720 hours after order creation. Late payments require review.</span></label></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><label className="text-sm font-medium">Tax label<input name="tax_label" className={input} maxLength={80} required defaultValue={settings.tax_label} /></label>{[{ name: "tax", label: "Tax (%)", value: tax, change: setTax, max: 100 }, { name: "fee", label: "Transaction fee (%)", value: fee, change: setFee, max: 100 }, { name: "fixed", label: "Fixed fee (USD / order)", value: fixed, change: setFixed, max: 1_000_000 }].map(field => <label className="text-sm font-medium" key={field.name}>{field.label}<input name={field.name} className={input} type="number" inputMode="decimal" step="0.01" min={0} max={field.max} required value={field.value} onChange={event => field.change(event.target.value)} /></label>)}</div>
    <p className={textSmall}>Customer total = plugin price + tax + transaction fee. Tax uses the plugin price; the percentage transaction fee uses price plus tax. Transfer fees charged separately by a customer&apos;s bank are outside this quote. Customer payments and the ledger are in USD.</p>
    <div className="rounded-xl bg-zinc-50 p-4" aria-live="polite"><h3 className="mb-3 text-sm font-semibold">Customer total preview</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-2 pr-4 font-medium">Plugin</th><th className="p-2 font-medium">Price</th><th className="p-2 font-medium">Tax</th><th className="p-2 font-medium">Fees</th><th className="p-2 font-medium">Total / month</th></tr></thead><tbody>{quotes.map(({ item, quote }) => <tr key={item.plugin_id} className="border-t border-zinc-200"><th className="py-3 pr-4 font-normal">{item.name}</th>{quote ? [quote.baseCents, quote.taxCents, quote.feeCents, quote.totalCents].map((amount, index) => <td className={`whitespace-nowrap p-2 tabular-nums ${index === 3 ? "font-semibold" : ""}`} key={index}>{money(amount)}</td>) : <td colSpan={4} className="p-2 text-red-700">Enter valid tax and fees.</td>}</tr>)}</tbody></table></div></div>
    <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4"><input type="checkbox" name="enabled" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="mt-1 h-4 w-4" /><span><strong className="text-sm">Enable bank payments in Market</strong><span className={`mt-1 block ${textSmall}`}>Customers can create an order using your configured prices and bank details. Disabling new checkout keeps existing orders available for reconciliation.</span></span></label>
    {enabled && !bankReady && <p role="alert" className="text-sm text-amber-800">Select a complete, active receiving bank account to enable payments.</p>}
    <div><button className={primary} disabled={!validRates || (enabled && !bankReady)}>Save payment configuration</button><p className="mt-2 text-xs leading-5 text-zinc-500">Changes take effect for new orders immediately. Already created orders keep their original quote.</p></div>
  </AdminActionForm>;
}

function CatalogForm({ item, settings }: { item: MarketBillingCatalogItem; settings: MarketBillingSettings }) {
  const [price, setPrice] = useState(monthPrice(item.price_cents));
  let quote = null;
  try { quote = marketQuote(readDecimal(price), settings.tax_bps, settings.fee_bps, settings.fixed_fee_cents); } catch { /* Invalid edits are shown below. */ }
  return <AdminActionForm action={saveMarketBillingCatalog} className="grid gap-4 rounded-xl border border-zinc-200 p-4">
    <input type="hidden" name="plugin_id" value={item.plugin_id} /><input type="hidden" name="version" value={item.version} />
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{item.name}</h3><p className="mt-1 text-xs text-zinc-500">{item.publisher} · monthly</p></div><span className={`rounded-full px-2 py-1 text-xs ${item.fulfillment_ready ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}>{item.fulfillment_ready ? "Ready for paid access" : "Preview · payments unavailable"}</span></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Monthly price (USD)<input name="price" type="number" inputMode="decimal" step="0.01" min="0.01" max={1_000_000} required value={price} onChange={event => setPrice(event.target.value)} className={input} /></label><label className="text-sm font-medium">Platform commission (%)<input name="commission" type="number" inputMode="decimal" step="0.01" min={0} max={100} required defaultValue={monthPrice(item.commission_bps)} className={input} /><span className="mt-1 block text-xs font-normal leading-5 text-zinc-500">Partner settlement only; excluded from the customer fee.</span></label></div>
    {item.plugin_id==='booksms' && <><label className="text-sm font-medium">Monthly SMS allowance<input name="monthly_sms_limit" type="number" min="0" max="1000000" defaultValue={item.monthly_sms_limit??0} className={input}/></label><label className="flex gap-3 text-sm"><input name="fulfillment_ready" type="checkbox" defaultChecked={item.fulfillment_ready}/>Open BookSMS purchases after price and SMS allowance are approved</label></>}
    <label className="flex items-center gap-3 text-sm"><input name="published" type="checkbox" defaultChecked={item.published} className="h-4 w-4" /><span>Show in customer Market</span></label>
    <div className="rounded-lg bg-zinc-50 p-3 text-sm" aria-live="polite">{quote ? <><span className="text-zinc-500">{item.fulfillment_ready ? "Customer total with current fees" : "Planned total with current fees"}</span><strong className="mt-1 block text-lg tabular-nums">{money(quote.totalCents)} <span className="text-xs font-normal text-zinc-500">/ month</span></strong></> : <span className="text-red-700">Enter a valid monthly price.</span>}</div>
    {!item.fulfillment_ready && <p className="text-xs leading-5 text-zinc-500">A listed price can be prepared now. This plugin cannot collect payment until its activation and expiry are connected.</p>}
    <div><button className={primary} disabled={!quote}>Save plugin</button></div>
  </AdminActionForm>;
}

export function Orders({ state }: { state: MarketBillingAdminState }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const filtered = state.orders.filter(order => {
    const matches = `${order.reference} ${order.plugin_name} ${order.salon_name ?? ""} ${order.salon_id} ${order.payer_name ?? ""}`.toLowerCase().includes(search.toLowerCase().trim());
    if (!matches) return false;
    if (filter === "unapplied") return order.unapplied_cents > 0;
    if (filter === "refund_pending") return state.refunds.some(refund => refund.order_id === order.id && refund.status === "pending");
    return filter === "all" || order.status === filter;
  });
  const selectedOrder = state.orders.find(order => order.id === selected);
  const pending = state.refunds.filter(refund => refund.status === "pending");
  return <div className="space-y-6">
    {pending.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-medium">{pending.length} refund{pending.length === 1 ? "" : "s"} awaiting a bank transfer</p><p className={`mt-1 ${textSmall}`}>Open the order, transfer the refund from your bank and record its outgoing reference. Pending requests do not count as paid out.</p></div>}
    <Panel title="Customer orders" description="Search by order reference, plugin or business. Times shown in Central Time. Review your bank statement before recording money received.">
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_240px]"><label className="text-sm font-medium">Search<input className={input} type="search" value={search} placeholder="Order reference, plugin or business" onChange={event => { setSearch(event.target.value); setPage(0); }} /></label><label className="text-sm font-medium">Show<select className={input} value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">All orders</option><option value="awaiting_payment">Awaiting payment</option><option value="partially_paid">Partial payment</option><option value="paid">Paid</option><option value="unapplied">Unapplied customer money</option><option value="refund_pending">Pending refunds</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="refunded">Refunded</option></select></label></div>
      {!filtered.length && <p className="rounded-xl bg-zinc-50 p-6 text-sm text-zinc-500">{state.orders.length ? "No orders match these filters." : "Orders appear here when customers choose bank payment in Market."}</p>}
      <div className="space-y-3">{filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(order => <div key={order.id} className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 ${selected === order.id ? "border-zinc-700 bg-zinc-50" : "border-zinc-200"}`}><div className="min-w-0"><p className="break-all text-sm font-semibold">{order.reference}</p><p className="mt-1 text-sm">{order.plugin_name}</p><p className="mt-1 text-xs text-zinc-500">{order.salon_name ?? `Business ${order.salon_id.slice(0, 8)}`} · {date(order.created_at)}</p></div><div className="flex flex-wrap items-center gap-4"><div className="text-right"><p className="font-semibold tabular-nums">{money(order.total_cents)}</p><p className="mt-1 text-xs text-zinc-500">Received {money(receivedTotal(order))}</p>{order.unapplied_cents > 0 && <p className="mt-1 text-xs text-amber-800">Unapplied {money(order.unapplied_cents)}</p>}</div><Status value={order.status} /><button type="button" className={secondary} aria-expanded={selected === order.id} aria-controls="billing-order-detail" onClick={() => setSelected(selected === order.id ? null : order.id)}>{selected === order.id ? "Close" : "Review"}<span className="sr-only"> order {order.reference}</span></button></div></div>)}</div>
      <PageControls page={page} count={filtered.length} onPage={setPage} />
      {state.truncated && <p className="mt-3 text-xs text-zinc-500">Showing the most recent {state.orders.length} orders. All-time financial totals include the full ledger.</p>}
    </Panel>
    {selectedOrder && <div id="billing-order-detail"><OrderDetail key={selectedOrder.id} order={selectedOrder} state={state} /></div>}
  </div>;
}

function OrderDetail({ order, state }: { order: MarketBillingOrder; state: MarketBillingAdminState }) {
  const receipts = state.receipts.filter(receipt => receipt.order_id === order.id);
  const refunds = state.refunds.filter(refund => refund.order_id === order.id);
  const pendingCents = refunds.filter(refund => refund.status === "pending").reduce((sum, refund) => sum + refund.amount_cents, 0);
  const refundable = Math.max(0, order.received_cents - order.refunded_applied_cents + order.unapplied_cents - pendingCents);
  const grossReceived = receivedTotal(order);
  const bank = typeof order.snapshot?.bank === "object" && order.snapshot.bank ? order.snapshot.bank as Record<string, unknown> : {};
  const bankText = (key: string) => typeof bank[key] === "string" ? bank[key] as string : "—";
  const due = Math.max(0, order.total_cents - order.received_cents);
  const [receivedTime, setReceivedTime] = useState("");
  return <Panel title={`Order ${order.reference}`} description={`${order.plugin_name} · ${order.publisher} · quote fixed when this order was created`} action={<Status value={order.status} />}>
    <div className="grid gap-5 lg:grid-cols-2"><div className="rounded-xl bg-zinc-50 p-4"><h3 className="font-semibold">Customer quote · USD</h3><dl className="mt-3 grid grid-cols-[1fr_auto] gap-2 text-sm"><dt>Plugin price</dt><dd className="tabular-nums">{money(order.base_cents)}</dd><dt>{typeof order.snapshot.tax_label === "string" ? order.snapshot.tax_label : "Tax"}</dt><dd className="tabular-nums">{money(order.tax_cents)}</dd><dt>Transaction fees</dt><dd className="tabular-nums">{money(order.fee_cents)}</dd><dt className="border-t border-zinc-200 pt-2 font-semibold">Order total</dt><dd className="border-t border-zinc-200 pt-2 font-semibold tabular-nums">{money(order.total_cents)}</dd><dt>Money received</dt><dd className="tabular-nums">{money(grossReceived)}</dd><dt>Applied to order</dt><dd className="tabular-nums">{money(order.received_cents)}</dd><dt>Money refunded</dt><dd className="tabular-nums">{money(order.refunded_cents)}</dd><dt>Refund requested</dt><dd className="tabular-nums">{money(pendingCents)}</dd><dt>Late or excess funds held</dt><dd className="tabular-nums">{money(order.unapplied_cents)}</dd>{due > 0 && <><dt className="text-amber-800">Remaining order amount</dt><dd className="tabular-nums text-amber-800">{money(due)}</dd></>}</dl></div>
      <div className="rounded-xl border border-zinc-200 p-4"><h3 className="font-semibold">Receiving bank on this order</h3><dl className="mt-3 space-y-2 text-sm">{[["Account", "label"], ["Bank", "bank_name"], ["Account holder", "beneficiary"], ["Account number / IBAN", "account_number"], ["Routing / SWIFT", "routing"]].map(([label, key]) => <div key={key} className="grid gap-1 sm:grid-cols-[140px_1fr]"><dt className="text-zinc-500">{label}</dt><dd className="break-all">{bankText(key)}</dd></div>)}</dl><p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-500">{bankText("instructions")}</p></div></div>
    <dl className="my-5 grid gap-3 rounded-xl border border-zinc-200 p-4 text-sm sm:grid-cols-3"><div><dt className="text-zinc-500">Payment deadline</dt><dd className="mt-1">{date(order.expires_at)}</dd></div><div><dt className="text-zinc-500">Paid at</dt><dd className="mt-1">{date(order.paid_at)}</dd></div><div><dt className="text-zinc-500">Service period</dt><dd className="mt-1">{order.service_start && order.service_end ? `${date(order.service_start)} to ${date(order.service_end)}` : "Begins after eligible full payment"}</dd></div></dl>
    {order.unapplied_cents > 0 && <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">This order holds {money(order.unapplied_cents)} in late or excess customer funds. These funds stay separate from earned revenue. Review the receipts and refund funds where needed.</p>}
    <div className="space-y-3">
      <details className="rounded-xl border border-zinc-200"><summary className="min-h-12 cursor-pointer p-4 font-medium">Record money received</summary><div className="border-t border-zinc-200 p-4"><p className={`mb-4 ${textSmall}`}>Enter the actual settled transfer from your bank statement. Use its unique bank reference. A customer upload is not proof of receipt. Late or excess funds are recorded for reconciliation without automatically extending service.</p><AdminActionForm action={recordMarketBankReceipt} className="grid gap-4" resetOnSuccess>
        <input type="hidden" name="order_id" value={order.id} /><input type="hidden" name="received_at" value={receivedTime} />
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Bank transaction reference<input name="bank_reference" className={input} maxLength={160} required autoComplete="off" /></label><label className="text-sm font-medium">Actual received amount (USD)<input name="amount" className={input} type="number" inputMode="decimal" step="0.01" min="0.01" max={1_000_000} required /></label><label className="text-sm font-medium">Bank received date & time (your local time)<input className={input} type="datetime-local" required onChange={event => setReceivedTime(localBankTime(event.target.value))} /><span className="mt-1 block text-xs font-normal leading-5 text-zinc-500">Use the time in your browser&apos;s local timezone. Converted to UTC when saved.</span></label></div>
        <label className="text-sm font-medium">Reconciliation note<textarea name="note" className={input} rows={2} maxLength={2000} required placeholder="How you matched this transfer to the customer and order." /></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="bank_verified" required className="mt-1 h-4 w-4" /><span>I verified that this money settled in the order&apos;s receiving bank account.</span></label><div><button className={primary}>Record verified receipt</button></div>
      </AdminActionForm></div></details>
      <details className="rounded-xl border border-zinc-200"><summary className="min-h-12 cursor-pointer p-4 font-medium">Receipts & reconciliation history ({receipts.length})</summary><div className="border-t border-zinc-200 p-4">{receipts.length ? <div className="space-y-3">{receipts.map(receipt => <div key={receipt.id} className="rounded-lg bg-zinc-50 p-3"><div className="flex flex-wrap justify-between gap-2"><p className="break-all text-sm font-semibold">{receipt.bank_reference}</p><strong className="text-sm tabular-nums">{money(receipt.amount_cents)}</strong></div><p className="mt-1 text-xs text-zinc-500">{date(receipt.received_at)} · Applied {money(receipt.applied_cents)} · Unapplied {money(receipt.unapplied_cents)}</p>{receipt.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-600">{receipt.note}</p>}</div>)}</div> : <p className={textSmall}>No bank receipt has been recorded.</p>}</div></details>
      <details className="rounded-xl border border-zinc-200"><summary className="min-h-12 cursor-pointer p-4 font-medium">Refunds ({refunds.length}) · Available {money(refundable)}</summary><div className="space-y-5 border-t border-zinc-200 p-4">
        {refunds.map(refund => <Refund key={`${refund.id}-${refund.status}`} refund={refund} />)}
        {pendingCents > 0 ? <p className={textSmall}>Complete the pending refund before creating another refund request.</p> : refundable > 0 ? <AdminActionForm action={requestMarketBillingRefund} className="grid gap-4"><input type="hidden" name="order_id" value={order.id} /><h4 className="font-semibold">Request a bank refund</h4><p className={textSmall}>Create the request before transferring money. The request reserves the amount and does not count as money paid out. A full refund of a paid service withdraws its access. Unapplied excess funds are refunded first, preserving paid access.</p><label className="max-w-sm text-sm font-medium">Refund amount (USD)<input name="amount" className={input} type="number" inputMode="decimal" step="0.01" min="0.01" max={monthPrice(refundable)} required /></label><label className="text-sm font-medium">Reason<textarea name="reason" className={input} rows={2} maxLength={2000} minLength={3} required placeholder="Overpayment, late transfer, cancellation or another refund reason." /></label><div><button className={primary}>Create refund request</button></div></AdminActionForm> : <p className={textSmall}>No unreserved received balance is available for a new refund.</p>}
      </div></details>
      {["awaiting_payment", "expired"].includes(order.status) && order.received_cents === 0 && order.unapplied_cents === 0 && <details className="rounded-xl border border-zinc-200"><summary className="min-h-12 cursor-pointer p-4 text-sm font-medium">Cancel this order</summary><div className="border-t border-zinc-200 p-4"><p className={`mb-4 ${textSmall}`}>Cancelling stops this unpaid order from activating a plugin. An order with received money must use the refund workflow.</p><AdminActionForm action={cancelMarketBillingOrder} confirmMessage="Cancel this unpaid order?"><input type="hidden" name="order_id" value={order.id} /><button className={secondary}>Cancel order</button></AdminActionForm></div></details>}
    </div>
  </Panel>;
}

function Refund({ refund }: { refund: MarketBillingRefund }) {
  return <div className="rounded-xl border border-zinc-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="tabular-nums">{money(refund.amount_cents)}</strong><Status value={refund.status} /></div>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-600">{refund.reason}</p><p className="mt-1 text-xs text-zinc-500">Requested {date(refund.created_at)}</p>
    {refund.status === "completed" && <p className="mt-2 break-all text-sm">Outgoing bank reference: <strong>{refund.bank_reference}</strong></p>}
    {refund.status === "cancelled" && <p className="mt-2 text-sm text-zinc-500">Request cancelled. No money was paid out through this request.</p>}
    {refund.status === "pending" && <>
      <AdminActionForm action={completeMarketBillingRefund} className="mt-4 grid gap-4"><input type="hidden" name="refund_id" value={refund.id} /><p className={textSmall}>Transfer this amount from your bank to the verified customer receiving account, then record the outgoing transaction below.</p><label className="text-sm font-medium">Outgoing bank transaction reference<input name="bank_reference" className={input} maxLength={160} required autoComplete="off" /></label><label className="text-sm font-medium">Refund reconciliation note<textarea name="note" className={input} maxLength={2000} rows={2} required placeholder="Record how you verified the recipient and completed bank transfer." /></label><label className="flex items-start gap-3 text-sm"><input name="bank_verified" type="checkbox" required className="mt-1 h-4 w-4" /><span>I verified that the bank refund transfer is completed.</span></label><div><button className={primary}>Record completed bank refund</button></div></AdminActionForm>
      <details className="mt-4 border-t border-zinc-200 pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium text-zinc-600">Cancel this refund request</summary><AdminActionForm action={cancelMarketBillingRefund} className="mt-3 grid gap-4"><input type="hidden" name="refund_id" value={refund.id} /><p className={textSmall}>Cancel an incorrect request before sending money. If the transfer already happened, record the completed refund instead.</p><label className="text-sm font-medium">Cancellation reason<textarea name="reason" className={input} minLength={3} maxLength={2000} rows={2} required /></label><label className="flex items-start gap-3 text-sm"><input name="no_bank_transfer" type="checkbox" required className="mt-1 h-4 w-4" /><span>No outgoing bank transfer has been completed for this request.</span></label><div><button className={secondary}>Cancel refund request</button></div></AdminActionForm></details>
    </>}
  </div>;
}

export function Ledger({ state }: { state: MarketBillingAdminState }) {
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const summary = state.summary;
  const orders = new Map(state.orders.map(order => [order.id, order]));
  const receipts = new Map(state.receipts.map(receipt => [receipt.id, receipt]));
  const refunds = new Map(state.refunds.map(refund => [refund.id, refund]));
  const reference = (entry: MarketBillingAdminState["ledger"][number]) => entry.bank_reference || (entry.receipt_id ? receipts.get(entry.receipt_id)?.bank_reference : entry.refund_id ? refunds.get(entry.refund_id)?.bank_reference : "");
  const orderFor = (entry: MarketBillingAdminState["ledger"][number]) => entry.order_id ? orders.get(entry.order_id) : undefined;
  const filtered = state.ledger.filter(entry => (kind === "all" || entry.kind === kind) && `${orderFor(entry)?.reference ?? ""} ${orderFor(entry)?.plugin_name ?? ""} ${reference(entry) ?? ""} ${entry.note ?? ""}`.toLowerCase().includes(search.toLowerCase().trim()));
  const metrics = [
    { label: "Money received", cents: summary.cash_in_cents, note: "Verified incoming bank transfers" },
    { label: "Customer refunds paid", cents: summary.cash_out_cents, note: "Completed customer bank refunds" },
    { label: "Business expenses paid", cents: summary.expense_cents, note: "Other verified outgoing bank payments" },
    { label: "Net bank cash", cents: summary.net_cash_cents, note: "Received minus refunds and expenses" },
    { label: "Plugin revenue", cents: summary.revenue_cents, note: "Plugin value after completed refunds; includes platform commission" },
    { label: "Tax collected", cents: summary.tax_cents, note: "Tax allocation after completed refunds" },
    { label: "Transaction fees", cents: summary.fee_cents, note: "Customer processing fees after refunds" },
    { label: "Platform commission", cents: summary.commission_cents, note: "Included in plugin revenue, not additional cash" },
    { label: "Owed to external publishers", cents: summary.publisher_payable_cents, note: "Partner liability; no automated payouts" },
    { label: "Customer funds not applied", cents: summary.unapplied_cents, note: "Funds held for review or refund" },
    { label: "Customer deposits held", cents: summary.customer_deposit_cents, note: "Customer funds awaiting settlement or return" },
    { label: "Customer liabilities", cents: summary.total_liability_cents, note: "Customer deposits plus late or excess funds; tax and partner balances shown separately" },
    { label: "Pending refund requests", cents: summary.pending_refund_cents, note: "Reserved funds, not yet paid out" },
  ];
  return <div className="space-y-6"><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metrics.slice(0, 4).map(metric => <Metric key={metric.label} label={metric.label} value={money(metric.cents)} note={metric.note} />)}</div>
    <Panel title="Cash allocation and balances" description="Collected tax, customer deposits and amounts owed to partners are separate from business earnings. Commission is already included in plugin revenue.">
      <dl className="grid gap-x-6 sm:grid-cols-2">{metrics.slice(4).map(metric => <div key={metric.label} className="flex items-start justify-between gap-4 border-b border-zinc-100 py-3"><dt><span className="block text-sm font-medium">{metric.label}</span><span className="mt-1 block max-w-xs text-xs leading-5 text-zinc-500">{metric.note}</span></dt><dd className="shrink-0 text-sm font-semibold tabular-nums">{money(metric.cents)}</dd></div>)}</dl>
    </Panel>
    <Panel title="Record a business expense" description="Use this for a verified bank charge or operating expense. Customer refunds must use the order refund workflow so their balances stay correct."><details className="rounded-xl border border-zinc-200"><summary className="min-h-12 cursor-pointer p-4 font-medium">＋ Add money paid out</summary><div className="border-t border-zinc-200 p-4"><ExpenseForm accounts={state.bank_accounts} /></div></details></Panel>
    <Panel title="Cash ledger" description="All-time totals above use the full ledger. Each receipt and completed refund creates one cash movement. Revenue, tax, fees and amounts owed are allocations of that cash, not additional receipts." action={<Link href="/admin/market/ledger/export" className={secondary}>Export ledger CSV ↓</Link>}>
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_220px]"><label className="text-sm font-medium">Search<input type="search" className={input} placeholder="Bank reference, order, plugin or expense" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label><label className="text-sm font-medium">Cash movement<select className={input} value={kind} onChange={event => { setKind(event.target.value); setPage(0); }}><option value="all">All movements</option><option value="cash_in">Money received</option><option value="cash_out">Customer refunds</option><option value="expense">Business expenses</option></select></label></div>
      {filtered.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-zinc-200 text-zinc-500">{["Date · Central Time", "Order / bank reference", "Movement", "Cash", "Revenue", "Tax", "Fees", "Unapplied"].map(label => <th key={label} className="whitespace-nowrap p-3 font-medium">{label}</th>)}</tr></thead><tbody>{filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(entry => <tr className="border-b border-zinc-100" key={entry.id}><td className="whitespace-nowrap p-3">{date(entry.occurred_at ?? entry.created_at)}</td><td className="max-w-64 break-all p-3"><strong>{orderFor(entry)?.reference ?? (entry.order_id ? entry.order_id.slice(0, 8) : "Business expense")}</strong><span className="mt-1 block text-xs text-zinc-500">{reference(entry) ?? "—"}</span>{entry.note && <span className="mt-1 block text-xs text-zinc-500">{entry.note}</span>}</td><td className="whitespace-nowrap p-3">{entry.kind === "cash_in" ? "Received" : entry.kind === "expense" ? "Expense" : "Refunded"}</td><td className={`whitespace-nowrap p-3 font-semibold tabular-nums ${entry.kind === "cash_in" ? "text-emerald-700" : "text-red-700"}`}>{entry.kind === "cash_in" ? "+" : "−"}{money(entry.amount_cents)}</td>{[entry.revenue_cents, entry.tax_cents, entry.fee_cents, entry.unapplied_cents].map((amount, index) => <td className="whitespace-nowrap p-3 tabular-nums" key={index}>{money(amount)}</td>)}</tr>)}</tbody></table></div> : <p className="rounded-xl bg-zinc-50 p-6 text-sm text-zinc-500">{state.ledger.length ? "No movements match these filters." : "Record a verified bank receipt or completed outgoing transfer to start the cash ledger."}</p>}
      <PageControls page={page} count={filtered.length} onPage={setPage} />
      {state.truncated && <p className="mt-3 text-xs text-zinc-500">The list shows the most recent {state.ledger.length} cash movements. Financial totals include all movements.</p>}
    </Panel>
  </div>;
}

function ExpenseForm({ accounts }: { accounts: MarketBankAccount[] }) {
  const [paidTime, setPaidTime] = useState("");
  return <AdminActionForm action={recordMarketBankExpense} className="grid gap-4" resetOnSuccess>
    <input type="hidden" name="received_at" value={paidTime} />
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Paying bank account<select name="bank_id" className={input} required defaultValue=""><option value="">Select the paying account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.label} · {account.bank_name}</option>)}</select></label><label className="text-sm font-medium">Outgoing bank reference<input name="bank_reference" className={input} maxLength={160} required autoComplete="off" /></label><label className="text-sm font-medium">Amount paid (USD)<input name="amount" className={input} type="number" inputMode="decimal" step="0.01" min="0.01" max={1_000_000} required /></label><label className="text-sm font-medium">Bank paid date & time (your local time)<input type="datetime-local" className={input} required onChange={event => setPaidTime(localBankTime(event.target.value))} /><span className="mt-1 block text-xs font-normal leading-5 text-zinc-500">Use your browser&apos;s local timezone. Converted to UTC when saved.</span></label></div>
    <label className="text-sm font-medium">Expense description<textarea name="note" className={input} maxLength={2000} rows={2} required placeholder="What was paid, to whom, and how the bank transaction was verified." /></label>
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="bank_verified" required className="mt-1 h-4 w-4" /><span>I verified this business expense was paid from the selected bank account.</span></label>
    <div><button className={primary} disabled={!accounts.length}>Record verified expense</button></div>
  </AdminActionForm>;
}

function ExternalPluginForm() {
  return <AdminActionForm action={saveMarketBillingCatalog} className="grid gap-4" resetOnSuccess>
    <input name="version" type="hidden" value="" />
    <p className={textSmall}>This creates a preview configuration. The admin cannot enable paid checkout for an external plugin until its delivery integration is released.</p>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Plugin identifier<input name="plugin_id" className={input} required maxLength={80} pattern="[a-z][a-z0-9-]{1,79}" placeholder="partner-plugin-name" /><span className="mt-1 block text-xs font-normal leading-5 text-zinc-500">A permanent identifier: lowercase letters, numbers and hyphens.</span></label><label className="text-sm font-medium">Plugin name<input name="name" className={input} required maxLength={160} /></label><label className="text-sm font-medium">Publisher / partner name<input name="publisher" className={input} required maxLength={160} /></label><label className="text-sm font-medium">Planned monthly price (USD)<input name="price" className={input} type="number" inputMode="decimal" step="0.01" min="0.01" max={1_000_000} required /></label><label className="text-sm font-medium">Platform commission (%)<input name="commission" className={input} type="number" inputMode="decimal" step="0.01" min={0} max={100} required defaultValue="0" /></label></div>
    <label className="flex items-center gap-3 text-sm"><input name="published" type="checkbox" className="h-4 w-4" /><span>Publish as a preview in Market</span></label>
    <div><button className={primary}>Prepare external plugin</button></div>
  </AdminActionForm>;
}

