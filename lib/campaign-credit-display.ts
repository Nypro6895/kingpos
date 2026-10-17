/** Storage keeps its original integer units. This denomination changes no balances or prices. */
export function displayCredits(units: number) { return Math.round(units * 12) / 100; }
export function formatCredits(units: number) { return displayCredits(units).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
export function creditUnits(value: number) {
  const units = Math.round(value * 100 / 12);
  if (!Number.isFinite(value) || !Number.isSafeInteger(units) || units < 0 || Math.abs(displayCredits(units) - value) > .000001) throw new Error("Choose a credit amount in steps of 0.12.");
  return units;
}
