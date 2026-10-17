import { NAIL_FACETS, NAIL_LOOKS, type NailFilters, type NailLook } from "@/lib/nail-inspiration-catalog";
import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreSearchInput, ExploreSearchResult } from "@/types/explore";

const aliases: Record<string, string> = {
  polkadot: "polka-dot", animalprint: "animal-print", bambi: "fawn", deer: "fawn", tortoise: "tortoiseshell", dots: "polka-dot",
  stilitle: "stiletto", stilleto: "stiletto", stiletos: "stiletto", stilettos: "stiletto", stilletto: "stiletto", stileto: "stiletto",
  autumn: "fall", christmas: "holiday", xmas: "holiday", festive: "holiday", wedding: "bridal", bride: "bridal",
  lavender: "purple", lilac: "purple", ruby: "red", scarlet: "red", cherry: "red", bordeaux: "burgundy", wine: "burgundy", cocoa: "brown", chocolate: "brown", emerald: "green", sage: "green", mint: "green", cobalt: "blue", navy: "blue",
  nude: "nude", natural: "sheer", flower: "floral", flowers: "floral", pearl: "glazed", glazed: "glazed", shiny: "glossy", sparkle: "glitter", sparkling: "glitter", shimmer: "glitter", ballerina: "coffin", coffin: "coffin",
  do: "red", hong: "pink", tim: "purple", vang: "yellow", trang: "white", den: "black", nau: "brown", cam: "orange", ngan: "short", dai: "long", vuong: "square", nhon: "stiletto",
};
const neutral = new Set(["nail", "nails", "manicure", "manicures", "design", "designs", "idea", "ideas", "look", "looks", "photo", "photos", "picture", "pictures", "inspiration", "inspirations", "art", "color", "colors", "colour", "colours", "tone", "shape", "shapes", "length", "season", "seasonal", "finish", "and", "with", "for", "the", "a", "of", "style", "styles", "mau", "mong", "hinh", "anh", "kieu"]);
const descriptors = new Set<string>([...Object.values(NAIL_FACETS).flatMap(values => [...values]), ...NAIL_LOOKS.flatMap(look => nailQueryTerms([look.title, ...(look.keywords ?? [])].join(" ")))]);
export function nailQueryTerms(query: string): string[] {
  return query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d")
    .replace(/cat[ -]?eye/g, "cateye").replace(/french\s+tips?/g, "french").replace(/rose\s+gold/g, "gold")
    .replace(/\bpolka[ -]?dots?\b/g, "polkadot").replace(/\banimal[ -]?prints?\b/g, "animalprint").replace(/\btortoise[ -]?shell\b/g, "tortoiseshell")
    .replace(/springtime/g, "spring").replace(/summer(time)?/g, "summer")
    .split(/[^a-z0-9]+/).filter(Boolean).filter(term => !neutral.has(term))
    .map(term => term === "cateye" ? "cat-eye" : aliases[term] ?? term);
}
/** Used only as a routing hint; the server still gives a verified exact salon name priority. */
export function isNailStyleQuery(query: string) {
  const terms = nailQueryTerms(query);
  return terms.length > 0 && terms.every(term => descriptors.has(term));
}
export function supportsNailInspiration(category?: string) {
  return !category || /^(all|nails?|manicure|gel|acrylic|nail art)$/i.test(category.trim());
}
export function matchesNailLook(look: NailLook, query = "", filters: NailFilters = {}) {
  if (filters.shape && (aliases[look.shape] ?? look.shape) !== (aliases[filters.shape] ?? filters.shape)) return false;
  if (filters.length && look.length !== filters.length) return false;
  if (filters.color && !look.colors.includes(filters.color)) return false;
  if (filters.finish && look.finish !== filters.finish) return false;
  if (filters.tone && !look.tones.includes(filters.tone)) return false;
  if (filters.season && !look.seasons.includes(filters.season) && !(look.seasons.includes("all") && ["spring", "summer", "fall", "winter"].includes(filters.season))) return false;
  const tags = new Set([...nailQueryTerms([look.title, look.finish, ...(look.keywords ?? [])].join(" ")), look.shape, aliases[look.shape] ?? look.shape, look.length, look.finish, ...look.colors, ...look.tones, ...look.seasons]);
  return nailQueryTerms(query).every(term => tags.has(term) || look.seasons.includes("all") && ["spring", "summer", "fall", "winter"].includes(term));
}
function score(seed: string, id: string) {
  let result = 2166136261;
  for (const char of seed + ":" + id) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
/** Rotation is stable while browsing and independent of location; no repeats within an album. */
export function selectNailLooks(query = "", filters: NailFilters = {}, seed = "reylumi") {
  return NAIL_LOOKS.filter(look => matchesNailLook(look, query, filters)).sort((a, b) => score(seed, a.id) - score(seed, b.id));
}
/** A reference belongs to this result presentation, never proof of the salon's work. */
export const NAIL_SUGGESTION_CATALOG_VERSION = "2026-10-16-v1";
export function selectNailLookForSalon(salonId: string, query = "", filters: NailFilters = {}): NailLook | null {
  const normalizedQuery = nailQueryTerms(query).sort().join(" ");
  return selectNailLooks(query, filters, `${NAIL_SUGGESTION_CATALOG_VERSION}:salon:${salonId}:${normalizedQuery}`)[0] ?? null;
}
export function nailSalonSearchInput(discovery: ExploreFeedDiscoveryOptions): ExploreSearchInput {
  return { target: "salons", query: "", category: "Nails", location: discovery.location ?? "",
    locationSource: discovery.strictLocation ? "manual" : discovery.latitude != null && discovery.longitude != null ? "gps" : "activity",
    latitude: discovery.latitude, longitude: discovery.longitude, scopePolicy: discovery.strictLocation ? "fixed" : "expandable",
    sort: "closest", pageSize: 24, page: 1 };
}
/** Preserve nearby intent so an absent area is resolved through GPS or area selection. */
export function nailSalonSearchHref(location = "") {
  return `/explore?${new URLSearchParams({ type: "salons", category: "Nails", sort: "closest",
    ...(location ? { location, locationSource: "manual" } : { q: "nails near me" }) })}`;
}
export function nailSalonEligible(salon: ExploreSearchResult, discovery: ExploreFeedDiscoveryOptions) {
  return /^[0-9a-f-]{36}$/i.test(salon.id) && !salon.id.startsWith("showcase-") &&
    (!discovery.bookableOnly || salon.bookingEnabled && Boolean(salon.bookingHref)) &&
    (discovery.maxPrice == null || salon.startingPrice != null && salon.startingPrice <= discovery.maxPrice) &&
    (!discovery.newOnly || salon.isNew);
}
export function nailSalonHref(salon: Pick<ExploreSearchResult, "id">) { return `/explore/salons/${encodeURIComponent(salon.id)}`; }
export function nailPhoneHref(phone: string | null) { const number = phone?.replace(/[^\d+]/g, ""); return number && /\d{7}/.test(number) ? `tel:${number}` : null; }
