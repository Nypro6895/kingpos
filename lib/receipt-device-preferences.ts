import type { ReceiptDevicePreferences } from "@/types/receipt-print";

export const RECEIPT_PREFERENCES_CHANGED = "reylumi:receipt-preferences-changed";
export const DEFAULT_RECEIPT_PREFERENCES: ReceiptDevicePreferences = Object.freeze({
  version: 1, paper: "80mm", showLogo: true, showPhone: true, showAddress: true, customFooter: "", printer: "system",
});
export function normalizeReceiptPreferences(value: unknown): ReceiptDevicePreferences {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { version: 1, paper: v.paper === "58mm" || v.paper === "a4" ? v.paper : "80mm",
    showLogo: v.showLogo !== false, showPhone: v.showPhone !== false, showAddress: v.showAddress !== false,
    customFooter: typeof v.customFooter === "string" ? v.customFooter.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 240) : "", printer: "system" };
}
function key(scope: string) {
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(scope)) throw new Error("Open a salon workspace before setting up receipts.");
  return "kingpos:receipt-settings:v1:" + scope;
}
/** Layout preferences only, separate from receipt/outbox durability or authority. */
export function readReceiptPreferences(scope: string): ReceiptDevicePreferences {
  const raw = localStorage.getItem(key(scope));
  if (!raw) return { ...DEFAULT_RECEIPT_PREFERENCES };
  try { return normalizeReceiptPreferences(JSON.parse(raw)); } catch { return { ...DEFAULT_RECEIPT_PREFERENCES }; }
}
export function saveReceiptPreferences(scope: string, value: ReceiptDevicePreferences) {
  localStorage.setItem(key(scope), JSON.stringify(normalizeReceiptPreferences(value)));
  window.dispatchEvent(new CustomEvent(RECEIPT_PREFERENCES_CHANGED, { detail: { scope } }));
}
