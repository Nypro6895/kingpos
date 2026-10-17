/** Money is allocated in integer cents; daily rounding must preserve the period total. */
export function payrollCents(value: number | string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 9_999_999_999.99) {
    throw new Error("Enter a valid payroll amount.");
  }
  return Math.round((number + Math.sign(number) * Number.EPSILON) * 100);
}

export function allocatePayrollCents(total: number, count: number): number[] {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(count) || count < 1 || count > 3660) {
    throw new Error("Invalid payroll allocation.");
  }
  const sign = Math.sign(total), absolute = Math.abs(total);
  const base = Math.floor(absolute / count), remainder = absolute % count;
  return Array.from({ length: count }, (_, index) => sign * (base + (index < remainder ? 1 : 0)));
}

export function fixedPayrollDayAmount(amount: number, days: number, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= days) throw new Error("Invalid payroll day.");
  return allocatePayrollCents(payrollCents(amount), days)[index] / 100;
}

export function parsePayrollMoney(value: string): number {
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(value.trim())) throw new Error("Use an amount with at most two decimal places.");
  return payrollCents(value.trim()) / 100;
}
