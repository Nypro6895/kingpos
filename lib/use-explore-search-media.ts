"use client";

import { useEffect, useRef, useState } from "react";
import { EXPERIENCE_RESET_EVENT } from "@/lib/experience-cache-events";
import { fetchExploreSearchPage } from "@/lib/explore-search-client";
import { buildExploreCommittedSearchContext } from "@/lib/explore-search-context";
import { exploreSearchRefreshInput, exploreSearchRefreshIds, mergeExploreSearchMedia } from "@/lib/explore-search-refresh";
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
  // A page append must not resurrect members already withdrawn by live checks.
  // Cursor offsets and loaded membership change within the same search session.
  const identity = JSON.stringify([context.sessionKey, response.sessionCursor?.session]);
  const [snapshot, setSnapshot] = useState<{
    identity: string; updates: Map<string, ExploreSearchResult | null>; suspended: boolean;
  } | null>(null);
  const authority = useRef<{ identity: string; suspended: boolean } | null>(null);
  const latitude = coordinates?.latitude, longitude = coordinates?.longitude;
  useEffect(() => {
    if (response.searchVersion !== 3 || !response.sessionCursor || !results.length || response.error) return;
    if (authority.current?.identity !== identity) authority.current = { identity, suspended: false };
    let alive = true, inFlight = false, suspended = authority.current.suspended;
    const controller = new AbortController();
    let lastWindow = "", scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const visible = new Set<string>();
    const allowed = new Set(results.map(row => row.id));
    let observer: IntersectionObserver | undefined;
    const refresh = async (force = true) => {
      if (!alive || suspended || inFlight || document.visibilityState !== "visible") return;
      // IntersectionObserver supplies visibility without measuring every loaded
      // card on scroll. Unsupported browsers use a bounded initial window.
      const visibleIds = observer ? [...visible] : [];
      const ids = exploreSearchRefreshIds(results, visibleIds);
      const windowKey = ids.join(",");
      if (!ids.length || (!force && windowKey === lastWindow)) return;
      inFlight = true;
      try {
        const page = await fetchExploreSearchPage(exploreSearchRefreshInput(response, ids,
          latitude != null && longitude != null ? { latitude, longitude } : null), controller.signal);
        if (page.error) throw new Error(page.error);
        if (alive && !suspended && !controller.signal.aborted) {
          lastWindow = windowKey;
          setSnapshot(previous => {
            if (previous?.identity === identity && previous.suspended) return previous;
            const updates = new Map(previous?.identity === identity ? previous.updates : []);
            const fresh = new Map(page.results.map(row => [row.id, row]));
            for (const id of ids) updates.set(id, fresh.get(id) ?? null);
            return { identity, updates, suspended: false };
          });
        }
      } catch {
        // A failed refresh keeps the usable page and retries on the next visit.
        // It never resets ranking or substitutes another search's results.
      } finally { inFlight = false; }
    };
    const reset = () => {
      suspended = true; authority.current = { identity, suspended: true }; controller.abort();
      setSnapshot({ identity, updates: new Map(), suspended: true });
    };
    const resume = () => { void refresh(); };
    // One bounded request for a newly visible window, irrespective of scroll depth.
    const scheduleWindow = () => {
      if (scrollTimer !== undefined) return;
      scrollTimer = setTimeout(() => { scrollTimer = undefined; void refresh(false); }, 500);
    };
    const timer = window.setInterval(resume, 30_000);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener(EXPERIENCE_RESET_EVENT, reset);
    document.addEventListener("visibilitychange", resume);
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.salonId;
          if (!id || !allowed.has(id)) continue;
          if (entry.isIntersecting) visible.add(id); else visible.delete(id);
        }
        scheduleWindow();
      }, { rootMargin: "600px 0px" });
      for (const node of document.querySelectorAll<HTMLElement>("[data-salon-id]")) {
        if (allowed.has(node.dataset.salonId ?? "")) observer.observe(node);
      }
    } else void refresh();
    return () => {
      alive = false; controller.abort(); window.clearInterval(timer); clearTimeout(scrollTimer);
      observer?.disconnect();
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener(EXPERIENCE_RESET_EVENT, reset);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [identity, response, results, latitude, longitude]);
  if (snapshot?.identity !== identity) return results;
  if (snapshot.suspended) return [];
  return mergeExploreSearchMedia(results,
    [...snapshot.updates.values()].filter((row): row is ExploreSearchResult => row !== null),
    [...snapshot.updates.keys()]);
}
