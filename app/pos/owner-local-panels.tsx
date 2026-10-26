"use client";

import { Activity, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OwnerLiveBookingWorkspace } from "@/app/bookings/owner-live-booking-workspace";
import { OwnerLiveTickets } from "@/app/pos-tickets/owner-live-tickets";
import { OwnerLiveReports } from "@/app/reports/owner-live-reports";
import { PortableCheckInClient } from "@/app/pos/portable/check-in/portable-check-in-client";
import { ownerSubmitAttendance } from "@/app/pos/owner-check-in-actions";
import { getAppLocalHost } from "@/lib/app-local-host";
import { useAppLocalResource, seedAppLocalResource } from "@/lib/app-local-resource";
import { usePosResourceRefresh } from "@/lib/pos-workspace-sync";
import { mergeStaffRoster } from "@/lib/portable-staff-roster";
import { WorkspaceText } from "@/components/workspace-language";
import { LumiLoadingStatus } from "@/components/lumi-loading-status";
import { WorkLogFilters } from "@/app/pos-tickets/work-log-filters";
import { ownerLocalHref, ownerLocalReadArgs, ownerLocalReadName, type OwnerLocalPanelData } from "@/lib/owner-local-workspace";
import { saveOwnerLocalSnapshot, useOwnerLocalWorkspace } from "./owner-local-workspace";

type Navigate = (href: string) => void;
type AttendanceAction = typeof ownerSubmitAttendance;
/** Serializable DTO in, existing business view out. Native can inject its named action. */
export function OwnerLocalPanelBody({ data, snapshotAt, query, navigate, attendanceAction = ownerSubmitAttendance, onAttendanceSettled, active=true, ticketsPath="/pos/ticket" }: { data: OwnerLocalPanelData; snapshotAt: number; query: string; navigate: Navigate; attendanceAction?: AttendanceAction; onAttendanceSettled?: () => void; active?: boolean; ticketsPath?: string }) {
  const workspace = useOwnerLocalWorkspace();
  if (data.view === "denied") return <p className="p-6"><WorkspaceText text={data.message} /></p>;
  if (data.view === "check-in") return <PortableCheckInClient data={data.props.data} action={attendanceAction} workspacePath="/pos/check-in" staffEndpoint="/api/pos/owner/check-in" managedRead businessDate={workspace?.businessDate} onDataChange={workspace?.attendance} onAttendanceSettled={onAttendanceSettled} active={active} />;
  if (data.view === "bookings") return <OwnerLiveBookingWorkspace {...data.props} managedRead query={query} snapshotAt={snapshotAt} />;
  if (data.view === "reports") return <OwnerLiveReports {...data.props} managedRead query={query} snapshotAt={snapshotAt} />;
  if (data.view === "tickets") return <main className="mx-auto w-full max-w-7xl px-4 py-4 text-zinc-950 sm:px-6">
    {ticketsPath === "/pos-tickets" ? <WorkLogFilters query={data.props.searchQuery} selectedDate={data.props.selectedDate} todayHref={ticketsPath + "?date=" + data.props.today} /> : <form action={ticketsPath} method="get" className="mb-4 flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); const filters = new URLSearchParams(); new FormData(event.currentTarget).forEach((value, key) => { if (typeof value === "string") filters.append(key, value); }); navigate(ticketsPath + "?" + filters); }}>
      <label><WorkspaceText text="Date" /><input aria-label="Work log date" className="block rounded border p-2" type="date" name="date" defaultValue={data.props.selectedDate} /></label>
      <label><WorkspaceText text="Search" /><input aria-label="Search work log" className="block rounded border p-2" type="search" name="q" defaultValue={data.props.searchQuery} /></label>
      <button type="submit" className="self-end rounded bg-zinc-950 px-4 py-2 text-white"><WorkspaceText text="Search" /></button>
      <a className="self-end rounded border px-4 py-2" href={ticketsPath + "?date=" + data.props.today}><WorkspaceText text="Today" /></a>
    </form>}
    {new URLSearchParams(query).get("error") ? <p role="alert" className="text-rose-700">{new URLSearchParams(query).get("error")}</p> : null}
    <OwnerLiveTickets {...data.props} returnTo={ticketsPath + "?" + new URLSearchParams({ date: data.props.selectedDate, ...(data.props.searchQuery ? { q: data.props.searchQuery } : {}) })} managedRead snapshotAt={snapshotAt} />
  </main>;
  return null;
}

