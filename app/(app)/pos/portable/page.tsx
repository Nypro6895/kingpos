import { PosDeskClient } from "@/app/pos/pos-desk-client";
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
    <section
      className="h-full min-h-0 overflow-hidden p-2"
      data-portable-pos-page="pos"
    >
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
        liveDraft={data.liveDraft}
        salonLogoUrl={data.salonLogoUrl}
        salonName={data.salonName}
        services={data.services}
        staff={data.staff}
        surface="portable"
        today={data.today}
        waitingVisits={data.waitingVisits}
      />
    </section>
  );
}
