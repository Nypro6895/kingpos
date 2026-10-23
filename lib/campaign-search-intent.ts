import { resolveExploreQueryRouting, type ExploreQueryEntityRpc } from "./explore-query-routing";
import type { ExploreSearchQueryKind } from "@/types/explore";

type CampaignSearchIntent = { terms: string; kind: ExploreSearchQueryKind; category: string; location: string };

/** Reuse verified Explore name/service/style and place routing, not substring guesses. */
export async function campaignSearchIntent(query: string, location: string, rpc: ExploreQueryEntityRpc, signal?: AbortSignal): Promise<CampaignSearchIntent | null> {
  const intent = await resolveExploreQueryRouting({ query, location, locationSource: location ? "manual" : "none" }, { rpc, signal });
  if (intent.lookupFailed || intent.areaAmbiguous || intent.addressStatus === "unmatched") return null;
  return { terms: intent.contentQuery, kind: intent.queryKind, category: intent.category, location: intent.location };
}
