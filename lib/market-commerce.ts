// Money is stored in cents; rates are basis points (100 = 1%).
export const MARKET_PRICE_DEFAULTS: Record<string, number> = {
  "tax-company": 790,
  "vietnamese-language": 399, "booking-policy": 99,
  "booking-deposit": 590, "checkin-receipt": 470,
};
export function marketQuote(baseCents: number, taxBps: number, feeBps: number, fixedFeeCents: number) {
  for (const amount of [baseCents, fixedFeeCents]) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000) throw new Error("Invalid amount.");
  }
  for (const rate of [taxBps, feeBps]) {
    if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw new Error("Rate must be between 0 and 100%.");
  }
  const taxCents = Math.round(baseCents * taxBps / 10000);
  const feeCents = Math.round((baseCents + taxCents) * feeBps / 10000) + fixedFeeCents;
  return { baseCents, taxCents, feeCents, totalCents: baseCents + taxCents + feeCents };
}
export function decimalUnits(value: FormDataEntryValue | null, label: string) {
  if (typeof value !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(value.trim())) throw new Error(`${label}: enter a non-negative number with up to two decimal places.`);
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
