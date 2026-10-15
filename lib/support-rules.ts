export const SUPPORT_EMAIL = "support@reylumi.com";
export const SUPPORT_STATUSES = ["new", "in_progress", "resolved", "spam"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = { new: "New", in_progress: "In progress", resolved: "Resolved", spam: "Spam" };

export function supportText(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const text = value.trim();
  if (text.length > max || /\u0000/.test(text)) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

export function supportEmail(value: unknown) {
  const email = supportText(value, "Email", 254).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /[\r\n]/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

export function supportUuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid request. Reload this page and try again.");
  return value;
}

export function validateSupportContact(input: { name?: unknown; email?: unknown; message?: unknown; requestId?: unknown }) {
  return { name: supportText(input.name, "Name", 120), email: supportEmail(input.email), message: supportText(input.message, "Message", 5000), requestId: supportUuid(input.requestId) };
}

export function supportMailto(email: string, reference: string) {
  return `mailto:${encodeURIComponent(supportEmail(email))}?subject=${encodeURIComponent(`Reylumi support · ${reference}`)}`;
}

export function escapeSupportHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}
