"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import { CustomerName } from "@/components/customer-name";

import { useEffect, useRef, useState } from "react";
import type { PortableBookAppointment, PortableBookData } from "@/app/pos/portable/actions";
import { bookingDate } from "@/lib/portable-booking-layout";
import { BookingDayCalendar } from "./booking-day-calendar";
import type { BookingEditField } from "./booking-editor";
import type { BookingOpeningHours } from "@/lib/booking-calendar-window";
import styles from "./booking.module.css";

export function displayBookingTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value));
}

export function statusLabel(status: string) {
  if (status === "checked_in") return "Arrived";
  if (status === "in_service") return "In service";
  if (status === "scheduled") return "Confirmed";
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}

function duration(item: PortableBookAppointment) {
  return `${Math.max(0, Math.round((Date.parse(item.endAt) - Date.parse(item.startAt)) / 60000))} min`;
}

function professionals(item: PortableBookAppointment) {
  return [...new Set(item.lines?.map(line => line.staffName).filter(Boolean) ?? [])].join(", ") || item.staffName || "Unassigned";
}
function Avatar({name}: {name: string | null}) { return <span className={styles.avatar} aria-hidden="true">{(name || "?").trim().slice(0,1).toUpperCase()}</span>; }

function Status({ value, kind }: { value: string; kind?: import("@/lib/booking-no-show").NoShowKind }) {
  return <span className={styles.status} data-status={value}><WorkspaceText text={value === "no_show" ? bookingStatusLabel(value, kind) : statusLabel(value)} /></span>;
}

type BookingActions = { edit?: (item: PortableBookAppointment, field?: BookingEditField) => void; status?: (item: PortableBookAppointment) => void; ticket?: (item: PortableBookAppointment) => void };
function AppointmentDetails({ item, timezone, close, actions }: {
  actions: BookingActions;
  item: PortableBookAppointment; timezone: string; close: () => void;
}) {
  const __vt = useWorkspaceTranslation();

  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={styles.dialog} onClose={close} aria-labelledby="booking-details-title">
    <div className={styles.dialogHeading}>
      <h2 id="booking-details-title"><CustomerName name={item.customerName} fallback="Walk-in customer" /></h2>
      <button type="button" onClick={close} aria-label={__vt("Close appointment details")} autoFocus>×</button>
    </div>
    <dl className={styles.details}>
      <dt><WorkspaceText text="Date" /></dt><dd>{bookingDate(item.startAt, timezone)}</dd>
      <dt><WorkspaceText text="Time" /></dt><dd>{displayBookingTime(item.startAt, timezone)} – {displayBookingTime(item.endAt, timezone)}</dd>
      <dt><WorkspaceText text="Phone" /></dt><dd>{item.customerPhone || "—"}</dd>
      <dt><WorkspaceText text="Service" /></dt><dd>{actions.edit ? <button type="button" onClick={() => { close(); actions.edit?.(item,{kind:"service",index:0}); }}><WorkspaceText text={item.serviceNames.join(", ") || "Choose services"} /> ✎</button> : item.serviceNames.join(", ")}</dd>
      <dt><WorkspaceText text="Staff" /></dt><dd>{actions.edit ? <button type="button" onClick={() => { close(); actions.edit?.(item,{kind:"staff",index:0}); }}>{professionals(item)} ✎</button> : professionals(item)}</dd>
      {!!item.lines?.length && <><dt><WorkspaceText text="Service schedule" /></dt><dd><ol className={styles.planPreview}>{item.lines.map(line => <li key={line.id}><strong>{line.serviceName}</strong><span>{line.staffName || line.staffId}</span>{line.startAt && line.endAt && <small>{displayBookingTime(line.startAt,timezone)} – {displayBookingTime(line.endAt,timezone)}</small>}</li>)}</ol></dd></>}
      {item.notificationStatus && <><dt><WorkspaceText text="Notifications" /></dt><dd><WorkspaceText text={item.notificationStatus} /></dd></>}
      <dt><WorkspaceText text="Duration" /></dt><dd><WorkspaceText text={duration(item)} /></dd>
      {item.noShowNote ? <><dt><WorkspaceText text="No-show note" /></dt><dd>{item.noShowNote}</dd></> : null}
      <dt><WorkspaceText text="Status" /></dt><dd>{actions.status ? <button type="button" onClick={() => { close(); actions.status?.(item); }}><Status value={item.status} kind={item.noShowKind} /> ▾</button> : <Status value={item.status} kind={item.noShowKind} />}</dd>
    </dl>
    {actions.ticket && !item.ticketId && <button type="button" className={styles.detailsButton} onClick={() => { close(); actions.ticket?.(item); }}><WorkspaceText text="Create ticket → POS" /></button>}
  </dialog>;
}

