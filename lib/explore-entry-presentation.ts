import { isDefaultBusinessImage } from "@/lib/default-nail-images";
import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreDiscoveryShortcut, ExploreHomeContent, ExploreSearchResult } from "@/types/explore";

export const EXPLORE_INTRO_MESSAGES = [
  { text: "Discover local beauty pros. See real work.", accent: "Book instantly." },
  { text: "Find a look you love.", accent: "Meet the pro behind it." },
  { text: "Real styles. Local talent.", accent: "Find your next favorite." },
  { text: "Your next beauty moment starts here.", accent: "Explore the possibilities." },
  { text: "From fresh ideas to your next appointment.", accent: "Make it yours." },
] as const;

export type ExplorePreviewImage = { salonId: string; salonName: string; imageUrl: string; illustration: boolean };

/** Use one image per business, regardless of claim status, and never repeat a shared logo. */
export function explorePreviewImages(content: ExploreHomeContent, salons: readonly ExploreSearchResult[], limit = 5): ExplorePreviewImage[] {
  const candidates = [
    ...content.inspiration.items.map(item => ({ salonId: item.salonId, salonName: item.salonName, imageUrl: item.imageUrl, priority: isDefaultBusinessImage(item.imageUrl) ? 2 : 0 })),
    ...[...salons, ...content.recommendedSalons, ...content.newSalons].flatMap(salon => [
      { salonId: salon.id, salonName: salon.name, imageUrl: salon.coverImageUrl, priority: isDefaultBusinessImage(salon.coverImageUrl) ? 2 : 0 },
      { salonId: salon.id, salonName: salon.name, imageUrl: salon.logoImageUrl, priority: 1 },
    ]),
  ].sort((a, b) => a.priority - b.priority);
  const ids = new Set<string>(), images = new Set<string>();
  const result: ExplorePreviewImage[] = [];
  for (const candidate of candidates) {
    const imageUrl = candidate.imageUrl?.trim();
    if (!imageUrl || !candidate.salonId || ids.has(candidate.salonId) || images.has(imageUrl)) continue;
    ids.add(candidate.salonId); images.add(imageUrl);
    result.push({ salonId: candidate.salonId, salonName: candidate.salonName, imageUrl, illustration: isDefaultBusinessImage(imageUrl) });
    if (result.length >= limit) break;
  }
  return result;
}

/** These are full discovery entry points; availability of the small home preview is not a gate. */
export function exploreAlternatingShortcuts(shortcuts: readonly ExploreDiscoveryShortcut[]): ExploreDiscoveryShortcut[] {
  return (["trending", "recommended"] as const).map(id => {
    const current = shortcuts.find(shortcut => shortcut.id === id);
    const fresh = id === "trending";
    return {
      id, moduleKind: fresh ? "visual" : "recommended",
      action: { type: "result", resultKind: id },
      label: fresh ? "Fresh looks" : "Recommended for you",
      actionLabel: fresh ? "Explore looks" : "Explore recommendations",
      context: fresh ? "Recent public photos and styles" : "Places and public work to explore",
      detail: null,
      previews: current?.previews ?? [],
    };
  });
}

/** After four organic items, then every four more: Fresh, Recommended, Fresh, … */
export function exploreShortcutIndex(completedItems: number): number | null {
  return completedItems >= 4 && completedItems % 4 === 0 ? (completedItems / 4 - 1) % 2 : null;
}

export function exploreShortcutDiscovery(input: {
  kind: "trending" | "recommended";
  category: string;
  location: string;
  strictLocation: boolean;
  coordinates: { latitude: number; longitude: number } | null;
}): ExploreFeedDiscoveryOptions {
  return {
    intent: input.kind === "trending" ? "latest" : "discover",
    category: input.category === "All" ? "" : input.category,
    location: input.location,
    strictLocation: input.strictLocation,
    latitude: input.coordinates?.latitude ?? null,
    longitude: input.coordinates?.longitude ?? null,
  };
}
