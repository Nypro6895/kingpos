import type { Metadata } from "next";
import { MarketClient } from "@/app/market/market-client";

export const metadata: Metadata = { title: "Market | Reylumi", description: "Explore features to add to your Reylumi salon workspace." };

export default function MarketPage() {
  return <MarketClient />;
}
