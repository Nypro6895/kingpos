import Link from "next/link";
import { getCurrentSalonPosDeskData } from "@/lib/pos-desk";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { PosDeskClient } from "@/app/pos/pos-desk-client";
import { getOrCreatePosLiveDraft } from "@/app/pos/actions";

export default async function PosDeskPage() {
  await requireSalonManagePageContext("/pos");
  const [data, liveDraftResult] = await Promise.all([
    getCurrentSalonPosDeskData(),
    getOrCreatePosLiveDraft(),
  ]);
  const liveDraft = liveDraftResult.ok ? liveDraftResult.data : null;
  const customerDisplayHref = liveDraft
    ? `/pos/customer-display?token=${encodeURIComponent(liveDraft.token)}`
    : "/pos/customer-display";

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-5 text-zinc-950">
      <nav
        aria-label="Owner POS tools"
        className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm"
      >
        <span className="mr-1 rounded-md bg-zinc-950 px-3 py-2 font-semibold text-white">
          POS
        </span>
        <Link
          className="rounded-md border border-zinc-300 px-3 py-2 font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          href="/pos/portable"
        >
          Portable POS
        </Link>
        <Link
          className="rounded-md border border-zinc-300 px-3 py-2 font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          href={customerDisplayHref}
        >
          Customer POS
        </Link>
        <Link
          className="rounded-md border border-zinc-300 px-3 py-2 font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          href="/pos/settings"
        >
          POS Setting
        </Link>
      </nav>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">POS Desk</h1>
          <p className="text-sm text-zinc-600">
            {data.context.currentSalon?.name ?? "Current salon"} · {data.today}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            className="rounded border border-zinc-300 bg-white px-3 py-2 font-medium"
            href="/pos-tickets"
          >
            POS Tickets
          </Link>
          <Link
            className="rounded border border-zinc-300 bg-white px-3 py-2 font-medium"
            href={customerDisplayHref}
          >
            Customer Display
          </Link>
        </div>
      </div>
      <PosDeskClient
        activeSession={null}
        defaults={data.defaults}
        liveDraft={liveDraft}
        salonName={data.context.currentSalon?.name ?? "KITY"}
        services={data.services}
        staff={data.staff}
      />
    </main>
  );
}
