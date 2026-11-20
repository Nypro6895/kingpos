import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { loadMarketTaxAdminState, marketTaxDateRange } from "@/lib/market-tax";
import { MarketTaxWorkspace } from "./tax-workspace";

async function MarketTaxPage({ searchParams }: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[]; view?: string | string[] }>;
}) {
  const actor = await requirePlatformAdmin(P.teamManage);
  if (actor.roleSlug !== "platform_owner") notFound();
  const filters = await searchParams;
  const from = typeof filters.from === "string" ? filters.from : undefined;
  const to = typeof filters.to === "string" ? filters.to : undefined;
  let invalidDates = false;
  try { marketTaxDateRange({ from, to }); } catch { invalidDates = true; }
  const state = await loadMarketTaxAdminState(invalidDates ? {} : { from, to });
  return <div className="space-y-6">
    <header className="space-y-2">
      <Link href="/admin/system" className="text-sm font-medium text-zinc-600 hover:text-zinc-950">← System</Link>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">Automatic tax</h1>
      <p className="max-w-3xl text-sm leading-6 text-zinc-600">Configure product classifications, review collection readiness and reconcile tax from paid invoices and refunds.</p>
    </header>
    {invalidDates && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Choose valid dates with the end on or after the start. Showing all activity until you apply a valid date range.</p>}
    <MarketTaxWorkspace state={state} initialTab={filters.view === "ledger" || from || to ? "ledger" : "setup"} />
  </div>;
}

export default withExperiencePage(MarketTaxPage, { admin: true });
