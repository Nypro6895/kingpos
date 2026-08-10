const E164_MAX_DIGITS = 15;
const E164_MIN_DIGITS = 10;

export function phoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function normalizePhoneForIdentity(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  const digits = phoneDigits(trimmed);

  if (!digits) {
    return null;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (
    trimmed.startsWith("+") &&
    digits.length >= E164_MIN_DIGITS &&
    digits.length <= E164_MAX_DIGITS
  ) {
    return `+${digits}`;
  }

  if (digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS) {
    return `+${digits}`;
  }

  return null;
}
