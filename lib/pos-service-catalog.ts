export const SERVICE_CATEGORY_PALETTE = ["#ea8a46", "#3b9e93", "#9973c2", "#5792cf", "#d47799", "#b49b3c"];

export type CatalogService = {
  id: string;
  name: string;
  category?: string | null;
  base_price?: number | string | null;
  requested?: boolean;
  booking_parent_service_id?: string | null;
};

export function serviceCatalogParent(services: CatalogService[], selectedId?: string | null) {
  const selected = services.find(service => service.id === selectedId);
  if (!selected) return null;
  if (!selected.booking_parent_service_id) return selected;
  return services.find(service => service.id === selected.booking_parent_service_id && !service.booking_parent_service_id) ?? null;
}

// Add-ons use the active main-service occurrence and its staff. Repeated clicks
// focus the existing extra within that occurrence instead of adding it twice.
export function findPosAddOnTarget<T extends { id: string; service_id: string | null; staff_id: string | null }>(
  services: CatalogService[], lines: T[], activeLineId: string | null, addOnId: string,
) {
  const activeIndex = lines.findIndex(line => line.id === activeLineId);
  const active = lines[activeIndex];
  const parent = active && serviceCatalogParent(services, active.service_id);
  const addOn = services.find(service => service.id === addOnId);
  if (!active?.staff_id || !parent || addOn?.booking_parent_service_id !== parent.id) return null;
  let parentIndex = activeIndex;
  while (parentIndex >= 0 && !(lines[parentIndex].service_id === parent.id && lines[parentIndex].staff_id === active.staff_id)) parentIndex--;
  if (parentIndex < 0) return null;
  let end = parentIndex + 1;
  while (end < lines.length) {
    const line = lines[end];
    const service = services.find(service => service.id === line.service_id);
    if (line.staff_id === active.staff_id && (!service || !service.booking_parent_service_id)) break;
    end++;
  }
  if (activeIndex >= end) return null;
  return { parentLine: lines[parentIndex], existing: lines.slice(parentIndex + 1, end).find(line => line.service_id === addOnId && line.staff_id === active.staff_id) ?? null, insertAt: end };
}

export function serviceCategoryColor(category: string, colors: Record<string, string> = {}) {
  if (/^#[0-9a-f]{6}$/i.test(colors[category] ?? "")) return colors[category];
  const hash = Array.from(category).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return SERVICE_CATEGORY_PALETTE[hash % SERVICE_CATEGORY_PALETTE.length];
}

export function serviceDefaultAmount(price: unknown) {
  const amount = Number(price);
  return Number.isFinite(amount) && amount > 0 ? String(Math.round(amount * 100) / 100) : "";
}
