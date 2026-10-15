import type { ExploreFeedItem } from "@/types/explore";

/** Content identity is independent of who owns the salon today. */
export function explorePostIdentity(input: {
  source: "salon" | "personal";
  salonName?: string | null;
  authorName?: string | null;
  authorRole?: "owner" | "staff" | "salon";
}) {
  const person = input.source === "personal" || input.authorRole === "staff";
  const primary = (person ? input.authorName : input.salonName)?.trim()
    || input.salonName?.trim() || "Reylumi customer";
  return { primary, taggedSalon: person && input.salonName && primary !== input.salonName ? input.salonName : null };
}

/** One content/media item per tile, with no salon-level deduplication. */
export function selectExploreEditorialPosts(items: ExploreFeedItem[], limit = 6) {
  const content = new Set<string>(), images = new Set<string>();
  return items.filter(item => {
    if (item.contentType === "salon_recommendation" || !item.media[0]?.imageUrl) return false;
    const key = `${item.contentType}:${item.contentId}`;
    if (content.has(key) || images.has(item.media[0].imageUrl)) return false;
    content.add(key); images.add(item.media[0].imageUrl);
    return true;
  }).slice(0, limit);
}
