"use client";

import { Activity, useState } from "react";
import { PortableWorkspaceStateProvider } from "@/app/pos/portable/portable-workspace-state";
import { PortableWorkspaceTabs } from "@/app/pos/portable/portable-workspace-tabs";
import { PortableTouchKeyboard } from "@/app/pos/portable/touch-keyboard";
import { PortableCheckInClient } from "@/app/pos/portable/check-in/portable-check-in-client";
import { PortableBookWorkspace } from "@/app/pos/portable/book/portable-book-workspace";
import { PortableTicketClient } from "@/app/pos/portable/ticket/portable-ticket-client";
import { PosDeskClient } from "@/app/pos/pos-desk-client";
import { PosRapidMobileBridge } from "@/app/pos/pos-rapid-mobile-bridge";
import { SingleWorkspaceWindow } from "@/app/pos/single-workspace-window";
import { PrepareWorkspaceDevice } from "@/app/pos/portable/prepare-workspace-device";
import { DeskRelay } from "@/app/service-relay/desk-relay";
import { AppLocalPortableReport } from "./app-local-portable-report";
import styles from "@/app/pos/pos-rapid-mobile.module.css";
import { PORTABLE_POS_ROUTE_LINKS } from "@/lib/pos-portable-routes";
import { PORTABLE_POS_CAPABILITIES } from "@/lib/pos-portable-capabilities";
import type { PortablePosCapability } from "@/lib/pos-portable-capabilities";
import { useAppLocalResource } from "@/lib/app-local-resource";
import { getAppLocalHost } from "@/lib/app-local-host";
import type { AppLocalPageProps } from "@/lib/app-local-page-registry";
import type { AppLocalPortableContext, AppLocalPortableWorkspaceData, AppLocalPortableCheckInData, AppLocalPortableBookData, AppLocalPortableTicketData, AppLocalPortableReportData } from "@/lib/app-local-portable-metadata";
import {
  portableLoadServiceRelay, portableSubmitServiceRelay, portableSubmitAttendanceEvent,
  portableCreateAppointment, portableBookingSlots, portableBookingHours, portableBookingAppointments, portableBookingStaffOptions, portableManageBooking, portableSearchBookingCustomers,
  portableCreatePosDeskCustomer, portableGetPosLiveDraft, portableSearchPosDeskCustomers, portableAdjustStaffTurn, portableCancelWaitingVisitForPos, portableSubmitPosDeskReceipt, portableSelectWaitingVisitForPos, portableResolveScannedCheckinReceipt, portableUpdatePosActiveDraft, portableUpdatePosLiveDraftCustomer,
} from "@/app/pos/portable/actions";

type Area = "pos" | "check-in" | "book" | "ticket" | "report";
const capability: Record<Area, PortablePosCapability> = { pos: PORTABLE_POS_CAPABILITIES.posUse, "check-in": PORTABLE_POS_CAPABILITIES.checkInUse, book: PORTABLE_POS_CAPABILITIES.bookView, ticket: PORTABLE_POS_CAPABILITIES.todayView, report: PORTABLE_POS_CAPABILITIES.reportView };
const areaPath = (area: Area) => "/pos/portable" + (area === "pos" ? "" : "/" + area);
function AreaView({ area, path, context }: { area: Area; path: string; context: AppLocalPortableContext }) {
  const url = new URL(path, "https://reylumi.com"), args = ["book", "ticket", "report"].includes(area) && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "") ? { date: url.searchParams.get("date")! } : {};
  const resource = useAppLocalResource(context.context.scope, "portable." + (area === "pos" ? "workspace" : area), args);
  const data = resource.data;
  if (area === "pos" && !context.portable.devicePrepared) return <PrepareWorkspaceDevice />;
  if (!data) return <section className="grid h-full place-items-center p-6" aria-busy={resource.loading || resource.refreshing}><div><h2 className="text-xl font-semibold">{area === "check-in" ? "Check-in" : area === "pos" ? "POS" : area[0].toUpperCase() + area.slice(1)}</h2>{resource.error ? <><p role="alert" className="mt-3">{resource.error}</p><button className="mt-4 rounded border px-4 py-2" onClick={() => void resource.refresh()}>Try again</button></> : <p role="status" className="mt-3">Opening…</p>}</div></section>;
  if (area === "check-in") return <PortableCheckInClient action={portableSubmitAttendanceEvent} data={data as AppLocalPortableCheckInData} />;
  if (area === "book") return <div className="h-full" data-portable-pos-page="book"><PortableBookWorkspace refreshAction={portableBookingAppointments} hoursAction={portableBookingHours} staffOptionsAction={portableBookingStaffOptions} action={portableCreateAppointment} slotsAction={portableBookingSlots} manageAction={portableManageBooking} data={data as AppLocalPortableBookData} searchCustomersAction={portableSearchBookingCustomers} /></div>;
  if (area === "ticket") { const ticket = data as AppLocalPortableTicketData; return <PortableTicketClient key={ticket.date + ":" + (url.searchParams.get("q") ?? "")} initialData={ticket} followToday={!args.date} error={url.searchParams.get("error") ?? undefined} searchQuery={url.searchParams.get("q")?.trim() ?? ""} />; }
  if (area === "report") return <AppLocalPortableReport data={data as AppLocalPortableReportData} />;
  const desk = data as AppLocalPortableWorkspaceData;
  return <SingleWorkspaceWindow id="portable-pos"><DeskRelay salonId={desk.salonId} load={portableLoadServiceRelay} submit={portableSubmitServiceRelay} /><section className="h-full min-h-0 overflow-hidden p-2 max-md:p-0" data-portable-pos-page="pos"><div className={styles.rapidHost} data-pos-rapid-host><PosRapidMobileBridge staffCheckInEnabled={desk.defaults.staffCheckInEnabled} services={desk.services} staff={desk.staff} /><div className={styles.engine} data-pos-rapid-engine><PosDeskClient actions={{ adjustStaffTurn: portableAdjustStaffTurn, cancelWaitingVisitForPos: portableCancelWaitingVisitForPos, createPosDeskCustomer: portableCreatePosDeskCustomer, getPosLiveDraft: portableGetPosLiveDraft, searchPosDeskCustomers: portableSearchPosDeskCustomers, selectWaitingVisitForPos: portableSelectWaitingVisitForPos, resolveScannedCheckinReceipt: portableResolveScannedCheckinReceipt, submitPosDeskReceipt: portableSubmitPosDeskReceipt, updatePosActiveDraft: portableUpdatePosActiveDraft, updatePosLiveDraftCustomer: portableUpdatePosLiveDraftCustomer }} activeSession={null} defaults={desk.defaults} offlineDraftSyncEnabled={context.portable.offlineEnabled} liveDraft={desk.liveDraft} salonLogoUrl={desk.salonLogoUrl} salonName={desk.salonName} services={desk.services} staff={desk.staff} surface="portable" today={desk.today} waitingVisits={desk.waitingVisits} /></div></div></section></SingleWorkspaceWindow>;
}

