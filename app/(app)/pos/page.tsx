import Link from "next/link";
import { getCurrentSalonPosDeskData } from "@/lib/pos-desk";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { PosDeskClient } from "@/app/pos/pos-desk-client";
import { PosOwnerWorkspaceTabs } from "@/app/pos/pos-owner-workspace-tabs";
import { PosRapidMobileBridge } from "@/app/pos/pos-rapid-mobile-bridge";
import styles from "@/app/pos/pos-rapid-mobile.module.css";
import { getOrCreatePosLiveDraft } from "@/app/pos/actions";

export default async function PosDeskPage() {
  await requireSalonManagePageContext("/pos");
  const [data, liveDraftResult] = await Promise.all([
    getCurrentSalonPosDeskData(),
    getOrCreatePosLiveDraft(),
  ]);
  const liveDraft = liveDraftResult.ok ? liveDraftResult.data : null;
  const salonName = data.context.currentSalon?.name ?? "Current salon";
  const salonId = data.context.currentSalon?.id ?? null;
  const customerDisplayHref = liveDraft
    ? `/pos/customer-display?token=${encodeURIComponent(liveDraft.token)}`
    : "/pos/customer-display";

  return (
    <main
      className="min-h-screen bg-zinc-100 px-4 py-5 text-zinc-950 max-md:flex max-md:h-[calc(100dvh-5rem)] max-md:min-h-0 max-md:flex-col max-md:overflow-hidden max-md:px-0 max-md:py-0"
      data-pos-owner-page
    >
      <div className="hidden md:block">
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
            <p className="text-sm font-medium text-zinc-600">
              {salonName} / {data.today}
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
      </div>

      <div className="mx-auto mb-3 w-full max-w-[1600px] shrink-0 px-0 max-md:px-2 max-md:pt-2 md:mb-4">
        <PosOwnerWorkspaceTabs salonId={salonId} />
      </div>

      <div className="mx-auto w-full max-w-[1600px] max-md:min-h-0 max-md:flex-1 max-md:overflow-hidden">
        <div className={styles.rapidHost} data-pos-rapid-host>
          <PosRapidMobileBridge services={data.services} staff={data.staff} />
          <div className={styles.engine} data-pos-rapid-engine>
            <PosDeskClient
              activeSession={null}
              defaults={data.defaults}
              liveDraft={liveDraft}
              salonName={salonName}
              services={data.services}
              staff={data.staff}
              today={data.today}
              waitingVisits={data.waitingVisits}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
