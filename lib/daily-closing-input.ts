export type ClosingFormValues = { cashAmount: string; creditCardAmount: string; otherAmount: string; note: string };
export type ClosingMoneyField = Exclude<keyof ClosingFormValues, "note">;

export function parseClosingCents(input: string): number | null {
  let text = input.trim().replace(/^\$\s*/, "");
  if (!text) return 0;
  if (text.includes(",")) {
    if (/^\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(text)) text = text.replaceAll(",", "");
    else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".");
    else return null;
  }
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 999_999_999_999 ? cents : null;
}

export function normalizeClosingMoney(input: string): string {
  const cents = parseClosingCents(input);
  return cents === null ? input : cents === 0 ? "" : (cents / 100).toFixed(2);
}

export function closingValues(input: {cashAmount: number; creditCardAmount: number; otherAmount: number; note: string | null}): ClosingFormValues {
  const format = (value: number) => value === 0 ? "" : value.toFixed(2);
  return {cashAmount: format(input.cashAmount), creditCardAmount: format(input.creditCardAmount), otherAmount: format(input.otherAmount), note: input.note ?? ""};
}

export function closingPayload(values: ClosingFormValues) {
  const cash = parseClosingCents(values.cashAmount), card = parseClosingCents(values.creditCardAmount), other = parseClosingCents(values.otherAmount);
  if (cash === null || card === null || other === null) throw new Error("Enter an amount of 0 or more, with up to 2 decimal places.");
  return {cashAmount: cash / 100, creditCardAmount: card / 100, otherAmount: other / 100, note: values.note.trim() || null};
}

export function closingSnapshot(values: ClosingFormValues) {
  try { return JSON.stringify(closingPayload(values)); }
  catch { return JSON.stringify(values); }
}
