"use client";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { posUserMessage } from "@/lib/pos-user-messages";
import { mergeBookingSnapshots, reconcileBookingOperations } from "@/lib/portable-booking-state";
import { openBookingInPortablePos } from "@/lib/portable-booking-ticket";

import { bookingDate as dateKey, bookingDayInterval } from "@/lib/portable-booking-layout";
import { BookingEditor, type BookingEditField, type StaffOptionsAction } from "./booking-editor";
import type { BookingOpeningHours } from "@/lib/booking-calendar-window";
import { dismissPortableKeyboard } from "@/lib/portable-touch-input";
import { BookingViews } from "./booking-views";
import styles from "./booking.module.css";
import { CustomerLookup, type BookingCustomerSearch } from "./customer-lookup";
import type { PosDeskCustomer } from "@/types/pos-desk";

import { portableBookingTime } from "@/lib/portable-booking-time";
import { bookingInputBounds, defaultBookingStart, DEFAULT_BOOKING_TIME_POLICY, validateBookingStart } from "@/lib/booking-time-policy";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  PortableBookAppointment,
  PortableBookingSlot,
  PortableBookData,
  PortableCreateAppointmentInput,
} from "@/app/pos/portable/actions";

import { usePortableWorkspaceState } from "@/app/pos/portable/portable-workspace-state";
import { listPortableOperations, savePortableOperation, PORTABLE_OPERATIONS_CHANGED } from "@/lib/portable-operations";

type Result =
  | { data: PortableBookAppointment; error?: never; ok: true }
  | { data?: never; error: string; ok: false };

type Props = {
  refreshAction?: (date: string) => Promise<PortableBookAppointment[]>;
  hoursAction?: (date: string) => Promise<BookingOpeningHours>;
  staffOptionsAction?: StaffOptionsAction;
  action: (input: PortableCreateAppointmentInput) => Promise<Result>;
  data: PortableBookData;
  searchCustomersAction?: BookingCustomerSearch;
  slotsAction?: (input: { serviceId: string; serviceIds?: string[]; staffIds?: (string | null)[]; staffId: string; date: string; bookingId?: string }) => Promise<PortableBookingSlot[]>;
  manageAction?: (input: { bookingId: string; action: "read" | "edit" | "confirm" | "cancel" | "ticket"; payload?: Record<string, unknown> }) => Promise<Result>;
};

