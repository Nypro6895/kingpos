"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { NavigationForm, NavigationSubmitButton } from "@/components/navigation-form";
import { AdminActionForm } from "../../_components/action-form";
import { checkAutomaticTaxConnection, saveAutomaticTaxProduct, saveAutomaticTaxSettings } from "./actions";
import type { MarketTaxAdminState, MarketTaxCodeOption, MarketTaxProduct } from "@/types/market-tax";

const field = "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none focus:border-zinc-600 focus:ring-2 focus:ring-zinc-200";
const button = "inline-flex min-h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";
const secondary = "inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50";
const supportedCodes: MarketTaxCodeOption[] = [
  { id: "txcd_10103001", name: "Software as a service (SaaS) · Business use" },
  { id: "txcd_10103000", name: "Software as a service (SaaS) · Personal use" },
  { id: "txcd_10103101", name: "SaaS with electronic download · Business use" },
  { id: "txcd_10103100", name: "SaaS with electronic download · Personal use" },
  { id: "txcd_20030000", name: "General · Services" },
  { id: "txcd_10000000", name: "General · Electronically supplied services" },
  { id: "txcd_00000000", name: "Nontaxable" },
];

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function date(value: string | number | null) {
  if (!value) return "—";
  const parsed = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(parsed) : "—";
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-600">{children} ↗</a>;
}

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 sm:p-6">
    <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
    {description && <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>}
    <div className="mt-5">{children}</div>
  </section>;
}

function TaxCodeField({ codes, defaultValue, emptyLabel }: { codes: MarketTaxCodeOption[]; defaultValue: string | null; emptyLabel: string }) {
  const id = useId();
  const [value, setValue] = useState(defaultValue ?? "");
  const [custom, setCustom] = useState(Boolean(defaultValue && !codes.some(code => code.id === defaultValue)));
  const selected = codes.find(code => code.id === value);
  return <div className="min-w-0">
    <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-zinc-800">Product classification</label>
    <select id={id} className={field} value={custom ? "custom" : value} onChange={event => {
      const next = event.target.value; setCustom(next === "custom"); setValue(next === "custom" ? "" : next);
    }} aria-describedby={`${id}-help`}>
      <option value="">{emptyLabel}</option>
      {codes.map(code => <option key={code.id} value={code.id}>{code.name}</option>)}
      <option value="custom">Use another Stripe classification…</option>
    </select>
    {custom ? <label className="mt-3 block text-xs font-medium text-zinc-700">Exact Stripe tax code<input name="tax_code" className={`${field} mt-1.5`} value={value} onChange={event => setValue(event.target.value)} placeholder="txcd_10103001" maxLength={13} pattern="txcd_[0-9]{8}" required autoComplete="off" /></label> : <input type="hidden" name="tax_code" value={value} />}
    <p id={`${id}-help`} className="mt-2 break-words text-xs leading-5 text-zinc-600">{selected ? `${selected.name} · ${selected.id}` : (custom ? "Copy the exact code from Stripe’s classification list. Its validity is checked when you save." : emptyLabel)}</p>
  </div>;
}

function ProductClassification({ product, codes, defaultCode }: { product: MarketTaxProduct; codes: MarketTaxCodeOption[]; defaultCode: string | null }) {
  const inherited = codes.find(code => code.id === defaultCode)?.name ?? defaultCode;
  return <AdminActionForm action={saveAutomaticTaxProduct} className="grid gap-4 border-t border-zinc-100 py-4 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-start">
    <input type="hidden" name="plugin_id" value={product.plugin_id} />
    <input type="hidden" name="version" value={product.version ?? ""} />
    <div><h3 className="text-sm font-semibold text-zinc-950">{product.name}</h3><p className="mt-1 break-words text-xs text-zinc-500">{product.tax_code ? "Custom classification" : "Uses default"}</p></div>
    <TaxCodeField codes={codes} defaultValue={product.tax_code} emptyLabel={inherited ? `Use default: ${inherited}` : "Use default · No default configured"} />
    <button className={`${secondary} sm:mt-6`} type="submit" aria-label={`Save classification for ${product.name}`}>Save classification</button>
  </AdminActionForm>;
}

