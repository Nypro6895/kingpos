import type { ExploreFeedItem } from "@/types/explore";

export type ExploreFeedDiscoveryOptions = {
  category?: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  strictLocation?: boolean;
};

export function normalizeExploreFeedDiscoveryOptions(value: unknown): ExploreFeedDiscoveryOptions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const options = value as ExploreFeedDiscoveryOptions;
  const coordinate = (number: unknown, max: number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= max ? number : null;
  return {
    category: typeof options.category === "string" ? options.category.trim().slice(0, 80) : "",
    location: typeof options.location === "string" ? options.location.trim().slice(0, 160) : "",
    latitude: coordinate(options.latitude, 90),
    longitude: coordinate(options.longitude, 180),
    strictLocation: options.strictLocation === true,
  };
}

export function matchesExploreFeedItem(item: ExploreFeedItem, options?: ExploreFeedDiscoveryOptions) {
  const category = options?.category?.trim().toLowerCase();
  if (category && category !== "all") {
    const text = [item.serviceCategory, item.serviceName,
      ...(item.discoverySalon?.serviceCategories ?? []),
      ...(item.discoverySalon?.serviceNames ?? [])].filter(Boolean).join(" ").toLowerCase();
    if (!text.includes(category)) return false;
  }
  if (options?.strictLocation && options.location?.trim()) {
    // Directory results have already been filtered by the public search query.
    if (item.discoverySalon) return true;
    const parts = options.location.toLowerCase().split(",").map(part => part.trim()).filter(Boolean);
    const location = [item.salon?.city, item.salon?.state].filter(Boolean).join(", ").toLowerCase();
    if (!parts.every(part => location.includes(part))) return false;
  }
  return true;
}

export function discoveryItemIdentity(item: ExploreFeedItem) {
  // A recommendation that previews a post and that same organic post share a target.
  return item.destination.type !== "salon-profile" && item.destination.href
    ? item.destination.href
    : item.feedKey;
}