export function BookingViews({ appointments, data, date, view, showDates, actions = {}, openingHours, focusRequest = 0 }: {
  focusRequest?: number;
  actions?: BookingActions;
  openingHours?: BookingOpeningHours;
  appointments: PortableBookAppointment[]; data: PortableBookData; date: string;
  view: "list" | "calendar"; showDates: boolean;
}) {
  const __vt = useWorkspaceTranslation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = appointments.find(item => item.id === selectedId) ?? null;
  const setSelected = (item: PortableBookAppointment | null) => setSelectedId(item?.id ?? null);
  return <>
    {view === "calendar" ? <BookingDayCalendar focusRequest={focusRequest} appointments={appointments} data={data} date={date} openingHours={openingHours} select={item=>{if(actions.edit && !item.ticketId && ["pending","scheduled","confirmed"].includes(item.status)) actions.edit(item);else setSelected(item);}} /> :
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label={__vt("Appointments")}>
          <colgroup>
            <col className={styles.listTimeColumn} /><col className={styles.listStaffColumn} />
            <col /><col className={styles.listCustomerColumn} /><col className={styles.listTotalColumn} /><col className={styles.listActionsColumn} />
          </colgroup>
          <thead><tr>{["Time / Status", "Professional", "Services", "Customer", "Total", "Actions"].map(label => <th scope="col" key={label}><WorkspaceText text={label} /></th>)}</tr></thead>
          <tbody>{appointments.map(item => {
            const canEdit = !!actions.edit && !item.ticketId && ["pending","scheduled","confirmed"].includes(item.status);
            return <tr key={item.id}>
              <td data-label="Time / Status" className={styles.time}><button type="button" className={styles.textButton} aria-label={__vt(`Change time for ${item.customerName}`)} onClick={()=>canEdit ? actions.edit?.(item,{kind:"time"}) : setSelected(item)}><time dateTime={item.startAt}>{displayBookingTime(item.startAt, data.timezone)}</time><small>{displayBookingTime(item.endAt, data.timezone)} · <WorkspaceText text={duration(item)} /></small></button>{showDates && <small>{bookingDate(item.startAt, data.timezone)}</small>}
                <div className={styles.rowStatus}>{Boolean(item.noShowCount) && <span className="mb-1 block text-[11px] font-semibold text-orange-800">{item.noShowCount} <WorkspaceText text="previous no-show" />{item.noShowCount === 1 ? "" : "s"}</span>}{actions.status && !item.ticketId && ["pending","scheduled","confirmed","checked_in","no_show"].includes(item.status) ? <button type="button" className={styles.statusButton} title={__vt("Change status")} aria-label={__vt(`Change status for ${item.customerName}`)} onClick={() => actions.status?.(item)}><Status value={item.status} kind={item.noShowKind} /></button> : <Status value={item.status} kind={item.noShowKind} />}</div>
              </td>
              <td data-label="Professional"><div className={styles.person}><Avatar name={professionals(item)} />{canEdit ? <button type="button" className={styles.textButton} aria-label={__vt(`Change professional for ${item.customerName}`)} onClick={() => actions.edit?.(item,{kind:"staff",index:0})}>{professionals(item)}</button> : <span>{professionals(item)}</span>}</div></td>
              <td data-label="Services">{canEdit ? <button type="button" className={styles.textButton} aria-label={__vt(`Edit services for ${item.customerName}`)} onClick={() => actions.edit?.(item,{kind:"service",index:0})}><WorkspaceText text={item.serviceNames.join(", ") || "Choose services"} /></button> : item.serviceNames.join(", ")}{(item.lines?.length ?? 0) > 1 && item.lines?.map((line,index) => <small key={line.id}><button type="button" className={styles.textButton} onClick={()=>canEdit ? actions.edit?.(item,{kind:"service",index}) : setSelected(item)}>{line.serviceName}</button> · <button type="button" className={styles.textButton} onClick={()=>canEdit ? actions.edit?.(item,{kind:"staff",index}) : setSelected(item)}>{line.staffName || data.staff.find(staff => staff.id === line.staffId)?.display_name || "Unassigned"}</button></small>)}</td>
              <td data-label="Customer"><div className={styles.person}><Avatar name={item.customerName}/><strong><CustomerName name={item.customerName} fallback="Walk-in customer" /></strong></div>{item.customerPhone && <small>{item.customerPhone}</small>}<button type="button" className={styles.customerLink} onClick={() => canEdit ? actions.edit?.(item,{kind:"customer"}) : setSelected(item)} aria-label={__vt(`View appointment for ${item.customerName || "Walk-in customer"}`)}><WorkspaceText text="Customer details" /></button></td>
              <td data-label="Total" className={styles.listTotal}>{item.total !== undefined || item.lines?.length ? new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(item.total ?? item.lines!.reduce((sum,line) => sum + line.price,0)) : "—"}</td>

              <td data-label="Actions">
                <div className={styles.rowActions}>
                  {actions.ticket && !item.ticketId && ["scheduled","confirmed","checked_in","in_service"].includes(item.status) && <button type="button" className={styles.ticketButton} title={__vt("Create ticket")} aria-label={__vt(`Create ticket for ${item.customerName}`)} onClick={() => actions.ticket?.(item)}>
                    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v6a2 2 0 0 0 0 4v6H4v-6a2 2 0 0 0 0-4Z"/><path d="M9 12h6m-3-3v6"/></svg>
                  </button>}
                  {item.ticketId && <span className={styles.ticketCreated} title={__vt("Ticket created")} aria-label={__vt("Ticket created")}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6"/></svg></span>}
                  {canEdit && <button type="button" className={styles.editButton} title={__vt("Edit appointment")} aria-label={__vt(`Edit appointment for ${item.customerName}`)} onClick={() => actions.edit?.(item)}>
                    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 5 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-4-4L5 15Z"/></svg>
                  </button>}
                </div>
              </td>
            </tr>;
          })}{appointments.length === 0 && <tr><td colSpan={6} className={styles.empty}><WorkspaceText text="No appointments match this view. Try another date or clear filters." /></td></tr>}</tbody>
        </table>
      </div>}
    {selected && <AppointmentDetails actions={{ edit: !selected.ticketId && ["pending","scheduled","confirmed"].includes(selected.status) ? actions.edit : undefined, status: !selected.ticketId && ["pending","scheduled","confirmed","checked_in"].includes(selected.status) ? actions.status : undefined, ticket: ["scheduled","confirmed","checked_in","in_service"].includes(selected.status) ? actions.ticket : undefined }} item={selected} timezone={data.timezone} close={() => setSelected(null)} />}
  </>;
}
