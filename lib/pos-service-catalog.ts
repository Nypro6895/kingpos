export const SERVICE_CATEGORY_PALETTE = ["#ea8a46", "#3b9e93", "#9973c2", "#5792cf", "#d47799", "#b49b3c"];

export function serviceCategoryColor(category: string, colors: Record<string, string> = {}) {
  if (/^#[0-9a-f]{6}$/i.test(colors[category] ?? "")) return colors[category];
  const hash = Array.from(category).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return SERVICE_CATEGORY_PALETTE[hash % SERVICE_CATEGORY_PALETTE.length];
}

export function serviceDefaultAmount(price: unknown) {
  const amount = Number(price);
  return Number.isFinite(amount) && amount > 0 ? String(Math.round(amount * 100) / 100) : "";
}