function TaxConfiguration({ state, codes }: { state: MarketTaxAdminState; codes: MarketTaxCodeOption[] }) {
  const [enabled, setEnabled] = useState(state.settings.enabled);
  const [behavior, setBehavior] = useState(state.settings.price_behavior);
  const activeRegistrations = state.provider.registrations.filter(item => item.status === "active").length;
  const canEnable = state.provider.connected && state.provider.mode === "live" && state.provider.status === "active" && Boolean(state.provider.head_office?.country) && activeRegistrations > 0 && state.readiness_local;
  return <Panel title="Collection settings" description="Stripe calculates tax from each customer’s location, the product classification and your active registrations. Save your classifications before enabling collection.">
    <AdminActionForm action={saveAutomaticTaxSettings} className="space-y-5">
      <input name="version" type="hidden" value={state.settings.version} />
      <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <input type="checkbox" name="enabled" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={!canEnable && !enabled} className="mt-1 h-4 w-4 accent-zinc-900" aria-label="Enable automatic tax collection" aria-describedby="tax-enable-help" />
        <span><span className="block text-sm font-semibold text-zinc-950">Enable automatic tax collection</span><span id="tax-enable-help" className="mt-1 block text-sm leading-5 text-zinc-600">{canEnable ? "Your current configuration passes the readiness checks. Collection applies to new purchases." : "Keep collection off until your Stripe Tax setup, active registrations and product classifications are ready."}</span></span>
      </label>
      <fieldset><legend className="mb-2 text-sm font-medium text-zinc-800">How listed prices handle tax</legend>
        <div className="grid gap-3 sm:grid-cols-2">{([
          ["exclusive", "Add tax at checkout", "The listed plugin price excludes tax. The customer sees price + calculated tax before paying."],
          ["inclusive", "Include tax in the price", "The listed price includes applicable tax. Stripe separates the tax portion on the invoice."],
        ] as const).map(([value, label, help]) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${behavior === value ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}>
          <input type="radio" name="price_behavior" value={value} checked={behavior === value} onChange={() => setBehavior(value)} className="mt-1 h-4 w-4 accent-zinc-900" />
          <span><span className="block text-sm font-semibold text-zinc-950">{label}</span><span className="mt-1 block text-xs leading-5 text-zinc-600">{help}</span></span>
        </label>)}</div>
      </fieldset>
      <div className="max-w-xl"><TaxCodeField codes={codes} defaultValue={state.settings.default_tax_code} emptyLabel="No default · Choose a Stripe classification" /></div>
      <p className="text-xs leading-5 text-zinc-600">Classify what the customer receives. A plugin can override the default below. <ExternalLink href="https://docs.stripe.com/tax/tax-codes">Review Stripe classifications</ExternalLink></p>
      <div className="flex flex-wrap items-center gap-3"><button className={button} type="submit">Save tax configuration</button><span className="text-xs text-zinc-500">Current collection: {state.settings.enabled ? "On" : "Off"}</span></div>
    </AdminActionForm>
  </Panel>;
}

