"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useExperienceScope } from "@/components/experience-scope";
import { experienceResourceCache } from "./experience-resource-cache";
import { fetchWorkspaceResource } from "./fetch-workspace-resource";
import type { PublicSalonProfileData } from "@/types/salon-profile";

type Content = Pick<PublicSalonProfileData, "looks" | "updates" | "feed" | "contentPage">;
const policy = { tags: ["salon-profile"], freshForMs: 30_000, retainForMs: 30 * 60_000 };
const unique = <T extends { id: string }>(items: T[]) => [...new Map([...items].reverse().map(item => [item.id, item])).values()].reverse();
type RetainedPages = { head: string; pages: Record<number, Content> };

export function useSalonProfilePages(initial: PublicSalonProfileData) {
  const scope = useExperienceScope()?.context.scope;
  const salonId = initial.profile.salonId;
  const managed = Boolean(initial.contentPage?.managed);
  const key = `salon-profile-pages:${salonId}:${managed}`;
  const head = initial.feed.map(item => `${item.contentType}:${item.id}`).join(",");
  const [state, setState] = useState<{ key: string; pages: Record<number, Content> }>({ key, pages: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const generation = useRef(0);
  const pages = state.key === key ? state.pages : {};
  const ordered = Object.keys(pages).map(Number).sort((a, b) => a - b);
  const last = ordered.length ? pages[ordered.at(-1)!] : initial;
  const nextPage = last.contentPage?.nextPage ?? null;
  const read = useCallback(async (page: number, force = false) => {
    if (!scope) throw new Error("The session must be checked before loading more posts.");
    const url = `/api/salon-profile/content?salonId=${encodeURIComponent(salonId)}&page=${page}${managed ? "&managed=1" : ""}`;
    const content = await experienceResourceCache.load({ scope, key: url }, fetchWorkspaceResource<Content>(url, scope), { ...policy, force });
    if (!Array.isArray(content.feed) || !Array.isArray(content.looks) || !Array.isArray(content.updates) || !content.contentPage
      || !(content.contentPage.nextPage === null || Number.isInteger(content.contentPage.nextPage) && content.contentPage.nextPage > page)) throw new Error("Invalid salon posts.");
    return content;
  }, [scope, salonId, managed]);

  useEffect(() => {
    const epoch = ++generation.current;
    busy.current = false;
    queueMicrotask(() => { if (generation.current === epoch) { setLoading(false); setError(""); setState({ key, pages: {} }); } });
    if (!scope || !initial.contentPage) return;
    const context = { scope, key };
    const retained = experienceResourceCache.get<RetainedPages>(context);
    // Page zero comes from the new authorized render. Reuse only fresh tail
    // pages; older pages are validated individually, never re-download history.
    const tail = retained?.data.pages ?? {};
    const restore = async () => {
      busy.current = true;
      const restored: Record<number, Content> = {};
      for (const page of Object.keys(tail).map(Number).sort((a, b) => a - b)) {
        if (!initial.contentPage?.nextPage || generation.current !== epoch) break;
        try {
          restored[page] = experienceResourceCache.get<RetainedPages>(context)?.fresh && retained?.data.head === head ? tail[page] : await read(page, retained?.data.head !== head);
          if (generation.current !== epoch || !experienceResourceCache.isAvailable(context)) return;
          setState({ key, pages: { ...restored } });
          if (restored[page].contentPage?.nextPage === null) break;
        } catch { break; }
      }
      if (generation.current === epoch) {
        if (Object.keys(restored).length) experienceResourceCache.seed(context, { head, pages: restored }, policy,
          retained?.fresh && retained.data.head === head ? retained.updatedAt : Date.now());
        busy.current = false; setLoading(false);
      }
    };
    queueMicrotask(() => { if (generation.current === epoch) void restore(); });
    const unsubscribe = experienceResourceCache.subscribe(context, event => {
      if (event === "reset") { generation.current++; busy.current = false; setState({ key, pages: {} }); }
      if (event === "invalidated") void restore();
    });
    return () => { generation.current++; unsubscribe(); };
  }, [scope, key, head, initial, read]);

  const loadMore = async () => {
    if (busy.current || nextPage === null || !scope) return;
    const epoch = generation.current;
    busy.current = true; setLoading(true); setError("");
    try {
      const content = await read(nextPage, Boolean(error));
      if (generation.current !== epoch || !experienceResourceCache.isAvailable({ scope, key })) return;
      const next = { ...pages, [nextPage]: content };
      setState({ key, pages: next });
      experienceResourceCache.seed({ scope, key }, { head, pages: next }, policy);
    } catch {
      if (generation.current === epoch) setError("Older posts could not load. Please try again.");
    } finally {
      if (generation.current === epoch) { busy.current = false; setLoading(false); }
    }
  };
  const tail = ordered.map(page => pages[page]);
  return {
    data: { ...initial,
      looks: unique([...initial.looks, ...tail.flatMap(page => page.looks)]),
      updates: unique([...initial.updates, ...tail.flatMap(page => page.updates)]),
      // Feed IDs are UUIDs but their source type is part of the stable identity.
      feed: [...new Map([...initial.feed, ...tail.flatMap(page => page.feed)].reverse().map(item => [`${item.contentType}:${item.id}`, item])).values()].reverse(),
    }, loading, error, hasMore: nextPage !== null, loadMore,
  };
}
