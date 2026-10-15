"use client";
import { useEffect, useState } from "react";
import type { PublicBookingActionResult } from "@/lib/public-booking";
export function BookingPaymentStatus({ token, onResult }: { token: string; onResult?: (result: PublicBookingActionResult) => void }) {
  const [result, setResult] = useState<PublicBookingActionResult | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>, count = 0;
    async function poll() {
      try {
        const response = await fetch(`/api/booking-payment/status?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const next = await response.json() as PublicBookingActionResult;
        if (!active) return;
        setResult(next);
        if (next.ok) { onResult?.(next); return; }
        if (next.code === "refunded" || next.code === "expired") return;
      } catch { if (active) setResult({ ok: false, message: "Payment could not be checked. Please retry." }); }
      if (active && ++count < 30) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [token, attempt, onResult]);
  return <section aria-label="Payment receipt" className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-5">
    <h2 className="text-lg font-semibold">{result?.ok ? "Payment receipt" : "Confirming payment"}</h2><p role="status">{result?.message ?? "Checking your payment securely…"}</p>
    {result?.receipt ? <><strong>{result.receipt.testMode ? "Test amount — not charged" : "Paid"} ${(result.receipt.amountCents / 100).toFixed(2)} USD</strong>{result.receipt.refundedCents > 0 ? <p>Refunded ${(result.receipt.refundedCents / 100).toFixed(2)}</p> : null}{result.receipt.url ? <a className="underline" href={result.receipt.url} target="_blank" rel="noopener noreferrer">View Stripe receipt</a> : null}</> : null}
    {result?.payment?.url ? <a className="rounded-lg border p-3 text-center" href={result.payment.url}>Continue payment · ${(result.payment.amountCents / 100).toFixed(2)}</a> : null}
    {result?.ok ? <a className="underline" href={result.accountLinked ? `/my-bookings?details=${result.bookingId}` : `/booking/manage/${result.manageToken}`}>View appointment</a> : <button type="button" className="rounded-lg border p-3" onClick={() => setAttempt(value => value + 1)}>Check again</button>}
  </section>;
}
