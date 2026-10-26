import { Suspense } from "react";
import { connection } from "next/server";
import { loadDeveloperWorkspace } from "@/lib/market-registry/server";
import { DeveloperWorkspace } from "@/components/market-registry/developer-workspace";
import { RegistryLoading, RegistryUnavailable } from "@/components/market-registry/registry-shell";

export const metadata = { title: "Developer Market workspace" };

async function DeveloperContent() {
  await connection();
  const result = await loadDeveloperWorkspace();
  return result.status === "ready" ? <DeveloperWorkspace workspace={result.data} /> : <RegistryUnavailable message={result.message} />;
}

export default function DeveloperMarketPage() {
  return <Suspense fallback={<RegistryLoading />}><DeveloperContent /></Suspense>;
}