/** One original device provider owns all retained daily panels and their existing outbox. */
export function AppLocalPortableWorkspace(props: AppLocalPageProps) {
  const context = props.context as AppLocalPortableContext | null, descriptor = context?.portable, pathname = new URL(props.path, "https://reylumi.com").pathname;
  const active: Area = pathname === "/pos/portable" ? "pos" : pathname.endsWith("/today") ? "ticket" : pathname.split("/").at(-1) as Area;
  const [visited, setVisited] = useState<Partial<Record<Area, string>>>({ [active]: props.path });
  if (visited[active] !== props.path) setVisited({ ...visited, [active]: props.path });
  if (!context || !descriptor || context.grant?.kind !== "portable" || context.context.scope !== descriptor.scope || context.grant.scope !== descriptor.scope) return <main className="grid h-full place-items-center p-6"><div><h1 className="text-2xl font-semibold">Portable POS</h1><p className="mt-3">Open this POS with its POS ID and passcode.</p><button className="mt-4 rounded border px-4 py-2" onClick={() => void (props.host ?? getAppLocalHost()).openOnline("/pos/portable")}>Open Portable POS</button></div></main>;
  const allowed = (Object.keys(capability) as Area[]).filter(area => descriptor.capabilities.includes(capability[area]));
  const links = PORTABLE_POS_ROUTE_LINKS.filter(link => allowed.some(area => areaPath(area) === link.href));
  return <main className="portable-kiosk-surface relative flex h-dvh w-full flex-col overflow-hidden bg-zinc-100 text-zinc-950" data-portable-pos-shell data-portable-shell data-pos-persistent-workspace>
    <PortableWorkspaceStateProvider key={descriptor.scope} scope={descriptor.scope} offlineEnabled={descriptor.offlineEnabled} preparedAt={descriptor.preparedAt} timezone={descriptor.timeZone}>
      <PortableWorkspaceTabs localPanels items={links} salonId={descriptor.salonId} salonLogoUrl={descriptor.salonLogoUrl} salonName={descriptor.salonName} salonTimezone={descriptor.timeZone} canConfirmBookings={descriptor.capabilities.includes(PORTABLE_POS_CAPABILITIES.bookCreate)} />
      <div className="relative min-h-0 flex-1 overflow-hidden">{!allowed.includes(active) ? <section role="alert" className="p-6">This POS device does not have access to this view.</section> : null}{allowed.map(area => {
        if (!visited[area] && area !== active) return null;
        const panel = <AreaView area={area} path={area === active ? props.path : visited[area]!} context={context} />;
        // The live cart must retain its original exclusive workspace lock and
        // outbox writer while another daily tab is visible.
        return area === "pos" ? <div key={descriptor.scope + ":pos"} hidden={active !== "pos"} style={active !== "pos" ? { display: "none" } : undefined} className="h-full min-h-0" data-local-portable-panel="pos">{panel}</div>
          : <Activity key={descriptor.scope + ":" + area} mode={area === active ? "visible" : "hidden"}><div className="h-full min-h-0" data-local-portable-panel={area}>{panel}</div></Activity>;
      })}</div>
      <PortableTouchKeyboard enabled={descriptor.touchKeyboardEnabled} />
    </PortableWorkspaceStateProvider>
  </main>;
}
