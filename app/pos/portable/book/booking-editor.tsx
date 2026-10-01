"use client";

import { useEffect, useRef, useState } from "react";
import type { PortableBookAppointment, PortableBookData, PortableBookingSlot, PortableStaffOption } from "../actions";
import type { PosDeskCustomer } from "@/types/pos-desk";
import { portableBookingTime } from "@/lib/portable-booking-time";
import { dismissPortableKeyboard } from "@/lib/portable-touch-input";
import { CustomerLookup, type BookingCustomerSearch } from "./customer-lookup";
import styles from "./booking.module.css";

export type BookingEditField = {kind: "customer" | "time" | "service" | "staff" | "add" | "allstaff"; index?: number};
export type StaffOptionsAction = (input: {serviceIds: string[]; staffIds: (string | null)[]; startAt: string; index: number; bookingId?: string}) => Promise<PortableStaffOption[]>;
type Props = {
  stale?: boolean;
  data: PortableBookData; editing: PortableBookAppointment | null; initialField?: BookingEditField;
  customerId?: string; customerName: string; customerPhone: string; customerEmail: string;
  onContact: (field: "name" | "phone" | "email", value: string) => void;
  onCustomer: (customer: PosDeskCustomer) => void; searchCustomersAction?: BookingCustomerSearch;
  serviceIds: string[]; staffIds: (string | null)[];
  onServices: (ids: string[]) => void; onStaff: (index: number, id: string | null) => void;
  startAt: string; onTime: (value: string) => void; bounds?: {min: string; max: string};
  slots: PortableBookingSlot[]; slotMessage: string; selectedSlot?: PortableBookingSlot;
  notes: string; onNotes: (value: string) => void; staffOptionsAction?: StaffOptionsAction;
  busy: boolean; error: string; onClose: () => void; onSave: () => void; onStatus?: () => void;
};

