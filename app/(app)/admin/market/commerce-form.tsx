"use client";
import { useState } from "react";
import { decimalUnits, marketQuote, MARKET_PRICE_DEFAULTS } from "@/lib/market-commerce";
import { AdminActionForm } from "../_components/action-form";
import { saveCommerceConfiguration } from "./commerce-actions";

export type CommerceConfiguration = {
  version: number; bank_name: string; bank_beneficiary: string; bank_account: string;
  bank_routing: string; bank_instructions: string; tax_bps: number; fee_bps: number;
  fixed_fee_cents: number; plugin_prices: Record<string, number>;
};
const names: Record<string, string> = { "tax-company": "Tax Company", "vietnamese-language": "Vietnamese Language", "booking-policy": "Booking Rules", "booking-deposit": "Booking Deposit", "checkin-receipt": "Check-in Receipt" };
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
export function CommerceForm({ configuration: data }: { configuration: CommerceConfiguration }) {
  const [prices, setPrices] = useState(Object.fromEntries(Object.entries(MARKET_PRICE_DEFAULTS).map(([id, fallback]) => [id, String((data.plugin_prices[id] ?? fallback) / 100)])));
  const [tax, setTax] = useState(String(data.tax_bps / 100)), [fee, setFee] = useState(String(data.fee_bps / 100)), [fixed, setFixed] = useState(String(data.fixed_fee_cents / 100));
  const quotes = Object.keys(names).map(id => {
    try { return { id, quote: marketQuote(decimalUnits(prices[id], "Price"), decimalUnits(tax, "Tax"), decimalUnits(fee, "Fee"), decimalUnits(fixed, "Fixed fee")) }; }
    catch { return { id, quote: null }; }
  });
  const valid = quotes.every(row => row.quote);
  const hasBank = Boolean(data.bank_name && data.bank_beneficiary && data.bank_account);
  const inputClass = "mt-1 block w-full rounded-lg border border-zinc-300 bg-white p-3";
  return <AdminActionForm action={saveCommerceConfiguration} className="grid gap-6">
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><strong>Planning only · Bank checkout is not available</strong><p className="mt-2 text-sm">Saving this draft does not change published prices, charge customers or update existing subscriptions. Current purchases continue through Stripe.</p><p className="mt-2 text-sm">Bank details: {hasBank ? "Draft entered" : "Incomplete draft"} · Saved version {data.version}</p></div>
    <input type="hidden" name="version" value={data.version} />
    <fieldset className="grid gap-4"><legend className="mb-3 font-semibold">1. Receiving bank</legend><p className="text-sm text-zinc-600">Enter your business account for the future bank checkout. These details are visible only to authorized platform owners.</p>
      <div className="grid gap-4 sm:grid-cols-2">{([ ["bank_name", "Bank name"], ["bank_beneficiary", "Account holder / beneficiary"], ["bank_account", "Account number / IBAN"], ["bank_routing", "Routing number / SWIFT"] ] as const).map(([name, label]) => <label key={name}>{label}<input className={inputClass} name={name} defaultValue={data[name]} maxLength={name === "bank_name" || name === "bank_beneficiary" ? 160 : 100} autoComplete="off" spellCheck={false} /></label>)}</div>
      <label>Transfer instructions<textarea className={inputClass} name="bank_instructions" maxLength={2000} defaultValue={data.bank_instructions} rows={3} /><span className="text-sm text-zinc-500">Do not include passwords, access codes or online banking credentials.</span></label>
    </fieldset>
    <fieldset className="grid gap-4"><legend className="mb-3 font-semibold">2. Proposed monthly prices</legend><p className="text-sm text-zinc-600">USD per salon. The current price is shown alongside each draft. Payroll Data Download remains free; Campaigns uses credits.</p><div className="grid gap-4 sm:grid-cols-2">{Object.entries(MARKET_PRICE_DEFAULTS).map(([id, current]) => <label key={id}>{names[id]}<span className="ml-2 text-sm text-zinc-500">Current: {money(current)}</span><input className={inputClass} type="number" inputMode="decimal" min="0" max="1000000" step="0.01" required name={id} value={prices[id]} onChange={event=>setPrices({...prices,[id]:event.target.value})} /></label>)}</div></fieldset>
    <fieldset className="grid gap-4"><legend className="mb-3 font-semibold">3. Proposed tax and transaction fees</legend><div className="grid gap-4 sm:grid-cols-3">{([ ["tax", "Tax (%)", tax, setTax, 100], ["fee", "Transaction fee (%)", fee, setFee, 100], ["fixed", "Fixed fee (USD)", fixed, setFixed, 1000000] ] as const).map(([name, label, value, set, max]) => <label key={name}>{label}<input className={inputClass} type="number" inputMode="decimal" min="0" max={max} step="0.01" required name={name} value={value} onChange={event=>set(event.target.value)} /></label>)}</div><p className="text-sm text-zinc-600">Tax and percentage fee use the listed price. The fixed fee is added once per payment. This is a planning estimate; tax applicability must be established before activation.</p></fieldset>
    <div aria-live="polite"><h3 className="mb-3 font-semibold">Customer total preview · Draft</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Plugin</th><th className="p-2">Price</th><th className="p-2">Tax</th><th className="p-2">Fees</th><th className="p-2">Total / month</th></tr></thead><tbody>{quotes.map(({id,quote})=><tr key={id} className="border-t"><th className="p-2 font-normal">{names[id]}</th>{quote ? [quote.baseCents,quote.taxCents,quote.feeCents,quote.totalCents].map((value,index)=><td className={`whitespace-nowrap p-2 ${index===3?"font-semibold":""}`} key={index}>{money(value)}</td>) : <td className="p-2 text-red-700" colSpan={4}>Enter valid prices and rates to see the total.</td>}</tr>)}</tbody></table></div></div>
    <div><button disabled={!valid} className="rounded-lg bg-zinc-950 px-5 py-3 text-white disabled:opacity-50">Save draft configuration</button><p className="mt-2 text-sm text-zinc-500">All values are saved together. To see the latest saved draft after another admin edits it, refresh this page.</p></div>
  </AdminActionForm>;
}
