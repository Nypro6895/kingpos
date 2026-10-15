"use client";

import { useMemo, useState } from "react";
import { NailInspirationCard } from "@/app/explore/nail-inspiration";
import { ExploreEditorialReferenceCard } from "@/app/explore/explore-editorial";
import { ExploreAutoLoad } from "@/app/explore/explore-auto-load";
import { exploreServiceGuides } from "@/lib/explore-editorial";
import { supportsNailInspiration } from "@/lib/nail-inspiration";
import { rankRelatedNailLooks } from "@/lib/explore-reference-recommendations";

/** Local reference content works even without a salon, network or fresh public posts. */
export function ExploreReferenceFeed({ query = "", category = "", excludeLookIds = [] }: {
  query?: string; category?: string; excludeLookIds?: readonly string[];
}) {
  const [limit, setLimit] = useState(6);
  const entries = useMemo(() => {
    const categories = [...new Set([category, "Nails", "Hair", "Spa", "Lashes", "Brows", "Massage", "Tattoo", "Waxing", "Skin Care"].filter(value => value && value !== "All"))];
    const guides = categories.flatMap(value => exploreServiceGuides(value, ""));
    const looks = supportsNailInspiration(category) ? rankRelatedNailLooks(query, excludeLookIds) : [];
    const remaining = [...looks.map(look => ({ kind: "look" as const, look })), ...guides.map(guide => ({ kind: "guide" as const, guide }))];
    return remaining;
  }, [query, category, excludeLookIds]);
  // Every cycle is explicitly a revisit. Loading is driven by scrolling, never a timer.
  const rendered = Array.from({ length: limit }, (_, index) => ({ entry: entries[index % entries.length], index }));
  return <section className="mx-auto grid w-full max-w-[40rem] gap-4 pt-5" aria-label="More inspiration" data-testid="explore-reference-continuation">
    <div><h2 className="text-xl font-semibold text-text-primary">More inspiration for you</h2>
      <p className="mt-1 text-sm text-text-secondary">Ideas and guides to explore wherever you are.</p></div>
    {rendered.map(({ entry, index }) => <div key={index} className="grid gap-3">
      {index > 0 && index % entries.length === 0 ? <p className="pt-4 text-sm font-semibold text-brand-teal">Ideas worth another look</p> : null}
      {entry.kind === "look" ? <NailInspirationCard look={entry.look} /> : <ExploreEditorialReferenceCard reference={entry.guide} />}
    </div>)}
    <ExploreAutoLoad progressKey={limit} onLoad={() => setLimit(value => value + 6)} />
    <button type="button" onClick={() => setLimit(value => value + 6)} className="sr-only min-h-11 rounded-full px-5 py-3 focus:not-sr-only">More inspiration</button>
  </section>;
}
