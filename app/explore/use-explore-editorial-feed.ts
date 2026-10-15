"use client";
import { useEffect, useState } from "react";
import { fetchExploreFeedPage, requestExploreFeed } from "@/lib/explore-feed-client";
import type { ExploreFeedValidation } from "@/lib/explore-feed-revisions";
import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import type { ExploreFeedPage } from "@/types/explore";

/** Fresh tiles and the continuation share one bounded regional feed session. */
export function useExploreEditorialFeed(discovery: ExploreFeedDiscoveryOptions, viewerId: string | null, surface: "mobile" | "desktop") {
  const signature = JSON.stringify({ discovery, viewerId });
  const [result, setResult] = useState<{ signature: string; page: ExploreFeedPage } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const viewport = window.matchMedia("(min-width:1280px)");
    let started = false;
    const filters = JSON.parse(signature).discovery as ExploreFeedDiscoveryOptions;
    const load = async () => {
    if (started || viewport.matches !== (surface === "desktop")) return;
    started = true;
    const key = "reylumi-editorial-v1:" + signature;
    try {
      // Restore only after checking the current actor and each public item.
      // Returning from a post preserves the same frozen regional queue.
      let page: ExploreFeedPage | undefined;
      try {
        const cached = JSON.parse(sessionStorage.getItem(key) || "null");
        if (cached?.page?.sessionCursor && Array.isArray(cached.page.items) && cached.page.items.length <= 12 && Date.now() - cached.at < 25 * 60_000) {
          const validated = await requestExploreFeed<ExploreFeedValidation>({ mode: "validate", cursor: cached.page.sessionCursor, contentKeys: cached.page.items.map((item: { contentKey: string }) => item.contentKey) }, controller.signal);
          if (!validated.error && validated.items) page = { ...cached.page, items: validated.items };
        }
      } catch { /* Expired sessions and unavailable storage start a fresh queue. */ }
      if (controller.signal.aborted) return;
      page ??= await fetchExploreFeedPage(null, filters, controller.signal);
      if (controller.signal.aborted || page.error) return;
      setResult({ signature, page });
      try {
        const entries = Object.keys(sessionStorage).filter(name=>name.startsWith("reylumi-editorial-v1:") && name!==key);
        while(entries.length>=6) sessionStorage.removeItem(entries.shift()!);
        sessionStorage.setItem(key,JSON.stringify({at:Date.now(),page}));
      } catch { /* Discovery remains usable without storage. */ }
    } catch { /* The continuation retains its visible retry path. */ }
    };
    void load(); viewport.addEventListener("change", load);
    return () => { controller.abort(); viewport.removeEventListener("change", load); };
  }, [signature, surface]);
  return result?.signature === signature ? result.page : undefined;
}
