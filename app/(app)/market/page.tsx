import type { Metadata } from "next";
import { MarketClient } from "@/app/market/market-client";

export const metadata: Metadata = { title: "Market | Reylumi", description: "Discover sample apps for your salon workspace." };

export default function MarketPage() {
  return <MarketClient />;
}
