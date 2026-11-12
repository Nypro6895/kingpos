"use client";
import "./tax-workspace.css";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { openMarketPayment } from "@/lib/open-market-payment";
import { cardMoney } from "@/lib/market-card-rules";
import { CardCheckoutPanel } from "@/app/market/card-checkout-panel";
import { taxRenewalQuote, taxLegacyRenewal, refreshTaxRenewal } from "./flow-actions";
import { TaxActivationFollowup } from "./tax-activation-followup";

type Quote = Extract<Awaited<ReturnType<typeof taxRenewalQuote>>, { ok: true }>;
export function TaxRenewal({ salonId, active }: { salonId: string; active: boolean }) {
  const path = usePathname(), query = useSearchParams(), router = useRouter();
  const autoOpen = query.get("renew") === "1";
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(!active && autoOpen);
  const [loading, setLoading] = useState(!active && autoOpen);
  const [portalOpened, setPortalOpened] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (active || !autoOpen) return;
    let current = true;
    void taxRenewalQuote(salonId).then(result => {
      if (!current) return;
      if (result.ok) setQuote(result);
      else setError(result.error);
      setLoading(false);
    }).catch(() => {
      if (current) { setError("Pricing could not load. Try again."); setLoading(false); }
    });
    return () => { current = false; };
  }, [active, autoOpen, salonId]);
  useEffect(() => {
    if (!portalOpened) return;
    let current = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      void refreshTaxRenewal(salonId).then(result => {
        if (current && result.active && result.salonId === salonId) {
          router.replace(path + "?salon=" + salonId);
          router.refresh();
        }
      }).catch(() => { if (current) setError("Payment confirmation could not be checked. Try again; do not pay again."); });
    };
    window.addEventListener("focus", check);
    window.addEventListener("reylumi:foreground", check);
    return () => {
      current = false;
      window.removeEventListener("focus", check);
      window.removeEventListener("reylumi:foreground", check);
    };
  }, [portalOpened, salonId, path, router]);

  async function reviewPrice() {
    setOpen(true); setLoading(true); setError(""); setQuote(null);
    try {
      const result = await taxRenewalQuote(salonId);
      if (result.ok) setQuote(result);
      else setError(result.error);
    } catch { setError("Pricing could not load. Try again."); }
    finally { setLoading(false); }
  }
  async function openExistingBilling() {
    setLoading(true); setError("");
    try {
      const result = await taxLegacyRenewal(salonId, path);
      if (result.ok) { setPortalOpened(true); openMarketPayment(result.url); }
      else setError(result.error);
    } catch { setError("Billing could not open. Try again."); }
    finally { setLoading(false); }
  }
  if (active) return null;
  return <section className="tax-panel" aria-label="Tax access paused">
    <h2>Tax Company access is paused</h2>
    <p>Your records are preserved. Renew to let your tax professional continue working.</p>
    {query.get("activation") === "payment" && <TaxActivationFollowup active={false} salonId={salonId} returnPath={path} />}
    <button className="tax-primary" onClick={reviewPrice}>Review price & renew</button>
    <dialog ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} className="tax-renewal-dialog" aria-labelledby="tax-renewal-title">
      <h2 id="tax-renewal-title">Renew Tax Company</h2>
      <p>Access for this salon. Your existing documents and valid connections stay in place.</p>
      {loading && <p role="status">Loading current price…</p>}
      {error && <p role="alert">{error}</p>}
      {quote && !loading && quote.legacyPortal && <>
        <p><strong>{cardMoney(quote.billing.catalog[0].price_cents)} / month</strong></p>
        <p>Review the amount due for your existing subscription on the secure billing page.</p>
        <button onClick={openExistingBilling}>Continue to payment</button>
      </>}
      {quote && !loading && !quote.legacyPortal && <CardCheckoutPanel
        pluginId="tax-company" pluginName="Tax Company" billingState={quote.billing}
        hasActiveSubscription={false} ready automaticTax={quote.tax} onStateChange={() => {}}
        taxReturnPath={path} expectedSalonId={salonId} onMarketRefresh={() => router.refresh()} />}
      <button onClick={() => setOpen(false)}>Cancel</button>
    </dialog>
  </section>;
}