export function BookingEditor(p: Props) {
  const onClose = p.onClose;
  const [picker, setPicker] = useState<BookingEditField | null>(p.initialField ?? (!p.customerName ? {kind:"customer"} : null));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [phoneSearch, setPhoneSearch] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [availability, setAvailability] = useState<{key: string; rows: PortableStaffOption[]; failed?: boolean}>({key:"",rows:[]});
  const day = p.startAt.slice(0,10);
  const staffRequest = picker?.kind === "staff" || picker?.kind === "allstaff" ? JSON.stringify({serviceIds:p.serviceIds,staffIds:p.staffIds,startAt:portableBookingTime(p.startAt,p.data.timezone),index:picker.kind === "allstaff" ? -1 : picker.index ?? 0,bookingId:p.editing?.id}) : "";
  useEffect(() => {
    if (!staffRequest || !p.staffOptionsAction) return;
    let active = true;
    const timer = setTimeout(() => {
      const input = JSON.parse(staffRequest);
      if (!input.startAt || !input.serviceIds.length) return;
      p.staffOptionsAction!(input).then(rows => {if(active) setAvailability({key:staffRequest,rows});}).catch(() => {if(active) setAvailability({key:staffRequest,rows:[],failed:true});});
    },250);
    return () => {active=false;clearTimeout(timer);};
  }, [staffRequest,p.staffOptionsAction]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if(event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();dismissPortableKeyboard();
      if(picker) setPicker(null); else if(dirty.current) setDiscard(true); else onClose();
    };
    document.addEventListener("keydown",listener);
    return () => document.removeEventListener("keydown",listener);
  },[picker,onClose]);
  function open(field: BookingEditField) {dismissPortableKeyboard();setQuery("");setCategory("");setPicker(field);}
  function done() {dismissPortableKeyboard();setPicker(null);}
  function close() {dismissPortableKeyboard();if(dirty.current) setDiscard(true);else onClose();}
  function eligible(serviceId: string, staffId: string) {return p.data.staffServiceAssignments?.some(a => a.serviceId === serviceId && a.staffId === staffId && (!a.from || a.from <= day) && (!a.through || a.through >= day)) ?? false;}
  const planned = p.selectedSlot?.lines;
  const rows = p.serviceIds.map((id,index) => {
    const service=p.data.services.find(s=>s.id===id);
    const plan=planned?.[index];
    const existing=p.editing?.lines?.[index];
    const knownExisting=existing?.serviceId === id && existing.staffId === p.staffIds[index] ? existing : undefined;
    const minutes=plan ? (Date.parse(plan.endAt)-Date.parse(plan.startAt))/60000 : knownExisting?.startAt && knownExisting.endAt ? (Date.parse(knownExisting.endAt)-Date.parse(knownExisting.startAt))/60000 : service?.duration_minutes ?? 30;
    return {id,index,service,plan,minutes,price:plan?.price ?? knownExisting?.price ?? service?.base_price ?? 0,
      staffName:p.data.staff.find(s=>s.id===p.staffIds[index])?.display_name || plan?.staffName || "Auto recommend"};
  });
  const minutes=rows.reduce((n,r)=>n+r.minutes,0);
  const total=rows.reduce((n,r)=>n+Number(r.price),0);
  const startInstant=portableBookingTime(p.startAt,p.data.timezone);
  const formatTime=(instant:string) => new Intl.DateTimeFormat("en-US",{timeZone:p.data.timezone,hour:"numeric",minute:"2-digit"}).format(new Date(instant));
  const endLabel=startInstant ? formatTime(p.selectedSlot?.endAt ?? new Date(Date.parse(startInstant)+minutes*60000).toISOString()) : "Choose time";
  const choices=p.data.services.filter(s => (!category||s.category===category) && `${s.name} ${s.category}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const memberChoices=p.data.staff.filter(member => (picker?.kind === "allstaff" ? p.serviceIds.every(id=>eligible(id,member.id)) : eligible(p.serviceIds[picker?.index ?? 0],member.id)) && member.display_name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const autoAllowed=p.data.bookingPolicy?.autoAssignEnabled !== false;
  const missingStaff=!autoAllowed && p.staffIds.some(id=>!id);
  return <aside ref={panel} className={styles.editor} role="region" aria-label={p.editing ? "Edit appointment" : "New appointment"}>
    <header className={styles.editorHeading}><div><h2>{p.editing ? "Edit appointment" : "New appointment"}</h2><small>{p.data.salonName}</small></div><button type="button" aria-label="Close appointment editor" onClick={close} disabled={p.busy}>×</button></header>
    <div className={styles.editorBody} inert={picker !== null || discard || p.busy}>
      <div className={styles.editorLabel}>Customer</div>
      <button type="button" className={styles.editorCustomer} onClick={()=>open({kind:"customer"})}><span className={styles.avatar}>{p.customerName.slice(0,1)||"+"}</span><span><strong>{p.customerName||"Find or add customer"}</strong><small>{p.customerPhone||"Search name or phone"}</small></span><span>›</span></button>
      <div className={styles.editorLabel}>Date & time</div>
      <button type="button" className={styles.editorWhen} onClick={()=>open({kind:"time"})}><span><strong>{day ? new Date(`${day}T12:00:00`).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) : "Choose a date"}</strong><small>{p.data.timezone}</small></span><span><strong>{startInstant ? formatTime(startInstant) : "Choose time"}{rows.length ? ` – ${endLabel}` : ""}</strong><small>{minutes} min{!p.selectedSlot ? " · estimated" : ""}</small></span><span>⌄</span></button>
      <div className={styles.editorLabel}>Services <span>{rows.length} selected</span></div>
      {rows.map((r,index)=><div className={styles.editorService} key={`${r.id}-${index}`}><span className={styles.serviceClock}>{startInstant ? formatTime(new Date(Date.parse(startInstant)+rows.slice(0,index).reduce((n,row)=>n+row.minutes,0)*60000).toISOString()) : "—"}<small>{r.minutes} min</small></span><div><button type="button" className={styles.serviceTitle} onClick={()=>open({kind:"service",index})} aria-label={`Change ${r.service?.name ?? "service"}`}><strong>{r.service?.name??"Service no longer available"}</strong><span>${Number(r.price).toFixed(2)}</span></button><button type="button" className={styles.serviceMember} onClick={()=>open({kind:"staff",index})} aria-label={`Professional for ${r.service?.name}`}><span>{r.staffName}</span>{!p.staffIds[index] && r.staffName!=="Auto recommend" && <em>Auto</em>}<span>⌄</span></button></div><button type="button" aria-label={`Remove ${r.service?.name}`} onClick={()=>{dirty.current=true;p.onServices(p.serviceIds.filter((_,i)=>i!==index));}}>×</button></div>)}
      <button type="button" className={styles.addService} onClick={()=>open({kind:"add"})}>+ Add service</button>
      {!!rows.length && <div className={styles.assignmentTools}>{autoAllowed && <button type="button" onClick={()=>{dirty.current=true;p.onStaff(-1,null);}}>Auto recommend</button>}<button type="button" onClick={()=>open({kind:"allstaff"})}>Use one professional…</button></div>}
      {!!rows.length && <p className={styles.availabilityHint} data-ready={!!p.selectedSlot}>{p.selectedSlot ? "✓ All services fit this time" : missingStaff ? "Choose a professional for each service" : "Choose an available time to verify this sequence"}</p>}
      <div className={styles.editorLabel}>Note <span>Optional</span></div><button type="button" className={styles.noteToggle} onClick={()=>setNoteOpen(!noteOpen)}>{noteOpen ? "Hide note" : p.notes || "+ Add note"}</button>{noteOpen && <textarea aria-label="Appointment note" maxLength={4000} value={p.notes} onChange={e=>{dirty.current=true;p.onNotes(e.target.value);}} placeholder="A short note for the team" />}
    </div>
    <footer className={styles.editorFooter}>
      {p.stale && <p role="alert" className={styles.editorError}>This appointment changed on another device. Close and reopen it before saving. Your current inputs have been kept.</p>}
      {p.error && <p role="alert" className={styles.editorError}>{p.error}</p>}
      <div className={styles.editorTotal}><span>{minutes} min · {rows.length} services{!p.selectedSlot ? " · estimated" : ""}</span><strong>${total.toFixed(2)}</strong></div>
      <div className={styles.editorSave}><button type="button" disabled={!p.editing || !p.onStatus || p.stale || p.busy || !!picker} onClick={p.onStatus}>{p.editing?.status === "scheduled" ? "Confirmed" : p.editing?.status || "New booking"}{p.onStatus ? " ▾" : ""}</button><button type="button" disabled={p.stale || p.busy || !p.customerName.trim() || !rows.length || !startInstant || missingStaff || !!picker || (!!p.editing && !p.customerId)} onClick={()=>{dismissPortableKeyboard();p.onSave();}}>{p.busy ? "Saving…" : p.editing ? "Save changes" : "Create appointment"}</button></div>
      <small>Messages follow salon settings.</small>
    </footer>
    {picker && <section className={styles.editorPicker} aria-label="Quick edit" inert={p.busy}>
      <header><h3>{{customer:"Customer",time:"Date & available times",service:"Change service",staff:"Choose professional",add:"Add services",allstaff:"One professional for all services"}[picker.kind]}</h3><button type="button" onClick={done}>Done</button></header>
      {!["time","customer"].includes(picker.kind) && <input ref={searchRef} type="search" aria-label={picker.kind.includes("staff") ? "Search professionals" : "Search services"} placeholder={picker.kind.includes("staff") ? "Search professionals" : "Search services"} value={query} onChange={e=>setQuery(e.target.value)} />}
      <div className={styles.pickerResults} data-touch-keyboard-keep={picker.kind==="add" ? "" : undefined}>
        {picker.kind==="customer" && <>
          {p.editing ? <>{p.searchCustomersAction ? <><div className={styles.searchModes}><button type="button" aria-pressed={!phoneSearch} onClick={()=>setPhoneSearch(false)}>Name</button><button type="button" aria-pressed={phoneSearch} onClick={()=>setPhoneSearch(true)}>Phone</button></div><CustomerLookup label="Search customer" phone={phoneSearch} value={query} onChange={setQuery} search={p.searchCustomersAction} onSelect={customer=>{dirty.current=true;p.onCustomer(customer);done();}} /></> : <p>Customer search is unavailable.</p>}<small>Select an existing customer to change this appointment.</small></> : <>
            {(["name","phone"] as const).map(field=><label className={styles.editorContact} key={field}>{field==="name" ? "Customer name" : "Phone"}{p.searchCustomersAction ? <CustomerLookup label={field==="name" ? "Customer name" : "Phone"} phone={field==="phone"} value={field==="name" ? p.customerName : p.customerPhone} onChange={value=>{dirty.current=true;p.onContact(field,value);}} search={p.searchCustomersAction} onSelect={customer=>{dirty.current=true;p.onCustomer(customer);done();}} /> : <input aria-label={field==="name" ? "Customer name" : "Phone"} type={field==="phone" ? "tel" : "text"} value={field==="name" ? p.customerName : p.customerPhone} onChange={e=>{dirty.current=true;p.onContact(field,e.target.value);}} />}</label>)}
            <label className={styles.editorContact}>Email<input type="email" aria-label="Email" value={p.customerEmail} onChange={e=>{dirty.current=true;p.onContact("email",e.target.value);}} /></label><small>Search existing customers, or enter a new customer and press Done.</small>
          </>}
        </>}
        {(picker.kind==="add" || picker.kind==="service") && <>
          <div className={styles.categoryTabs}>{["",...new Set(p.data.services.map(s=>s.category).filter((value): value is string => !!value))].map(c=><button type="button" key={c} aria-pressed={category===c} onPointerDown={e=>e.preventDefault()} onClick={()=>setCategory(c)}>{c||"All"}</button>)}</div>
          {choices.map(service=>{const selected=p.serviceIds.includes(service.id);return <button type="button" className={styles.pickerOption} key={service.id} aria-label={`${service.name}, ${service.duration_minutes ?? 30} min${selected?", selected":""}`} disabled={selected && (picker.kind==="add" || p.serviceIds[picker.index??0]!==service.id)} onPointerDown={e=>{if(picker.kind==="add") e.preventDefault();}} onClick={()=>{dirty.current=true;const ids=[...p.serviceIds];if(picker.kind==="add") ids.push(service.id);else ids[picker.index??0]=service.id;p.onServices(ids);if(picker.kind!=="add") done();}}><span><strong>{service.name}</strong><small>{service.duration_minutes??30} min · {service.category}</small></span><span>${Number(service.base_price).toFixed(2)} {selected?"✓":"+"}</span></button>;})}
          {!choices.length && <p>No matching services</p>}
        </>}
        {(picker.kind==="staff" || picker.kind==="allstaff") && <>
          <small>Qualified for {picker.kind==="allstaff" ? "all selected services" : rows[picker.index??0]?.service?.name}. Availability includes the full appointment.</small>
          {autoAllowed && <button type="button" className={styles.pickerOption} onClick={()=>{dirty.current=true;p.onStaff(picker.kind==="allstaff" ? -1 : picker.index??0,null);done();}}><span><strong>Auto recommend</strong><small>Available professional · fair rotation</small></span></button>}
          {memberChoices.map(member=>{const result=availability.key===staffRequest ? availability.rows.find(s=>s.staffId===member.id) : undefined;return <button type="button" className={styles.pickerOption} key={member.id} onClick={()=>{dirty.current=true;p.onStaff(picker.kind==="allstaff" ? -1 : picker.index??0,member.id);if(result?.available===false) open({kind:"time"});else done();}}><span><strong>{member.display_name}</strong><small>{result?.available===true ? "Available for this appointment" : result?.available===false ? "Unavailable now · choose another time" : result?.available===null ? "Select remaining professionals to check availability" : availability.failed && availability.key===staffRequest ? "Availability unavailable · checked when saving" : p.staffOptionsAction ? "Checking availability…" : "Availability checked when saving"}</small></span>{result?.available && <span>✓</span>}</button>;})}
          {!memberChoices.length && <p>No matching professionals assigned to this service.</p>}
        </>}
        {picker.kind==="time" && <>
          <label className={styles.editorContact}>Date and time<input aria-label="Date and time" type="datetime-local" value={p.startAt} min={p.editing ? undefined : p.bounds?.min} max={p.bounds?.max} onChange={e=>{dirty.current=true;p.onTime(e.target.value);}} /></label>
          <p role="status" className={styles.slotMessage}>{p.slotMessage||"Select services to find available times"}</p><div className={styles.editorSlots}>{p.slots.map(slot=><button type="button" key={slot.startAt} aria-pressed={p.selectedSlot?.startAt===slot.startAt} onClick={()=>{dirty.current=true;p.onTime(`${day}T${slot.label}`);done();}}>{slot.label}{slot.endAt && <small>{Math.round((Date.parse(slot.endAt)-Date.parse(slot.startAt))/60000)} min</small>}</button>)}</div>
          <small>{p.data.bookingPolicy?.sameDayBookingEnabled ? "Same-day appointments allowed." : "New bookings start tomorrow."} Times use {p.data.timezone}.</small>
        </>}
      </div>
    </section>}
    {discard && <div className={styles.discardPrompt} role="alertdialog" aria-label="Unsaved appointment changes"><h3>Discard these changes?</h3><p>The appointment has not been saved.</p><button type="button" onClick={()=>setDiscard(false)}>Keep editing</button><button type="button" onClick={p.onClose}>Discard changes</button></div>}
  </aside>;
}
