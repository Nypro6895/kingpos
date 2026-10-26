import { nailQueryTerms, selectNailLooks } from "@/lib/nail-inspiration";
import type { NailLook } from "@/lib/nail-inspiration-catalog";

/** Keep the customer's known descriptors ahead of general inspiration. */
export function rankRelatedNailLooks(query: string, excluded: readonly string[] = [], minimumScore = 0): NailLook[] {
  const terms = nailQueryTerms(query);
  const score = (look: NailLook) => {
    const tags = new Set(nailQueryTerms([look.title, look.shape, look.length, look.finish, ...look.colors, ...look.tones, ...look.seasons, ...(look.keywords ?? [])].join(" ")));
    return terms.reduce((sum, term) => sum + (tags.has(term) ? 1 : 0), 0);
  };
  return selectNailLooks("", {}, "related:" + query)
    .filter(look => !excluded.includes(look.id))
    .map(look => ({ look, score: score(look) }))
    .filter(entry => entry.score >= minimumScore)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.look);
}
