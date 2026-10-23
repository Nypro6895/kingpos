"use client";
import {openMarketPayment} from "@/lib/open-market-payment";
import { useState } from "react";
import Link from "next/link";
import { taxCompanyPaymentAction } from "./tax-company-actions";
export function TaxCompanyMarketPanel({ state, bankCheckout, paymentsAvailable }: { state: { active: boolean; subscribed: boolean }; bankCheckout: boolean; paymentsAvailable: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <section className="grid gap-3 border-t pt-4"><p>{state.active ? "Tax Company is active for this salon." : "Activate Tax Company · $7.90 / month per salon."}</p>{error && <p role="alert">{error}</p>}{(!bankCheckout || state.subscribed) && <button disabled={busy || (!state.subscribed && (!paymentsAvailable || state.active))} className="rounded-lg bg-zinc-950 p-3 text-white disabled:opacity-40" onClick={async () => { setBusy(true); setError(""); try { const result = await taxCompanyPaymentAction(state.subscribed); if (result.error) setError(result.error); else if (result.url) openMarketPayment(result.url); } catch { setError("Checkout could not open."); } finally { setBusy(false); } }}>{busy ? "Opening…" : state.subscribed ? "Manage subscription" : "Subscribe · $7.90 / month"}</button>}<Link href="/payroll/tax-company/settings" className="underline">Tax Plugin settings →</Link><Link href="/tax-company/install" className="underline">Download / install Tax Company app →</Link></section>;
}
