import type { ExploreFeedItem } from "@/types/explore";

export type ExploreFeedDiscoveryOptions = {
  query?: string;
  intent?: "discover" | "latest";
  category?: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  strictLocation?: boolean;
  maxPrice?: number | null;
  bookableOnly?: boolean;
  newOnly?: boolean;
  trendingOnly?: boolean;
};

export function normalizeExploreFeedDiscoveryOptions(value: unknown): ExploreFeedDiscoveryOptions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const options = value as ExploreFeedDiscoveryOptions;
  const coordinate = (number: unknown, max: number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= max ? number : null;
  const query = typeof options.query === "string" ? options.query.trim().replace(/\s+/g, " ").slice(0, 240) : "";
  return {
    // Preserve existing non-keyword session signatures across this rollout.
    ...(query ? { query } : {}),
    intent: options.intent === "latest" ? "latest" : "discover",
    category: typeof options.category === "string" ? options.category.trim().slice(0, 80) : "",
    location: typeof options.location === "string" ? options.location.trim().slice(0, 160) : "",
    latitude: coordinate(options.latitude, 90),
    longitude: coordinate(options.longitude, 180),
    strictLocation: options.strictLocation === true,
    maxPrice: typeof options.maxPrice === "number" && Number.isFinite(options.maxPrice) && options.maxPrice >= 0 ? Math.min(options.maxPrice, 100000) : null,
    bookableOnly: options.bookableOnly === true,
    newOnly: options.newOnly === true,
    trendingOnly: options.trendingOnly === true,
  };
}

export function matchesExploreFeedItem(item: ExploreFeedItem, options?: ExploreFeedDiscoveryOptions) {
  // Actor-bound social sessions already apply structured region/category
  // predicates. Re-parsing display labels would reject ZIPs and state aliases.
  if (item.contentKey && item.discoveryScope) return true;
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
