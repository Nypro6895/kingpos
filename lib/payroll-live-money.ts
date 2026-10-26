/** Financial totals are accumulated in integer cents, never rounded display strings. */
export function moneyCents(value: number | string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid financial amount.");
  const cents = Math.round((number + Math.sign(number) * Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("Financial amount is out of range.");
  return cents;
}

export function sumMoney<T>(rows: readonly T[], get: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + moneyCents(get(row)), 0) / 100;
}

/** Allocate a fixed period amount without losing/creating cents across days. */
export function fixedDayPay(amount: number, days: number, index: number): number {
  if (!Number.isInteger(days) || days < 1 || index < 0 || index >= days) throw new Error("Invalid payroll days.");
  const cents = moneyCents(amount), sign = Math.sign(cents), absolute = Math.abs(cents);
  return sign * (Math.floor(absolute / days) + (index < absolute % days ? 1 : 0)) / 100;
}
