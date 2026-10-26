import type { ExploreFeedItem, ExploreInspirationItem } from "@/types/explore";

export type ExploreCommentPresentation = { preview: boolean; composer: boolean };
export type ExploreCommentCandidate = {
  key: string;
  salonId?: string | null;
  publishedAt: string;
  comments: number;
  loves: number;
  introduction?: boolean;
  previewAllowed: boolean;
  composerAllowed: boolean;
};
export type ExploreCommentPlan = Record<string, ExploreCommentPresentation>;
export const COLLAPSED_COMMENTS: ExploreCommentPresentation = { preview: false, composer: false };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function feedCommentCandidate(item: ExploreFeedItem, options = { previewAllowed: true, composerAllowed: true }): ExploreCommentCandidate | null {
  if (item.contentType === "salon_recommendation" || !item.saveTarget || !uuid.test(item.saveTarget.sourceId)) return null;
  return { key: `${item.saveTarget.sourceType}:${item.saveTarget.sourceId}`, salonId: item.salon?.id, publishedAt: item.publishedAtKnown === false ? "" : item.publishedAt, comments: item.commentCount, loves: item.saveTarget.saveCount ?? 0, introduction: item.platformIntroduction, ...options };
}

export function lookCommentCandidate(item: ExploreInspirationItem, options = { previewAllowed: true, composerAllowed: true }): ExploreCommentCandidate | null {
  if (!uuid.test(item.contentId)) return null;
  return { key: `${item.contentType === "update" ? "salon_profile_update" : "salon_profile_look"}:${item.contentId}`, salonId: item.salonId, publishedAt: item.publishedAt, comments: item.commentCount ?? 0, loves: item.saveTarget.saveCount ?? 0, ...options };
}

// The first six home posts use an editorial layout: only its lead has an input,
// and the two large cards can show previews. Compact two-column tiles stay quiet.
export function editorialCommentOptions(index: number) {
  return { previewAllowed: index === 0 || index === 3, composerAllowed: index === 0 };
}

const date = (item: ExploreCommentCandidate) => Date.parse(item.publishedAt) || 0;
const newest = (a: ExploreCommentCandidate, b: ExploreCommentCandidate) => date(b) - date(a) || b.loves - a.loves || a.key.localeCompare(b.key);

/** Decorates the existing queue; never reorders search results or the feed. */
export function selectExploreCommentPresentation(input: (ExploreCommentCandidate | null)[], previous: ExploreCommentPlan = {}): ExploreCommentPlan {
  const seen = new Set<string>();
  const items = input.filter((item): item is ExploreCommentCandidate => Boolean(item && !seen.has(item.key) && seen.add(item.key)));
  const result: ExploreCommentPlan = Object.fromEntries(items.map(item => [item.key, { ...COLLAPSED_COMMENTS }]));
  for (let start = 0; start < items.length; start += 10) {
    const block = items.slice(start, start + 10);
    const composers = block.filter(item => item.composerAllowed);
    // Alternate fresh and loved posts. Real authored posts precede introductions.
    const lovedBlock = Math.floor(start / 10) % 2 === 1;
    composers.sort((a, b) => Number(Boolean(a.introduction)) - Number(Boolean(b.introduction)) || (lovedBlock ? b.loves - a.loves : 0) || newest(a, b));
    const composer = composers.find(item => previous[item.key]?.composer) ?? composers[0];
    if (composer) result[composer.key].composer = true;

    const budget = Math.min(2, Math.ceil(block.length / 5));
    const previews = block.filter(item => item.previewAllowed && item.comments > 0);
    const chosen = previews.filter(item => previous[item.key]?.preview).slice(0, budget);
    while (chosen.length < budget) {
      const remaining = previews.filter(item => !chosen.includes(item));
      remaining.sort((a, b) => {
        const penalty = (item: ExploreCommentCandidate) => Number(item.key === composer?.key) + chosen.reduce((sum, other) => sum + (Math.abs(block.indexOf(item) - block.indexOf(other)) < 2 ? 2 : 0) + (item.salonId && item.salonId === other.salonId ? 1 : 0), 0);
        return penalty(a) - penalty(b) || b.comments - a.comments || b.loves - a.loves || newest(a, b);
      });
      if (!remaining.length) break;
      chosen.push(remaining[0]);
    }
    for (const item of chosen) result[item.key].preview = true;
  }
  return result;
}
