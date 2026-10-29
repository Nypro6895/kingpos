import {
  DEFAULT_STUBS,
  STUB_FIELDS,
  type StubOptions,
} from "@/types/check-writer";
export function checkText(
  value: unknown,
  max: number,
  multiline = false,
): string {
  if (multiline && typeof value === "string")
    value = value.replace(/\r\n/g, "\n");
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (multiline ? /[\x00-\x09\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value) ||
    /[\u202a-\u202e\u2066-\u2069]/.test(value)
  )
    throw Error("Invalid check text.");
  return value.trim();
}
export function checkCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,8}(\.\d{1,2})?$/.test(value))
    throw Error("Enter a positive amount with at most two decimals.");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 9999999999)
    throw Error("Check amount is out of range.");
  return cents;
}
export function payrollCents(value: number): number {
  return checkCents(value.toFixed(2));
}
export function validRouting(value: string) {
  if (!/^\d{9}$/.test(value) || /^0+$/.test(value)) return false;
  return (
    [...value].reduce(
      (sum, char, i) => sum + Number(char) * [3, 7, 1][i % 3],
      0,
    ) %
      10 ===
    0
  );
}
export function stubOptions(value: unknown): StubOptions {
  if (!value || typeof value !== "object")
    return structuredClone(DEFAULT_STUBS);
  const v = value as StubOptions;
  for (const fields of [v.payee, v.salon])
    if (
      !Array.isArray(fields) ||
      fields.length > 5 ||
      new Set(fields).size !== fields.length ||
      fields.some((f) => !STUB_FIELDS.includes(f))
    )
      throw Error("Invalid stub options.");
  if (typeof v.same !== "boolean") throw Error("Invalid stub options.");
  return {
    same: v.same,
    payee: [...v.payee],
    salon: [...(v.same ? v.payee : v.salon)],
  };
}
export function checkDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw Error("Invalid check date.");
  return value;
}
export function amountWords(cents: number): string {
  const small = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  function words(n: number): string {
    if (n < 20) return small[n];
    if (n < 100)
      return tens[Math.floor(n / 10)] + (n % 10 ? "-" + small[n % 10] : "");
    for (const [unit, label] of [
      [1000000, "Million"],
      [1000, "Thousand"],
      [100, "Hundred"],
    ] as const)
      if (n >= unit)
        return (
          words(Math.floor(n / unit)) +
          " " +
          label +
          (n % unit ? " " + words(n % unit) : "")
        );
    return "";
  }
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 9999999999)
    throw Error("Invalid check amount.");
  return (
    words(Math.floor(cents / 100)) +
    " and " +
    String(cents % 100).padStart(2, "0") +
    "/100 dollars"
  );
}
