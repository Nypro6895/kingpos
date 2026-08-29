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

  return (
    <main className="flex min-h-[calc(100dvh-5rem)] flex-col overflow-hidden bg-zinc-100 px-4 py-4 text-zinc-950 max-md:px-0 max-md:py-0">
      <div className="mx-auto mb-3 w-full max-w-[1600px] shrink-0 px-0 max-md:px-2 max-md:pt-2">
        <PosOwnerWorkspaceTabs />
      </div>

      <div className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 overflow-hidden">
        <div className={styles.rapidHost} data-pos-rapid-host>
          <PosRapidMobileBridge services={data.services} staff={data.staff} />
          <div className={styles.engine} data-pos-rapid-engine>
            <PosDeskClient
              activeSession={null}
              defaults={data.defaults}
              liveDraft={liveDraft}
              salonName={data.context.currentSalon?.name ?? "Current salon"}
              services={data.services}
              staff={data.staff}
              surface="portable"
              today={data.today}
              waitingVisits={data.waitingVisits}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
