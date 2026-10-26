"use client";
import { useEffect, useMemo } from "react";
import { MarketClient } from "./market-client";
import type { MarketExperienceData } from "@/types/market-experience";
import type { ExperienceContext } from "@/lib/experience-context";
import type { LiveResourceSnapshot } from "@/lib/experience-live-resource";
import { useExperienceResource } from "@/lib/use-experience-resource";
import { fetchLiveExperienceResource } from "@/lib/fetch-live-experience-resource";
import { useLiveExperienceRefresh } from "@/lib/use-live-experience-refresh";
import { PageLoadingSkeleton } from "@/components/loading-feedback";
import type { MarketBrowse } from "./market-browse";

const MARKET_RESOURCES = ["catalog", "settings"] as const;

export function MarketExperienceClient({ context, initial, transient = false, initialBrowse }: { context: ExperienceContext; initial: LiveResourceSnapshot<MarketExperienceData>; transient?: boolean; initialBrowse?: MarketBrowse }) {
  return transient ? <MarketClient {...initial.data} /> : <CachedMarketExperience context={context} initial={initial} initialBrowse={initialBrowse} />;
}

function CachedMarketExperience({ context, initial, initialBrowse }: { context: ExperienceContext; initial: LiveResourceSnapshot<MarketExperienceData>; initialBrowse?: MarketBrowse }) {
  const fetcher = useMemo(() => fetchLiveExperienceResource<MarketExperienceData>("/api/experience/market", context.scope), [context.scope]);
  const resource = useExperienceResource({ scope: context.scope, key: "market", initialData: initial,
    initialUpdatedAt: Date.parse(initial.updatedAt), initialEtag: `"${initial.revision}"`, freshForMs: 60_000, retainForMs: 30 * 60_000,
    tags: ["catalog", "settings", "market"], fetcher });
  const { refresh } = resource;
  useLiveExperienceRefresh(context.salonId ?? "", MARKET_RESOURCES, resource.refresh, Boolean(context.salonId) && resource.available, { automaticRefresh: resource.ensureFresh });
  useEffect(() => {
    const changed = () => { void refresh().catch(() => {}); };
    window.addEventListener("reylumi:market-changed", changed);
    return () => window.removeEventListener("reylumi:market-changed", changed);
  }, [refresh]);
  if (!resource.available) return <PageLoadingSkeleton />;
  return <MarketClient {...(resource.data?.data ?? initial.data)} initialBrowse={initialBrowse} />;
}
