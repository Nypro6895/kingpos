import { PosDeskClient } from "@/app/pos/pos-desk-client";
import { PosRapidMobileBridge } from "@/app/pos/pos-rapid-mobile-bridge";
import styles from "@/app/pos/pos-rapid-mobile.module.css";
import { cookies } from "next/headers";
import { PrepareWorkspaceDevice } from '@/app/pos/portable/prepare-workspace-device';
import { SingleWorkspaceWindow } from '@/app/pos/single-workspace-window';
import {
  getPortablePosDeskData,
  portableCreatePosDeskCustomer,
  portableGetPosLiveDraft,
  portableSearchPosDeskCustomers,
  portableAdjustStaffTurn,
  portableCancelWaitingVisitForPos,
  portableSubmitPosDeskReceipt,
  portableSelectWaitingVisitForPos,
  portableUpdatePosActiveDraft,
  portableUpdatePosLiveDraftCustomer,
} from "@/app/pos/portable/actions";

export default async function PortablePosPage() {
  if (!(await cookies()).get('kingpos-workspace-device')?.value) return <PrepareWorkspaceDevice/>;
  let data: Awaited<ReturnType<typeof getPortablePosDeskData>>;

  try {
    data = await getPortablePosDeskData();
  } catch {
    return (
      <section className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-zinc-950">
            Portable POS is locked
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            End the current device session and sign in again with a valid Portable
            POS ID.
          </p>
        </div>
      </section>
    );
  }

  return (
    <SingleWorkspaceWindow id="portable-pos">
    <section
      className="h-full min-h-0 overflow-hidden p-2 max-md:p-0"
      data-portable-pos-page="pos"
    >
      <div className={styles.rapidHost} data-pos-rapid-host>
        <PosRapidMobileBridge staffCheckInEnabled={data.defaults.staffCheckInEnabled} services={data.services} staff={data.staff} />
        <div className={styles.engine} data-pos-rapid-engine>
          <PosDeskClient
            actions={{
              adjustStaffTurn: portableAdjustStaffTurn,
              cancelWaitingVisitForPos: portableCancelWaitingVisitForPos,
              createPosDeskCustomer: portableCreatePosDeskCustomer,
              getPosLiveDraft: portableGetPosLiveDraft,
              searchPosDeskCustomers: portableSearchPosDeskCustomers,
              selectWaitingVisitForPos: portableSelectWaitingVisitForPos,
              submitPosDeskReceipt: portableSubmitPosDeskReceipt,
              updatePosActiveDraft: portableUpdatePosActiveDraft,
              updatePosLiveDraftCustomer: portableUpdatePosLiveDraftCustomer,
            }}
            activeSession={null}
            defaults={data.defaults}
            offlineDraftSyncEnabled={process.env.KINGPOS_PORTABLE_DRAFT_OUTBOX === "1"}
            liveDraft={data.liveDraft}
            salonLogoUrl={data.salonLogoUrl}
            salonName={data.salonName}
            services={data.services}
            staff={data.staff}
            surface="portable"
            today={data.today}
            waitingVisits={data.waitingVisits}
          />
        </div>
      </div>
    </section></SingleWorkspaceWindow>
  );
}
