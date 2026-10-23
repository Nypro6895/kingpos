import type { Booking } from "@/types/booking";
export function BookingDepositReceipt({ booking }: { booking: Pick<Booking, "deposit_paid_cents" | "deposit_refunded_cents" | "deposit_receipt_url"> & { deposit_policy_snapshot?: Record<string, unknown> } }) {
  if (booking.deposit_policy_snapshot?.test === true) return <section className="grid gap-2 rounded-xl border border-zinc-200 p-4" aria-label="Test booking receipt"><h3 className="text-sm font-semibold">Test checkout · No money charged</h3><p className="text-sm">Test amount ${(Number(booking.deposit_policy_snapshot.amount_cents ?? 0) / 100).toFixed(2)} USD. This is a test record, not a paid deposit.</p></section>;
  if (!booking.deposit_paid_cents) return null;
  const refunded = booking.deposit_refunded_cents ?? 0;
  const receipt = booking.deposit_receipt_url;
  let safeUrl: string | null = null;
  try { if (receipt && new URL(receipt).protocol === "https:" && new URL(receipt).hostname === "pay.stripe.com") safeUrl = receipt; } catch { /* Ignore malformed receipt links. */ }
  return <section className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-4" aria-label="Booking payment receipt"><h3 className="text-sm font-semibold">Booking payment · {refunded >= booking.deposit_paid_cents ? "Refunded" : "Paid"}</h3><p className="text-sm">Paid ${(booking.deposit_paid_cents / 100).toFixed(2)} USD via Stripe</p>{refunded > 0 ? <p className="text-sm">Refunded ${(refunded / 100).toFixed(2)} · Net paid ${((booking.deposit_paid_cents - refunded) / 100).toFixed(2)}</p> : null}{safeUrl ? <a className="text-sm underline" href={safeUrl} target="_blank" rel="noopener noreferrer">View payment receipt</a> : null}</section>;
}
