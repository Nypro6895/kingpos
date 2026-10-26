import { isDefaultNailImage } from "@/lib/default-nail-images";
import { exploreEditorialReferences, exploreServiceGuides } from "@/lib/explore-editorial";
import type { ExploreDiscoveryShortcut, ExploreFeedItem } from "@/types/explore";

/** A preview is one sentence; the original caption stays on the opened post. */
export function exploreCaptionExcerpt(caption: string | null | undefined, fallback = "Explore this post.") {
  const text = (caption ?? "").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
  const sentence = text.split(/(?<=[.!?])\s+/u)[0] || fallback;
  if (sentence.length <= 160) return sentence;
  const clipped = sentence.slice(0, 157).replace(/\s+\S*$/, "");
  return `${clipped}…`;
}

export type ExploreVisualPreview = { imageUrl: string; label: string; illustration: boolean };
export function exploreShortcutPreviews(shortcut: ExploreDiscoveryShortcut, items: ExploreFeedItem[], category: string, location: string): ExploreVisualPreview[] {
  const previews: ExploreVisualPreview[] = [];
  const add = (imageUrl: string | null | undefined, label: string, illustration = false) => {
    if (!imageUrl?.trim() || previews.some(preview => preview.imageUrl === imageUrl)) return;
    previews.push({ imageUrl, label, illustration: illustration || isDefaultNailImage(imageUrl) });
  };
  for (const preview of shortcut.previews) add(preview.imageUrl, preview.alt || preview.label || shortcut.label);
  const scopedCategory = shortcut.action.type === "category" ? shortcut.action.category : category;
  for (const item of items) {
    if (scopedCategory && scopedCategory !== "All" && item.serviceCategory?.toLowerCase() !== scopedCategory.toLowerCase()) continue;
    for (const media of item.media) add(media.imageUrl, item.serviceName || item.salon?.name || item.author.name);
  }
  const references = scopedCategory === "All" || !scopedCategory
    ? exploreServiceGuides("All", location)
    : exploreEditorialReferences(scopedCategory, location, 3, previews.map(preview => preview.imageUrl));
  for (const reference of references) add(reference.imageUrl, reference.title, true);
  return previews.slice(0, 3);
}
