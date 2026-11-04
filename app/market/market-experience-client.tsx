"use client";
import { useCallback, useEffect, useMemo } from "react";
import { MarketClient } from "./market-client";
import type { MarketExperienceData } from "@/types/market-experience";
import type { ExperienceContext } from "@/lib/experience-context";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import { useExperienceResource } from "@/lib/use-experience-resource";
import { experienceResourceCache } from "@/lib/experience-resource-cache";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import { useLiveExperienceRefresh } from "@/lib/use-live-experience-refresh";
import { PageLoadingSkeleton } from "@/components/loading-feedback";
import type { MarketBrowse } from "./market-browse";

const MARKET_RESOURCES = ["catalog", "settings"] as const;

export function MarketExperienceClient({ context, initial, transient = false, initialBrowse }: { context: ExperienceContext; initial: LiveResourceSnapshot<MarketExperienceData>; transient?: boolean; initialBrowse?: MarketBrowse }) {
  return transient ? <MarketClient {...initial.data} accessRevision={`${initial.revision}:${initial.updatedAt}`} /> : <CachedMarketExperience context={context} initial={initial} initialBrowse={initialBrowse} />;
}

function CachedMarketExperience({ context, initial, initialBrowse }: { context: ExperienceContext; initial: LiveResourceSnapshot<MarketExperienceData>; initialBrowse?: MarketBrowse }) {
  const fetcher = useMemo(() => fetchLiveExperienceResource<MarketExperienceData>("/api/experience/market", context.scope), [context.scope]);
  const resource = useExperienceResource({ scope: context.scope, key: "market", initialData: initial,
    initialUpdatedAt: Date.parse(initial.updatedAt), initialEtag: `"${initial.revision}"`, freshForMs: 60_000, retainForMs: 30 * 60_000,
    tags: ["catalog", "settings", "market"], fetcher });
  const { refresh } = resource;
  const refreshMarket = useCallback(() => { void refresh().catch(() => {}); }, [refresh]);
  useLiveExperienceRefresh(context.salonId ?? "", MARKET_RESOURCES, resource.refresh, Boolean(context.salonId) && resource.available, { automaticRefresh: resource.ensureFresh });
  useEffect(() => {
    const changed = (event: Event) => {
      const scope = event instanceof CustomEvent ? event.detail?.scope : undefined;
      if (scope && scope !== context.scope) return;
      refreshMarket();
    };
    window.addEventListener("reylumi:market-changed", changed);
    return () => window.removeEventListener("reylumi:market-changed", changed);
  }, [context.scope, refreshMarket]);
  if (!resource.available) return <PageLoadingSkeleton />;
  // A 304 still verifies access now. Active-trial and paid-subscription changes
  // can share the same visible Market booleans, so include that verification.
  const verifiedAt = experienceResourceCache.get({ scope: context.scope, key: "market" })?.updatedAt ?? Date.parse(initial.updatedAt);
  const accessRevision = `${resource.data?.revision ?? initial.revision}:${verifiedAt}`;
  return <MarketClient {...(resource.data?.data ?? initial.data)} accessRevision={accessRevision} onMarketRefresh={refreshMarket} initialBrowse={initialBrowse} />;
}
