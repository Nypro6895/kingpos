// Pure shared normalization. Scores express string similarity, not identity probability.
export function customerPhoneKey(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}
export function customerNameKey(value: string | null | undefined) {
  return (value ?? "").normalize("NFC").trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
export function customerNameSimilarity(a: string, b: string) {
  const x = customerNameKey(a).slice(0, 100), y = customerNameKey(b).slice(0, 100);
  if (!x || !y) return 0;
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    previous = row;
  }
  return 1 - previous[y.length] / Math.max(x.length, y.length);
}
