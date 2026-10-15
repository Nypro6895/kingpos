import { withExperiencePage } from "@/components/experience-page";
import { Suspense } from "react";
import type { Metadata } from "next";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { loadMarketExperienceData } from "@/lib/market-experience-data";
import { createLiveResourceSnapshot } from "@/lib/experience-live-resource-server";
import { MarketExperienceClient } from "@/app/market/market-experience-client";
import { MarketStartupView } from "@/app/market/market-startup-view";
import { marketBrowseFromQuery, type MarketBrowse } from "@/app/market/market-browse";
import { runReadWithDeadline } from "@/lib/bounded-get";

export const metadata: Metadata = { title: "Market | Reylumi", description: "Explore features to add to your Reylumi salon workspace." };
type MarketQuery = { bookingStripe?: string; payment?: string; q?: string; category?: string };
async function MarketPage({ searchParams }: { searchParams: Promise<MarketQuery> }) {
  const query = await searchParams;
  // Payment returns must resolve their authoritative state before a fresh page revision is revealed.
  if (query.payment !== undefined || query.bookingStripe !== undefined) return await MarketContent({ query, transient: true });
  const initialBrowse = marketBrowseFromQuery(query);
  return <Suspense fallback={<MarketStartupView key={`${initialBrowse?.query ?? ""}:${initialBrowse?.category ?? ""}`} initialBrowse={initialBrowse} />}>
    <MarketContent query={query} initialBrowse={initialBrowse} />
  </Suspense>;
}

async function MarketContent({ query, transient = false, initialBrowse }: { query: MarketQuery; transient?: boolean; initialBrowse?: MarketBrowse }) {
  const context = await getRequestBusinessContext();
  const read = loadMarketExperienceData(context, query);
  const data = await runReadWithDeadline(read, 20_000);
  return <MarketExperienceClient transient={transient} initialBrowse={initialBrowse} context={getExperienceContext(context)} initial={createLiveResourceSnapshot(data)} />;
}

export default withExperiencePage(MarketPage);