type Range = "all" | "day" | "next7";
type View = "list" | "calendar";

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function PortableBookWorkspace({ action, data, searchCustomersAction, slotsAction, manageAction, hoursAction, staffOptionsAction, refreshAction }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const workspace = usePortableWorkspaceState();
  const [appointments, setAppointments] = useState(data.appointments);
  const [serverSnapshot, setServerSnapshot] = useState(data.appointments);
  if (serverSnapshot !== data.appointments) {
    setServerSnapshot(data.appointments);
    setAppointments(current => mergeBookingSnapshots(current, data.appointments));
  }
  const [range, setRange] = useState<Range>("day");
  const [selectedDate, setSelectedDate] = useState(data.date);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<View>("list");
  const [calendarFocusRequest, setCalendarFocusRequest] = useState(0);
  useEffect(() => {
    if (!refreshAction) return;
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading || !navigator.onLine || document.visibilityState !== "visible" || !rootRef.current?.getClientRects().length) return;
      loading = true;
      try {
        const rows = await refreshAction(selectedDate);
        if (active) setAppointments(current => mergeBookingSnapshots(current, rows));
      } catch { /* Keep the last known bookings available while offline. */ }
      finally { loading = false; }
    };
    const unsubscribe=workspace?subscribePosChanges(workspace.scope.split(":")[0],change=>{if(change.resource==="booking")void refresh();}):()=>{};
    const frame = requestAnimationFrame(() => void refresh());
    const timer = setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; unsubscribe(); cancelAnimationFrame(frame); clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [refreshAction, selectedDate, calendarFocusRequest, workspace?.scope]);
  useEffect(() => {
    // Panels stay mounted, so a repeated click on Book must also recenter the calendar.
    function activateBook(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>('nav[aria-label="POS workspace"] a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== location.origin || url.pathname !== "/pos/portable/book" || url.search || url.hash) return;
      setSelectedDate(dateKey(new Date().toISOString(), data.timezone));
      setRange("day");
      setCalendarFocusRequest(value => value + 1);
    }
    document.addEventListener("click", activateBook);
    return () => document.removeEventListener("click", activateBook);
  }, [data.timezone]);
  const filterRef = useRef<HTMLDetailsElement>(null);
  const [notes, setNotes] = useState("");
  const [editorField, setEditorField] = useState<BookingEditField>();
  const [openingHours, setOpeningHours] = useState<BookingOpeningHours | undefined>(data.openingHours);
  const [showCreate, setShowCreate] = useState(false);
  useEffect(() => {
    if (!hoursAction) return;
    let active = true;
    hoursAction(selectedDate).then(hours => {if(active) setOpeningHours(hours);}).catch(() => {if(active) setOpeningHours({date:selectedDate,source:"unavailable",intervals:[]});});
    return () => {active=false;};
  },[hoursAction,selectedDate]);
  const requestRef = useRef<{ requestId: string; requestedAt: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>(data.services[0] ? [data.services[0].id] : []);
  const serviceId = serviceIds[0] ?? "";
  const [editing, setEditing] = useState<PortableBookAppointment | null>(null);
  const [statusTarget, setStatusTarget] = useState<PortableBookAppointment | null>(null);
  const latestEditing = appointments.find(item => item.id === editing?.id) ?? editing;
  const editingChanged = !!editing && !!latestEditing && (editing.updatedAt !== latestEditing.updatedAt || editing.status !== latestEditing.status || editing.ticketId !== latestEditing.ticketId);
  const latestStatusTarget = appointments.find(item => item.id === statusTarget?.id) ?? statusTarget;
  const [cancelReason, setCancelReason] = useState("");
  const [staffId, setStaffId] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<"auto" | "shared" | "individual">(data.bookingPolicy?.autoAssignEnabled === false ? "shared" : "auto");
  const [serviceStaff, setServiceStaff] = useState<Record<string, string>>({});
  const staffIds = useMemo(() => serviceIds.map(id => assignmentMode === "shared" ? staffId || null : assignmentMode === "individual" ? serviceStaff[id] || null : null), [serviceIds, assignmentMode, staffId, serviceStaff]);
  const [startAt, setStartAt] = useState("");
  const [clock, setClock] = useState(0);
  const [slotResponse, setSlotResponse] = useState<{key: string; rows: PortableBookingSlot[]}>({key:"",rows:[]});
  const [slotMessage, setSlotMessage] = useState("");
  const selectedBookingDay = startAt.slice(0,10);
  const slotRequestKey = JSON.stringify([selectedBookingDay, serviceIds, staffIds, staffId, editing?.id, showCreate]);
  const slots = slotResponse.key === slotRequestKey ? slotResponse.rows : [];
  useEffect(() => {
    if (!showCreate || !slotsAction || !selectedBookingDay || !serviceId) return;
    let active = true;
    const timer = setTimeout(() => {
      setSlotMessage("Loading available times…");
      setSlotResponse({key:slotRequestKey,rows:[]});
      slotsAction({serviceId, serviceIds, staffIds, staffId, date: selectedBookingDay, bookingId: editing?.id}).then(rows => {
        if (active) { setSlotResponse({key:slotRequestKey,rows}); setSlotMessage(rows.length ? "Available times" : "No available times. Choose another day or check service assignments and working hours in Booking Settings."); }
      }).catch(() => { if (active) { setSlotResponse({key:slotRequestKey,rows:[]}); setSlotMessage("Available times could not be checked. The salon will validate this appointment when connected."); } });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [showCreate, slotsAction, selectedBookingDay, serviceId, serviceIds, staffIds, staffId, editing?.id, slotRequestKey]);
  const policy = data.bookingPolicy ?? DEFAULT_BOOKING_TIME_POLICY;
  const inputBounds = clock ? bookingInputBounds(policy, data.timezone, clock) : undefined;

  const selectedSlot = slots.find(slot => `${selectedBookingDay}T${slot.label}` === startAt);

  function openCreate(customer?: PosDeskCustomer) {
    if(showCreate) return;
    setCustomerId(customer?.id);setCustomerName(customer?.name??"");setCustomerPhone(customer?.phone??"");setCustomerEmail(customer?.email??"");
    dismissPortableKeyboard(); setNotes(""); setEditorField(undefined); setServiceIds([]);
    setEditing(null);
    setAssignmentMode(policy.autoAssignEnabled === false ? "shared" : "auto"); setStaffId(""); setServiceStaff({});
    const now = Date.now();
    requestRef.current = { requestId: crypto.randomUUID(), requestedAt: new Date(now).toISOString() };
    setClock(now);
    setStartAt(defaultBookingStart(selectedDate, policy, data.timezone, now));
    setError("");
    setShowCreate(true);
  }

  function replaceAppointment(item: PortableBookAppointment) {
    setAppointments(current => mergeBookingSnapshots(current, [item]));
  }

  function loadAppointment(item: PortableBookAppointment, mode: "edit" | "status" | "ticket", field?: BookingEditField) {
    if (!manageAction || isPending) return;
    if(showCreate) {setError("Save or close the current appointment before opening another.");return;}
    dismissPortableKeyboard();
    setError("");
    startTransition(async () => {
      try {
        if (workspace?.offlineEnabled) {
          const operations = await listPortableOperations(workspace.scope);
          if (operations.some(operation => operation.kind === "receipt" && operation.payload.sourceBookingId === item.id && ["pending", "attention"].includes(operation.state))) {
            setError("This appointment already has a ticket waiting to sync. Resolve it in Ticket before making further changes."); return;
          }
        }
        const result = await manageAction({ bookingId: item.id, action: mode === "ticket" ? "ticket" : "read" });
        if (!result.ok) { setError(result.error); return; }
        const next = result.data;
        replaceAppointment(next);
        if (mode === "ticket") { openBookingInPortablePos(next); return; }
        if (mode === "status") { setStatusTarget(next); setCancelReason(""); return; }
        if (next.ticketId || !["pending", "scheduled", "confirmed"].includes(next.status)) {
          setError("This appointment has changed and can no longer be edited here. Its latest status is now shown."); return;
        }
        setEditorField(field);setNotes(next.notes ?? "");
        setEditing(next); setCustomerName(next.customerName ?? "");
        setCustomerId(next.customerId); setCustomerPhone(next.customerPhone ?? ""); setCustomerEmail(next.customerEmail ?? "");
        setServiceIds(next.serviceIds ?? []); setStaffId(next.staffId ?? "");
        setAssignmentMode(next.staffId ? "shared" : "individual");
        setServiceStaff(Object.fromEntries((next.lines ?? []).map(line => [line.serviceId, line.staffId])));
        setStartAt(new Intl.DateTimeFormat("sv-SE", { timeZone: data.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(next.startAt)).replace(" ", "T"));
        setClock(Date.now()); setShowCreate(true);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open appointment."); }
    });
  }

  function changeStatus(next: "confirm" | "cancel") {
    if (!manageAction || !latestStatusTarget) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await manageAction({bookingId: latestStatusTarget.id, action: next, payload: { updatedAt: latestStatusTarget.updatedAt, reason: cancelReason }});
        if (!result.ok) { setError(result.error); return; }
        replaceAppointment(result.data); setStatusTarget(null);
        if(editing?.id===result.data.id) {setEditing(result.data);if(next==="cancel") setShowCreate(false);}
      } catch { setError("Unable to update status. Reopen the appointment to check its latest status."); }
    });
  }

  useEffect(() => {
    if (!showCreate) return;
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [showCreate]);

  function selectCustomer(customer: PosDeskCustomer) {
    setCustomerId(customer.id);
    setCustomerName(customer.name ?? "");
    setCustomerPhone(customer.phone ?? "");
    setCustomerEmail(customer.email ?? "");
  }

  useEffect(() => {
    if (!workspace?.scope) return;
    let active = true;
    const refresh = () => { void listPortableOperations(workspace.scope).then(rows => {
      if (!active) return;
      setAppointments(current => reconcileBookingOperations(current, rows));
    }).catch(() => {}); };
    refresh(); window.addEventListener(PORTABLE_OPERATIONS_CHANGED, refresh);
    return () => { active = false; window.removeEventListener(PORTABLE_OPERATIONS_CHANGED, refresh); };
  }, [workspace?.scope]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) filterRef.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && filterRef.current?.open) {
        filterRef.current.open = false;
        filterRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);

  const visible = useMemo(() => {
    const endDate = addDays(selectedDate, 7);
    const normalizedQuery = query.trim().toLowerCase();

    return appointments.filter((appointment) => {
      const appointmentDate = dateKey(appointment.startAt, data.timezone);
      const dateMatches =
        view === "calendar" ? !!bookingDayInterval(appointment, selectedDate, data.timezone) : range === "all" ||
        (range === "day" && appointmentDate === selectedDate) ||
        (range === "next7" &&
          appointmentDate >= selectedDate &&
          appointmentDate < endDate);
      const statusMatches =
        status === "all" ||
        (status === "confirmed" &&
          ["confirmed", "scheduled"].includes(appointment.status)) ||
        appointment.status === status;
      const searchMatches =
        !normalizedQuery ||
        [
          appointment.customerName,
          appointment.customerPhone,
          appointment.staffName,
          ...appointment.serviceNames,
        ].some((value) => value?.toLowerCase().includes(normalizedQuery));

      return dateMatches && statusMatches && searchMatches;
    }).sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [appointments, data.timezone, query, range, selectedDate, status, view]);

  function submitAppointment() {
    if (editingChanged) return;
    setError("");
    startTransition(async () => {
      try {
      const salonStart = portableBookingTime(startAt, data.timezone);
      if (!salonStart) { setError("Choose a valid time for this salon."); return; }
      const timeError = editing && Date.parse(salonStart) === Date.parse(editing.startAt) ? null : validateBookingStart(salonStart, policy, data.timezone);
      if (timeError) { setError(timeError); return; }
      const input = {
        ...requestRef.current,
        notes,
        customerId,
        customerEmail,
        customerName,
        customerPhone,
        serviceId,
        serviceIds,
        staffId,
        staffIds,
        startAt: salonStart,
      };
      const selectedServices = serviceIds.map(id => data.services.find(row => row.id === id));
      const localAppointment: PortableBookAppointment = { id: crypto.randomUUID(), customerName, customerPhone, customerId, customerEmail, notes,
        lines: selectedSlot?.lines?.map((line,index)=>({...line,id:`pending-${index}`,price:line.price??data.services.find(service=>service.id===line.serviceId)?.base_price??0})),
        startAt: input.startAt, endAt: selectedSlot?.endAt ?? new Date(Date.parse(input.startAt) + selectedServices.reduce((sum, service) => sum + (service?.duration_minutes ?? 30), 0) * 60000).toISOString(),
        serviceIds, staffId: assignmentMode === "shared" ? staffId || null : null, serviceNames: selectedServices.map(service => service?.name ?? "Service"), staffName: selectedSlot?.staffName ?? ([...new Set(staffIds.map(id => data.staff.find(row => row.id === id)?.display_name).filter(Boolean))].join(", ") || null), status: "pending" };
      const result: Result = editing && manageAction ? await manageAction({bookingId: editing.id, action: "edit", payload: {notes,customerId,serviceIds,staffId,staffIds,startAt:salonStart,updatedAt:editing.updatedAt}}) : workspace?.offlineEnabled ? (await savePortableOperation(workspace.scope, "booking", { ...input, localAppointment }), { ok: true, data: localAppointment }) : await action(input);

      if (!result.ok) {
        setError(posUserMessage(result.error));
        return;
      }

      replaceAppointment(result.data);
      setSelectedDate(dateKey(result.data.startAt, data.timezone));
      setRange("day");
      setShowCreate(false);
      setCustomerId(undefined);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      } catch { setError("Unable to save appointment on this device. Please try again."); }
    });
  }

  return (
    <section ref={rootRef} className={styles.workspace} aria-label="Booking">
      <section className={styles.panel}>
        <div className={styles.toolbar} aria-label="Booking toolbar" inert={showCreate}>
          <div className={styles.dateControls}>
            <button type="button" onClick={() => { setSelectedDate(dateKey(new Date().toISOString(), data.timezone)); setRange("day"); setCalendarFocusRequest(value => value + 1); }}>Today</button>
            <button type="button" aria-label="Previous day" onClick={() => setSelectedDate(current => addDays(current, -1))}>‹</button>
            <input aria-label="Selected date" type="date" value={selectedDate} onChange={event => { if (event.target.value) setSelectedDate(event.target.value); }} />
            <button type="button" aria-label="Next day" onClick={() => setSelectedDate(current => addDays(current, 1))}>›</button>
          </div>
          {searchCustomersAction && data.canCreate ? <CustomerLookup className={styles.search}
            label="Search appointments" placeholder="Search customer name or phone" value={query} onChange={setQuery}
            search={searchCustomersAction} onSelect={customer => {
              setQuery(""); openCreate(customer);
            }} /> : <input className={styles.search} type="search" aria-label="Search appointments" placeholder="Search customer, service or staff" value={query} onChange={event => setQuery(event.target.value)} />}
          <details className={styles.filter} ref={filterRef}>
            <summary data-active={status !== "all" || (view === "list" && range !== "day")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
              Filter{status !== "all" || (view === "list" && range !== "day") ? " •" : ""}
            </summary>
            <div className={styles.filterPanel}>
              <label>Status<select aria-label="Status" value={status} onChange={event => setStatus(event.target.value)}>
                <option value="all">All statuses</option><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="checked_in">Arrived</option><option value="in_service">In service</option>
              </select></label>
              {view === "list" && <label>Date range<select aria-label="Date range" value={range} onChange={event => setRange(event.target.value as Range)}>
                <option value="day">Selected day</option><option value="next7">Next 7 days</option><option value="all">All loaded appointments</option>
              </select></label>}
              <button type="button" onClick={() => { setStatus("all"); setRange("day"); setQuery(""); }}>Clear filters</button>
            </div>
          </details>
          <div className={styles.views} role="group" aria-label="Booking view">
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
            <button type="button" aria-pressed={view === "calendar"} onClick={() => { setView("calendar"); setCalendarFocusRequest(value => value + 1); }}>Calendar</button>
          </div>
          {data.canCreate && <button className={styles.create} type="button" onClick={()=>openCreate()}>+ New appointment</button>}
        </div>
        {data.setupMessage ? <p className="px-3 py-2 text-sm text-amber-800" role="status">{data.setupMessage}</p> : null}
        {error && !showCreate && !statusTarget && <p role="alert" className="px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className={styles.bookingBody} data-editing={showCreate}><div className={styles.bookingContent}><BookingViews focusRequest={calendarFocusRequest} openingHours={openingHours} actions={manageAction ? { edit: data.canCreate ? (item, field) => loadAppointment(item, "edit", field) : undefined, status: data.canCreate || data.canCancel ? item => loadAppointment(item, "status") : undefined, ticket: data.canCreateTicket ? item => loadAppointment(item, "ticket") : undefined } : undefined} appointments={visible} data={data} date={selectedDate} view={view} showDates={range !== "day"} /></div>
        {showCreate && <BookingEditor key={editing?.id ?? "new"} data={data} editing={latestEditing} stale={editingChanged} initialField={editorField}
          customerId={customerId} customerName={customerName} customerPhone={customerPhone} customerEmail={customerEmail}
          onContact={(field,value)=>{if(field==="name") {setCustomerName(value);setCustomerId(undefined);}else if(field==="phone") {setCustomerPhone(value);setCustomerId(undefined);}else setCustomerEmail(value);}}
          onCustomer={selectCustomer} searchCustomersAction={searchCustomersAction} serviceIds={serviceIds} staffIds={staffIds}
          onServices={ids=>{setServiceStaff(Object.fromEntries(serviceIds.map((id,index)=>[id,staffIds[index]??""])));setAssignmentMode("individual");setServiceIds(ids);}}
          onStaff={(index,id)=>{setServiceStaff(Object.fromEntries(serviceIds.map((service,i)=>[service,index===-1||index===i ? id??"" : staffIds[i]??""])));setAssignmentMode("individual");setStaffId("");}}
          startAt={startAt} onTime={setStartAt} bounds={inputBounds} slots={slots} selectedSlot={selectedSlot} slotMessage={slotResponse.key===slotRequestKey ? slotMessage : "Checking available times…"}
          notes={notes} onNotes={setNotes} staffOptionsAction={staffOptionsAction} busy={isPending} error={error}
          onClose={()=>{dismissPortableKeyboard();setShowCreate(false);setError("");}} onSave={submitAppointment}
          onStatus={editing && (data.canCreate || data.canCancel) ? ()=>{dismissPortableKeyboard();setStatusTarget(editing);setCancelReason("");setError("");} : undefined} />}
        </div>
      </section>

      {latestStatusTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" style={{bottom:"var(--portable-keyboard-height, 0px)"}} role="dialog" aria-modal="true" aria-label="Appointment status"><div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">{latestStatusTarget.customerName} · {latestStatusTarget.status}</h2><label className="mt-3 grid gap-1 text-sm">Cancellation reason (optional)<input className="h-11 rounded border px-3" value={cancelReason} onChange={e => setCancelReason(e.target.value)} /></label>{error && <p role="alert" className="mt-3 text-red-700">{error}</p>}<div className="mt-4 flex flex-wrap gap-2">{data.canCreate && !latestStatusTarget.ticketId && latestStatusTarget.status === "pending" && <button type="button" className="rounded bg-teal-700 px-4 py-3 text-white" disabled={isPending} onClick={() => changeStatus("confirm")}>Confirm appointment</button>}{data.canCancel && !latestStatusTarget.ticketId && ["pending","scheduled","confirmed","checked_in"].includes(latestStatusTarget.status) && <button type="button" className="rounded border border-red-300 px-4 py-3 text-red-700" disabled={isPending} onClick={() => changeStatus("cancel")}>Cancel appointment</button>}<button type="button" className="rounded border px-4 py-3" disabled={isPending} onClick={() => {setStatusTarget(null);setError("");}}>Close</button></div></div></div>}

    </section>
  );
}
