import { Suspense } from "react";
import { connection } from "next/server";
import { loadReviewQueue } from "@/lib/market-registry/server";
import { ReviewWorkspace } from "@/components/market-registry/review-workspace";
import { RegistryLoading, RegistryUnavailable } from "@/components/market-registry/registry-shell";

export const metadata = { title: "Private app review" };

async function ReviewContent() {
  await connection();
  const result = await loadReviewQueue();
  return result.status === "ready" ? <ReviewWorkspace queue={result.data} /> : <RegistryUnavailable message={result.message} />;
}

export default function MarketReviewPage() {
  return <Suspense fallback={<RegistryLoading />}><ReviewContent /></Suspense>;
}
