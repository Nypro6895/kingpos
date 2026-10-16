"use client";

import { useEffect, useMemo, useState } from "react";
import { ExploreProgressiveClient } from "@/app/explore/explore-progressive-client";
import { ExploreStartupShell } from "@/app/explore/explore-startup-shell";
import type { ExploreStartupExtras } from "@/app/explore/explore-progressive-client";
import type { ExploreFeedPage, ExploreLocationSource } from "@/types/explore";
import type { AppLocalPage, AppLocalPageProps } from "./app-local-page-registry";
import { useAppLocalResource } from "./app-local-resource";
import { APP_LOCAL_EXPLORE_QUERY_KEYS } from "./app-local-explore-metadata";
import type { AppLocalExploreCore, AppLocalExploreExtras } from "./app-local-explore-types";
import { buildExploreDiscoveryContent } from "./explore-discovery-presentation";
import { enrichExploreShowcaseContent } from "./explore-showcase-content";

function deferred<T>(key: string) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { key, promise, resolve };
}
function useDeferred<T>(key: string) {
  const [pending, setPending] = useState(() => deferred<T>(key));
  if (pending.key !== key) {
    const next = deferred<T>(key);
    setPending(next);
    return next;
  }
  return pending;
}

function ExplorePage({ path, context }: AppLocalPageProps) {
  const url = new URL(path, "https://reylumi.com"), params = new URLSearchParams(url.search);
  params.delete("page"); params.sort();
  const scope = context?.context.scope;
  const [seed, setSeed] = useState<{ scope: string; data: AppLocalExploreCore } | null>(null);
  const [startup, setStartup] = useState({ scope, query: params.toString() });
  if (startup.scope !== scope || seed?.scope !== scope && startup.query !== params.toString()) setStartup({ scope, query: params.toString() });
  const query = startup.scope === scope ? startup.query : params.toString();
  const resource = useAppLocalResource<AppLocalExploreCore>(scope, "page.explore", { query }, { enabled: Boolean(scope) });
  // A later server refresh must not replace the active discovery cursor or its
  // entered search. The existing progressive client quietly applies optional rails.
  if (resource.data && scope && seed?.scope !== scope) setSeed({ scope, data: resource.data });
  const data = seed?.scope === scope ? seed?.data : undefined;
  const extrasEnabled = Boolean(data && (data.deferred?.extras ?? true)), feedEnabled = Boolean(data?.deferred?.feed);
  const extrasResource = useAppLocalResource<AppLocalExploreExtras>(scope, "page.explore-extras", { query }, { enabled: extrasEnabled });
  const feedResource = useAppLocalResource<ExploreFeedPage | null>(scope, "page.explore-feed", { query }, { enabled: feedEnabled });
  const pendingKey = JSON.stringify([scope, query]);
  const extrasPending = useDeferred<ExploreStartupExtras>(pendingKey);
  const feedPending = useDeferred<ExploreFeedPage | null>(pendingKey);
  const extras = useMemo(() => {
    if (!data || !extrasResource.data) return undefined;
    const { homeContent, utilityContent, quickActions } = extrasResource.data;
    const discoveryContent = buildExploreDiscoveryContent({ homeContent, utilityContent, searchResponse: data.initialResponse, initialFeed: data.initialFeed, workspaceLocation: data.workspaceLocation });
    const enriched = enrichExploreShowcaseContent({ discoveryContent, homeContent, initialFeed: data.initialFeed, searchResponse: data.initialResponse }, data.deferred?.showcase ?? false);
    return { homeContent: enriched.homeContent, discoveryContent: enriched.discoveryContent, quickActions };
  }, [extrasResource.data, data]);
  useEffect(() => {
    if (extras) extrasPending.resolve(extras);
    else if (data && (extrasResource.error || !extrasEnabled)) extrasPending.resolve({ homeContent: data.homeContent, discoveryContent: data.discoveryContent, quickActions: data.quickActions });
  }, [extras, data, extrasResource.error, extrasEnabled, extrasPending]);
  useEffect(() => {
    if (feedResource.data !== undefined) feedPending.resolve(feedResource.data);
    else if (feedResource.error || data && !feedEnabled) feedPending.resolve(null);
  }, [feedResource.data, feedResource.error, feedEnabled, feedPending, data]);
  const extrasPromise = useMemo(() => extras ? Promise.resolve(extras) : extrasPending.promise, [extras, extrasPending]);
  const source = params.get("locationSource");
  const locationSource: ExploreLocationSource = source === "gps" || source === "activity" || source === "saved" || source === "workspace" ? source : params.get("location") ? "manual" : "none";
  return data ? <ExploreProgressiveClient initial={data} extras={extrasPromise} feed={feedEnabled ? feedPending.promise : undefined} /> : <>
    <ExploreStartupShell query={params.get("q") ?? ""} category={params.get("category") || "All"} location={params.get("location") ?? ""} source={locationSource} viewerId={context?.context.viewerId ?? null} />
    {resource.error ? <div role="status" className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3"><p>Could not open Explore. Please try again.</p><button type="button" onClick={() => void resource.refresh()}>Try again</button></div> : null}
  </>;
}
const page: AppLocalPage = { id: "explore", title: "Explore", requiresContext: false, Component: ExplorePage, features: ["original-complete-client", "original-search-and-location", "original-discovery-and-feed", "original-social-controls", "retained-cursor", "scoped-durable-startup"] };
export function getAppLocalExplorePage(path: string): AppLocalPage | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path) || path.length > 4096) return null;
    const url = new URL(path, "https://reylumi.com");
    if (url.pathname !== "/explore" || url.hash || [...url.searchParams].some(([key, value]) => !APP_LOCAL_EXPLORE_QUERY_KEYS.includes(key as typeof APP_LOCAL_EXPLORE_QUERY_KEYS[number]) || value.length > 512 || url.searchParams.getAll(key).length !== 1)) return null;
    return page;
  } catch { return null; }
}
