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

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-5 text-zinc-950">
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
            href="/pos/customer-display"
          >
            Customer Display
          </Link>
        </div>
      </div>
      <PosDeskClient
        activeSession={null}
        defaults={data.defaults}
        liveDraft={liveDraftResult.ok ? liveDraftResult.data : null}
        salonName={data.context.currentSalon?.name ?? "KingPOS"}
        services={data.services}
        staff={data.staff}
      />
    </main>
  );
}
