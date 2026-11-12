"use client";
import { TaxAccessLink } from "@/app/tax/tax-access-link";
import { useMarketTargetSalon } from "./scoped-market-client";
import { marketTargetHref } from "@/lib/market-target-url";
import { useScopedMarketActions } from "./scoped-market-client";
import { openMarketPayment } from "@/lib/open-market-payment";
import { useState } from "react";
import Link from "next/link";

export function TaxCompanyMarketPanel({
  state,
  bankCheckout,
  paymentsAvailable,
}: {
  state: { active: boolean; subscribed: boolean };
  bankCheckout: boolean;
  paymentsAvailable: boolean;
}) {
  const salonId = useMarketTargetSalon();
  const { taxCompanyPaymentAction } = useScopedMarketActions();

  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="grid gap-3 border-t pt-4">
      <p>
        {state.active
          ? "Tax Company is active for this salon."
          : "Activate Tax Company · $7.90 / month per salon."}
      </p>
      {error && <p role="alert">{error}</p>}
      {(!bankCheckout || state.subscribed) && (
        <button
          disabled={
            busy || (!state.subscribed && (!paymentsAvailable || state.active))
          }
          className="rounded-lg bg-zinc-950 p-3 text-white disabled:opacity-40"
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await taxCompanyPaymentAction(state.subscribed);
              if (result.error) setError(result.error);
              else if (result.url) openMarketPayment(result.url);
            } catch {
              setError("Checkout could not open.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Opening…"
            : state.subscribed
              ? "Manage subscription"
              : "Subscribe · $7.90 / month"}
        </button>
      )}
      <Link
        href={
          marketTargetHref(state.active ? "/payroll/tax-company/settings?setup=1" : "/payroll/tax-company/settings", salonId)
        }
        className="rounded-lg border p-3 font-semibold"
      >
        {state.active
          ? "Next: set up salon ID & password →"
          : "Tax plugin settings →"}
      </Link>
      <Link href="/tax-company/install" className="underline">
        Download / install Tax Company app →
      </Link>
      <TaxAccessLink />
    </section>
  );
}
