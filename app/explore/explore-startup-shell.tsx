"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FeedLoadingSkeleton } from "@/components/loading-feedback";
import { rememberExploreStartupInteraction } from "@/lib/explore-startup-interaction";
import type { ExploreLocationSource } from "@/types/explore";
import { ExploreSearchToolbar } from "./explore-search-toolbar";

export function ExploreStartupShell({ query, category, location, source, viewerId }: {
  query: string; category: string; location: string; source: ExploreLocationSource; viewerId: string | null;
}) {
  const router = useRouter(), search = useSearchParams();
  const [areaOpen, setAreaOpen] = useState(false);
  const navigate = (values: Record<string, string>) => {
    const params = new URLSearchParams(search.toString()); params.delete("page"); params.delete("cursor");
    for (const [key, value] of Object.entries(values)) { if (value) params.set(key, value); else params.delete(key); }
    params.set("type", "salons");
    router.push(`/explore${params.size ? `?${params}` : ""}`, { scroll: false });
  };
  return <main className="min-w-0 bg-white" data-explore-startup="">
    <div className="mx-auto w-full max-w-[92rem] px-4 pt-2 sm:px-6 lg:px-3"
      onInputCapture={event => { if (event.target instanceof HTMLInputElement && event.target.name === "q") rememberExploreStartupInteraction(viewerId, { query: event.target.value, focused: true }); }}>
      <ExploreSearchToolbar query={query} category={category} location={location} locationSource={source}
        scopePolicy={search.get("scope") === "expandable" ? "expandable" : location ? "fixed" : "expandable"}
        locating={false} pending={false} message={null} areaOpen={areaOpen} onAreaOpenChange={setAreaOpen}
        onDraftChange={() => { /* Draft values are captured from the actual input above. */ }}
        onSearch={value => navigate({ q: value, type: "salons" })}
        onSuggestionSelect={suggestion => navigate({ q: suggestion.kind === "area" ? "" : suggestion.query,
          ...(suggestion.kind === "area" ? { location: suggestion.location ?? suggestion.query, locationSource: "manual", scope: "fixed" } : {}),
          ...(suggestion.category ? { category: suggestion.category } : {}), type: "salons" })}
        onAreaApply={(value, scope) => navigate({ location: value, locationSource: "manual", scope })}
        onCurrentLocation={() => rememberExploreStartupInteraction(viewerId, { gps: true })} />
    </div>
    <div className="mx-auto grid w-full max-w-[40rem] gap-3 px-4 py-4"><FeedLoadingSkeleton /></div>
  </main>;
}
