"use client";

import { MarketStartupView } from "@/app/market/market-startup-view";
import { marketBrowseFromQuery } from "@/app/market/market-browse";
import { useSearchParams } from "next/navigation";

export default function MarketError({ unstable_retry }: { unstable_retry: () => void }) {
  const search = useSearchParams();
  return <MarketStartupView initialBrowse={marketBrowseFromQuery({ q: search.get("q") ?? undefined, category: search.get("category") ?? undefined })} retry={unstable_retry} />;
}
