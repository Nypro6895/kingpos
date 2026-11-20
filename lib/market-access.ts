export const MARKET_TRIAL_PLUGINS = ["booking-policy", "booking-deposit", "checkin-receipt", "tax-company", "booksms", "print-check"] as const;

export function marketPaidActive(row: { paid_until?: string | null } | null | undefined, now = Date.now()) {
  return Boolean(row?.paid_until && Date.parse(row.paid_until) > now);
}

export function marketAccessActive(row: { paid_until?: string | null; trial_ends_at?: string | null } | null | undefined, now = Date.now()) {
  return [row?.paid_until, row?.trial_ends_at].some(until => Boolean(until && Date.parse(until) > now));
}