function ProviderReadiness({ state }: { state: MarketTaxAdminState }) {
  const provider = state.provider;
  const office = provider.head_office;
  const active = provider.registrations.some(item => item.status === "active");
  const checks = [
    ["Payment provider connected", provider.connected],
    ["Live payment mode", provider.mode === "live"],
    ["Stripe Tax setup active", provider.status === "active"],
    ["Business address available", Boolean(office?.country)],
    ["Active tax registrations", active],
    ["Published plugins classified", state.readiness_local],
  ] as const;
  return <Panel title="Connection & readiness" description="Check the same Stripe account used for Market card payments. This refreshes provider details without creating registrations or changing your tax obligations.">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${provider.connected ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{provider.connected ? "Connected" : "Not connected"}</span>{provider.mode && <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">{provider.mode === "live" ? "Live mode" : "Test mode"}</span>}</div>
      <AdminActionForm action={checkAutomaticTaxConnection}><button type="submit" className={secondary}>Check Stripe Tax status</button></AdminActionForm>
    </div>
    <p className="mt-3 text-xs text-zinc-500">Last checked: {date(provider.checked_at)}{provider.mode === "test" ? " · Test data does not confirm live collection readiness." : ""}</p>
    {provider.error && <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">We could not verify the provider setup. Review payment connection settings and check again.</p>}
    <ul className="mt-4 divide-y divide-zinc-100">{checks.map(([label, ready]) => <li key={label} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="text-zinc-700">{label}</span><span className={`shrink-0 text-xs font-semibold ${ready ? "text-emerald-700" : "text-amber-700"}`}>{ready ? "Ready" : "Needs setup"}</span></li>)}</ul>
    <div className="mt-4 flex flex-wrap gap-4 text-sm"><Link href="/admin/market#payment" className="font-medium text-zinc-900 underline underline-offset-4">Manage payment connection</Link><ExternalLink href="https://dashboard.stripe.com/tax">Open Stripe Tax</ExternalLink></div>
    <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-600">Business address from Stripe</p><p className="mt-2 break-words text-sm leading-6 text-zinc-800">{office ? [office.line1, office.city, office.state, office.postal_code, office.country].filter(Boolean).join(", ") : "Not yet configured. Enter your actual business address in Stripe Tax."}</p></div>
  </Panel>;
}

function RegistrationSetup({ state }: { state: MarketTaxAdminState }) {
  return <Panel title="Registrations & filing" description="Selling across the United States requires reviewing the products sold and the states where registration is required. A Wisconsin business address does not set one tax rule for all sales.">
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-950">Wisconsin distinguishes vendor-hosted software access from downloaded prewritten software. Review the delivery method and classification of each plugin before choosing a tax code. <ExternalLink href="https://www.revenue.wi.gov/Pages/FAQS/pcs-computerc.aspx">Wisconsin software tax guidance</ExternalLink></div>
    <div className="mt-5"><h3 className="text-sm font-semibold text-zinc-950">Registrations reported by Stripe</h3>
      {state.provider.registrations.length === 0 ? <div className="mt-3 rounded-lg border border-dashed border-zinc-300 p-4"><p className="text-sm font-medium text-zinc-900">No registrations confirmed yet</p><p className="mt-1 text-sm leading-6 text-zinc-600">Review taxable products and register where required. Then refresh Stripe Tax status here before enabling collection.</p></div> : <ul className="mt-3 divide-y divide-zinc-100">{state.provider.registrations.map(item => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div><p className="text-sm font-semibold text-zinc-800">{[item.country, item.state].filter(Boolean).join(" · ")}</p><p className="mt-1 text-xs text-zinc-500">Starts {date(item.active_from)}{item.expires_at ? ` · Ends ${date(item.expires_at)}` : ""}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === "active" ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}>{item.status}</span></li>)}</ul>}
      <p className="mt-3 text-xs text-zinc-500">Read-only in Reylumi. Registration changes are managed in Stripe.</p>
    </div>
    <div className="mt-5 border-t border-zinc-200 pt-5"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-zinc-950">Tax filing & remittance</h3><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Separate setup · Not verified here</span></div><p className="mt-2 text-sm leading-6 text-zinc-600">Collecting tax during checkout does not complete a tax return or send the money to a tax authority. Confirm your filing arrangement and payment deadlines separately.</p><div className="mt-3 flex flex-wrap gap-4 text-sm"><ExternalLink href="https://docs.stripe.com/tax/registering">Registration guidance</ExternalLink><ExternalLink href="https://docs.stripe.com/tax/filing">Review filing & remittance options</ExternalLink></div></div>
  </Panel>;
}

function TaxLedger({ state }: { state: MarketTaxAdminState }) {
  const [from, setFrom] = useState(state.filters?.from ?? "");
  const [to, setTo] = useState(state.filters?.to ?? "");
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(state.ledger.length / pageSize));
  const exportQuery = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const appliedQuery = new URLSearchParams({ ...(state.filters?.from ? { from: state.filters.from } : {}), ...(state.filters?.to ? { to: state.filters.to } : {}) }).toString();
  return <div className="space-y-5">
    <Panel title="Tax ledger" description="Reylumi’s cash ledger shows tax collected on paid plugins and refunds matched to linked credit notes and successful refund records. All figures are in USD; the filter uses full UTC calendar days.">
      <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><p className="font-semibold">Filing reference: Stripe Tax reports</p><p className="mt-1">Use Stripe Tax reports when preparing filings. They can include finalized invoices before payment and direct refund adjustments before this cash ledger is updated. Pending or failed refunds and issued credit notes can also differ in timing.</p><div className="mt-3 flex flex-wrap gap-4"><ExternalLink href="https://dashboard.stripe.com/tax/locations">Open Stripe Tax reports</ExternalLink><ExternalLink href="https://docs.stripe.com/tax/reports">Reporting guidance</ExternalLink><ExternalLink href="https://docs.stripe.com/tax/invoicing/refunds">Refund adjustment rules</ExternalLink></div></div>
      <NavigationForm method="get" action="/admin/market/tax" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
        <input type="hidden" name="view" value="ledger" />
        <label className="block text-sm font-medium text-zinc-800">Month shortcut<input type="month" className={`${field} mt-1.5`} aria-label="Choose tax month" onChange={event => {
          const value = event.target.value;
          if (!/^\d{4}-\d{2}$/.test(value)) return;
          const [year, month] = value.split("-").map(Number);
          setFrom(`${value}-01`); setTo(`${value}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`);
        }} /></label>
        <label className="block text-sm font-medium text-zinc-800">From<input className={`${field} mt-1.5`} type="date" name="from" value={from} onChange={event => setFrom(event.target.value)} max={to || undefined} /></label>
        <label className="block text-sm font-medium text-zinc-800">To<input className={`${field} mt-1.5`} type="date" name="to" value={to} onChange={event => setTo(event.target.value)} min={from || undefined} /></label>
        <NavigationSubmitButton pendingLabel="Applying…" type="submit" className={button}>Apply dates</NavigationSubmitButton>
      </NavigationForm>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm"><Link href="/admin/market/tax?view=ledger" className="text-zinc-600 underline underline-offset-4">Clear dates</Link><a className="font-medium text-zinc-900 underline underline-offset-4" href={`/admin/market/tax/export${appliedQuery ? `?${appliedQuery}` : ""}`}>Export current ledger CSV</a>{exportQuery !== appliedQuery && <span className="text-xs text-amber-700">Apply dates to update totals and the export.</span>}</div>
    </Panel>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      ["Tax on paid sales", money(state.summary.sale_tax_cents)], ["Matched tax refunds", money(state.summary.refunded_tax_cents)],
      ["Net cash tax collected", money(state.summary.net_tax_cents)], ["Paid invoices", String(state.summary.invoice_count)],
    ].map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4"><p className="text-xs font-medium text-zinc-600">{label}</p><p className="mt-2 break-words text-xl font-semibold tracking-tight text-zinc-950">{value}</p></div>)}</div>
    <Panel title="By jurisdiction" description="Net cash tax is collected sales tax less locally matched tax refunds. These figures help cash reconciliation; Stripe filing reports can use different invoice and refund dates.">
      {state.summary.by_jurisdiction.length === 0 ? <p className="text-sm text-zinc-500">No tax activity in this period.</p> : <>
        <div className="space-y-4 sm:hidden">{state.summary.by_jurisdiction.map((item, index) => <div key={`mobile-${index}`} className="rounded-lg border border-zinc-200 p-3"><h3 className="text-sm font-semibold text-zinc-800">{[item.country, item.state, item.jurisdiction].filter(Boolean).join(" · ") || "Unspecified"}</h3><dl className="mt-3 grid grid-cols-3 gap-2">{[["Sales tax", item.sale_tax_cents], ["Refunded", item.refunded_tax_cents], ["Net tax", item.net_tax_cents]].map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-zinc-900">{money(Number(amount))}</dd></div>)}</dl></div>)}</div>
        <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[560px] text-left text-sm"><thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th scope="col" className="pb-3 pr-4">Jurisdiction</th><th scope="col" className="pb-3 pr-4 text-right">Sales tax</th><th scope="col" className="pb-3 pr-4 text-right">Refunded tax</th><th scope="col" className="pb-3 text-right">Net tax</th></tr></thead><tbody className="divide-y divide-zinc-100">{state.summary.by_jurisdiction.map((item, index) => <tr key={`${item.country}-${item.state}-${item.jurisdiction}-${index}`}><th scope="row" className="py-3 pr-4 font-medium text-zinc-800">{[item.country, item.state, item.jurisdiction].filter(Boolean).join(" · ") || "Unspecified"}</th><td className="py-3 pr-4 text-right">{money(item.sale_tax_cents)}</td><td className="py-3 pr-4 text-right">{money(item.refunded_tax_cents)}</td><td className="py-3 text-right font-semibold">{money(item.net_tax_cents)}</td></tr>)}</tbody></table></div>
      </>}
    </Panel>
    {(state.summary.reconciliation_required_count ?? 0) > 0 && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">{state.summary.reconciliation_required_count} refunded invoice(s) need tax reconciliation in Reylumi. Stripe may already have adjusted tax in its reports for a direct refund. This cash ledger awaits a linked credit note and successful refund evidence. Review the invoice, refund and credit note in Stripe; this notice does not mean Stripe’s tax adjustment is missing.</p>}
    <Panel title="Invoice & refund history" description={`${state.row_count ?? state.ledger.length} cash tax entries in the selected period. Local refund adjustments appear after the linked credit note and successful refund are matched.`}>
      {state.truncated && <p className="mb-4 rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">Showing the latest {state.ledger.length} entries. The CSV export contains the complete selected period, up to 25,000 entries. Narrow the dates for larger reports.</p>}
      {state.ledger.length === 0 ? <p className="text-sm text-zinc-500">No paid invoice or refund tax has been recorded yet.</p> : <>
        <ul className="divide-y divide-zinc-100">{state.ledger.slice(page * pageSize, (page + 1) * pageSize).map(item => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0"><div className="min-w-0"><p className="text-sm font-semibold text-zinc-950">{item.kind === "sale" ? "Paid invoice" : "Refund adjustment"} <span className="ml-2 text-xs font-normal text-zinc-500">{date(item.occurred_at)}</span></p><p className="mt-1 break-all text-xs text-zinc-600">{item.invoice_id}</p><p className="mt-1 text-xs text-zinc-500">{[item.country, item.state, item.jurisdiction].filter(Boolean).join(" · ") || "Jurisdiction not reported"}</p></div><p className={`shrink-0 text-sm font-semibold ${item.kind === "refund" ? "text-amber-800" : "text-zinc-950"}`}>{money(item.tax_cents)}</p></li>)}</ul>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-200 pt-4"><button type="button" className={`${secondary} disabled:opacity-40`} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><p className="text-xs text-zinc-500">Page {page + 1} of {pages}</p><button type="button" className={`${secondary} disabled:opacity-40`} disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>Next</button></div>
      </>}
    </Panel>
  </div>;
}

export function MarketTaxWorkspace({ state, initialTab = "setup" }: { state: MarketTaxAdminState; initialTab?: "setup" | "ledger" }) {
  const [tab, setTab] = useState<"setup" | "ledger">(initialTab);
  const codes = state.tax_codes?.length ? state.tax_codes : supportedCodes;
  return <div className="min-w-0 space-y-5">
    <div className={`rounded-xl border px-4 py-4 sm:px-5 ${state.settings.enabled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><p className={`text-sm font-semibold ${state.settings.enabled ? "text-emerald-900" : "text-amber-900"}`}>{state.settings.enabled ? "Automatic tax collection is on" : "Automatic tax collection is off"}</p><p className="mt-1 text-sm leading-6 text-zinc-700">{state.settings.enabled ? "New purchases use your saved classification and active Stripe registrations. Existing invoices keep their original tax calculation." : "Prepare the configuration below. No automatic tax is collected until you complete setup and enable it."}</p></div>
    <div role="tablist" aria-label="Automatic tax workspace" className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">{([["setup", "Setup & readiness"], ["ledger", "Tax ledger"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" id={`tax-tab-${value}`} aria-selected={tab === value} aria-controls={`tax-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "setup" : event.key === "End" ? "ledger" : tab === "setup" ? "ledger" : "setup";
      setTab(next); document.getElementById(`tax-tab-${next}`)?.focus();
    }} className={`min-h-10 flex-1 rounded-lg px-3 py-2 text-sm font-semibold sm:flex-none sm:px-5 ${tab === value ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}>{label}</button>)}</div>
    <div role="tabpanel" id={`tax-panel-${tab}`} aria-labelledby={`tax-tab-${tab}`}>
      {tab === "setup" ? <div className="space-y-5"><div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"><TaxConfiguration state={state} codes={codes} /><ProviderReadiness state={state} /></div><Panel title="Per-plugin classifications" description="Leave an override empty to use the default. Choose a code that describes the delivered product; taxability can vary by state and delivery method.">{state.products.length ? state.products.map(product => <ProductClassification key={product.plugin_id} product={product} codes={codes} defaultCode={state.settings.default_tax_code} />) : <p className="text-sm text-zinc-500">No Market plugins are available for classification yet.</p>}</Panel><RegistrationSetup state={state} /></div> : <TaxLedger state={state} />}
    </div>
  </div>;
}
