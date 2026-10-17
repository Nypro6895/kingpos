"use client";

import { useEffect, useState } from "react";
import { EXPERIENCE_RESET_EVENT } from "@/lib/experience-cache-events";
import { fetchExploreSearchPage } from "@/lib/explore-search-client";
import { buildExploreCommittedSearchContext } from "@/lib/explore-search-context";
import { exploreSearchRefreshInput, mergeExploreSearchMedia } from "@/lib/explore-search-refresh";
import type { ExploreSearchResponse, ExploreSearchResult } from "@/types/explore";

/** Recheck existing session members when returning to a cached page or after an upload. */
export function useExploreSearchMedia({ response, results, coordinates, viewerId }: {
  response: ExploreSearchResponse;
  results: ExploreSearchResult[];
  coordinates?: { latitude: number; longitude: number } | null;
  viewerId?: string | null;
}) {
  const context = buildExploreCommittedSearchContext(response, {
    viewerId, gpsContext: coordinates ? { response, coordinates } : null,
  });
  const identity = JSON.stringify([context.sessionKey, response.sessionCursor,
    results.map(row => [row.id, row.mediaRevision, row.coverImageUrl])]);
  const [snapshot, setSnapshot] = useState<{ identity: string; rows: ExploreSearchResult[] } | null>(null);
  const latitude = coordinates?.latitude, longitude = coordinates?.longitude;
  useEffect(() => {
    if (response.searchVersion !== 3 || !response.sessionCursor || !results.length || response.error) return;
    let alive = true, inFlight = false, suspended = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (!alive || suspended || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const fresh: ExploreSearchResult[] = [];
        for (let index = 0; index < results.length; index += 100) {
          const page = await fetchExploreSearchPage(exploreSearchRefreshInput(response,
            results.slice(index, index + 100).map(row => row.id),
            latitude != null && longitude != null ? { latitude, longitude } : null), controller.signal);
          if (page.error) throw new Error(page.error);
          fresh.push(...page.results);
        }
        if (alive && !suspended && !controller.signal.aborted) {
          setSnapshot({ identity, rows: mergeExploreSearchMedia(results, fresh) });
        }
      } catch {
        // A failed refresh keeps the usable page and retries on the next visit.
        // It never resets ranking or substitutes another search's results.
      } finally { inFlight = false; }
    };
    const reset = () => { suspended = true; controller.abort(); setSnapshot({ identity, rows: [] }); };
    const resume = () => { void refresh(); };
    const timer = window.setInterval(resume, 30_000);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener(EXPERIENCE_RESET_EVENT, reset);
    document.addEventListener("visibilitychange", resume);
    void refresh();
    return () => {
      alive = false; controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener(EXPERIENCE_RESET_EVENT, reset);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [identity, response, results, latitude, longitude]);
  return snapshot?.identity === identity ? snapshot.rows : results;
}