export function OwnerPanel({ href, active, scope, salonId, navigate, attendanceAction, ticketsPath }: { href: string; active: boolean; scope: string; salonId: string; navigate: Navigate; attendanceAction?: AttendanceAction; ticketsPath?: string }) {
  const name = ownerLocalReadName(href.split("?")[0]), args = ownerLocalReadArgs(href), query = String(args.query ?? "");
  const resource = useAppLocalResource<OwnerLocalPanelData>(scope, name, args);
  const current = useRef(resource);
  const lifetime = useRef({ generation: 0 });
  useEffect(() => { current.current = resource; }, [resource]);
  useEffect(() => { const state = lifetime.current; state.generation++; return () => { state.generation++; }; }, [scope, href]);
  usePosResourceRefresh(salonId, name === "owner.check-in" ? "staff" : name === "owner.tickets" ? "tickets" : name === "owner.bookings" ? "booking" : "report", async ids => {
    if (name !== "owner.check-in" || !ids?.length || current.current.data?.view !== "check-in") { await resource.refresh(); return; }
    const started = lifetime.current.generation, response = await getAppLocalHost().read<OwnerLocalPanelData>(name, { ...args, ids }, { scope });
    if (started !== lifetime.current.generation || response.scope !== scope || response.status !== 200 || response.data?.view !== "check-in" || current.current.data?.view !== "check-in") return;
    const previous = current.current.data.props.data, patch = response.data.props;
    if (patch.data.salonId !== salonId) return;
    const data: OwnerLocalPanelData = { view: "check-in", props: { data: { ...patch.data, staff: mergeStaffRoster(previous.staff, patch.data.staff, previous.today === patch.data.today ? ids : undefined) } } };
    const merged = { ...response, data }; seedAppLocalResource(scope, name, args, merged); await saveOwnerLocalSnapshot(scope, name, args, merged);
  }, { initialReconcile: false });
  usePosResourceRefresh(salonId, "settings", async () => { await resource.refresh(); }, { enabled: name === "owner.bookings", initialReconcile: false });
  usePosResourceRefresh(salonId, "catalog", async () => { await resource.refresh(); }, { enabled: name === "owner.bookings", initialReconcile: false });
  return <div hidden={!active} data-owner-local-panel={href}>
    {resource.data ? <OwnerLocalPanelBody data={resource.data} snapshotAt={resource.updatedAt} query={query} navigate={navigate} attendanceAction={attendanceAction} onAttendanceSettled={() => { void resource.refresh(); }} active={active} ticketsPath={ticketsPath} /> : <section className="p-6" aria-busy={resource.loading || resource.refreshing}>
      <h1 className="text-xl font-semibold"><WorkspaceText text={name === "owner.check-in" ? "Check In" : name === "owner.bookings" ? "Bookings" : name === "owner.tickets" ? "Tickets" : "Reports"} /></h1>
      {resource.error || typeof navigator !== "undefined" && !navigator.onLine ? <p className="mt-4 text-sm text-zinc-600"><WorkspaceText text="Connect to open this view. Your current ticket has been kept." /></p> : <LumiLoadingStatus />}
      {resource.error ? <button type="button" className="mt-3 rounded border px-4 py-2" onClick={() => void resource.refresh()}><WorkspaceText text="Try again" /></button> : null}
    </section>}
  </div>;
}

/** Actual authorized panels remain mounted; no LayoutRouter children are cached. */
export function OwnerLocalPanels({ scope, salonId, activeHref, navigate, attendanceAction }: { scope: string; salonId: string; activeHref: string; navigate: Navigate; attendanceAction?: AttendanceAction }) {
  const [paths, setPaths] = useState<string[]>(() => { const first=ownerLocalHref(activeHref);return first&&first!=="/pos"?[first]:[]; });
  const active = ownerLocalHref(activeHref);
  if (active && active !== "/pos" && !paths.includes(active)) setPaths([...paths.slice(-14), active]);
  return <>{paths.map(href => href.split("?")[0]==="/pos/check-in"?<OwnerPanel key={href} href={href} active={href===active} scope={scope} salonId={salonId} navigate={navigate} attendanceAction={attendanceAction}/>:<Activity key={href} mode={href===active?"visible":"hidden"}><OwnerPanel href={href} active={href === active} scope={scope} salonId={salonId} navigate={navigate} attendanceAction={attendanceAction} /></Activity>)}</>;
}

const locationEvent = "reylumi:owner-location";
function subscribeLocation(changed: () => void) { window.addEventListener("popstate", changed); window.addEventListener(locationEvent, changed); return () => { window.removeEventListener("popstate", changed); window.removeEventListener(locationEvent, changed); }; }
/** Next wrapper; the standalone host passes its activeHref/navigate directly. */
export function OwnerLocalPanelsOutlet({ scope, salonId, attendanceAction }: { scope: string; salonId: string; attendanceAction?: AttendanceAction }) {
  const href = useSyncExternalStore(subscribeLocation, () => location.pathname + location.search, () => null);
  if (!href) return null;
  return <OwnerLocalPanels scope={scope} salonId={salonId} activeHref={href} attendanceAction={attendanceAction} navigate={target => { const path = ownerLocalHref(target); if (path) { window.history.pushState(null, "", path); window.dispatchEvent(new Event(locationEvent)); } }} />;
}
