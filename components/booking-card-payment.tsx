"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicBookingActionResult } from "@/lib/public-booking";
import { BookingPaymentStatus } from "./booking-payment-status";
export function BookingCardPayment({ payment }: { payment: NonNullable<PublicBookingActionResult["payment"]> }) {
  const mount = useRef<HTMLDivElement>(null), [complete, setComplete] = useState(!payment.clientSecret && !payment.testMode), [error, setError] = useState(""), [testing, setTesting] = useState(false);
  useEffect(() => {
    let active = true, checkout: { destroy: () => void } | undefined;
    async function initialize() {
      try {
        const key = process.env.NEXT_PUBLIC_BOOKING_STRIPE_PUBLISHABLE_KEY;
        if (payment.testMode || !key || !payment.clientSecret) return;
        const { loadStripe } = await import("@stripe/stripe-js/pure");
        if (!active || !mount.current) return;
        const stripe = await loadStripe(key, { stripeAccount: payment.account });
        if (!stripe || !active || !mount.current) return;
        const embedded = await stripe.createEmbeddedCheckoutPage({ clientSecret: payment.clientSecret, onComplete: () => { if (active) setComplete(true); } });
        checkout = embedded;
        if (!active || !mount.current) { embedded.destroy(); return; }
        embedded.mount(mount.current);
      } catch { if (active) setError("Card entry could not load. Please retry or contact the salon."); }
    }
    if (!complete) void initialize();
    return () => { active = false; checkout?.destroy(); };
  }, [payment.account, payment.clientSecret, payment.testMode, complete]);
  if (payment.testMode) return <section className="my-4 grid gap-4 rounded-xl border border-zinc-200 p-4"><h2 className="font-semibold">Test checkout — no money will be charged</h2><p>Test amount: ${(payment.amountCents / 100).toFixed(2)} USD · {payment.checkout === "embedded" ? "Card entry preview" : "Stripe checkout preview"}</p><p className="text-sm">No card details are needed. Continuing creates an appointment with a test payment record.</p>{error ? <p role="alert">{error}</p> : null}{complete ? <BookingPaymentStatus token={payment.token} /> : <button type="button" disabled={testing} className="rounded-lg bg-zinc-900 p-3 text-white" onClick={async () => { setTesting(true); setError(""); try { const response = await fetch("/api/booking-payment/test-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: payment.token }) }); const result = await response.json(); if (result.ok) setComplete(true); else setError(result.message ?? "Please retry."); } catch { setError("Test booking could not be submitted. Please retry."); } finally { setTesting(false); } }}>{testing ? "Submitting…" : "Complete test checkout & book"}</button>}</section>;
  return <div className="my-4 grid gap-3"><p className="text-sm">Pay ${(payment.amountCents / 100).toFixed(2)} USD to submit your appointment.</p>{error ? <p role="alert">{error}</p> : null}{complete ? <BookingPaymentStatus token={payment.token} /> : <div ref={mount} />}</div>;
}
