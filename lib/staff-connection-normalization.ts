import { normalizePhoneForIdentity } from "@/lib/phone-normalization";

export class StaffConnectionNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffConnectionNormalizationError";
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeStaffConnectionEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized) {
    return null;
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    throw new StaffConnectionNormalizationError("Enter a valid email address.");
  }

  return normalized;
}

export function normalizeStaffConnectionPhone(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  const normalized = normalizePhoneForIdentity(trimmed);

  if (!normalized) {
    throw new StaffConnectionNormalizationError("Enter a valid phone number.");
  }

  return normalized;
}

export function requireStaffConnectionContact(input: {
  email?: string | null;
  phone?: string | null;
}) {
  const email = normalizeStaffConnectionEmail(input.email);
  const phone = normalizeStaffConnectionPhone(input.phone);

  if (!email && !phone) {
    throw new StaffConnectionNormalizationError("Email or phone is required.");
  }

  return { email, phone };
}
