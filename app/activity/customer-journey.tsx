"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CustomerActivity, CustomerActivityData, CustomerBookingActivity, CustomerActivityReceipt } from "@/lib/customer-activity";
import type { CustomerBookingDetail } from "@/lib/customer-bookings";
import { customerJourneyGroups, customerVisitQrHref, customerVisitArrivedAt, isActiveCustomerVisit, type CustomerJourneyTab } from "@/lib/customer-journey";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import { searchTextMatches } from "@/lib/search-normalization";
import { useExperienceScope } from "@/components/experience-scope";
import { useCloseOnNavigation } from "@/components/overlay-dismissal";
import { loadCustomerHistoryRead } from "@/lib/customer-history-client";
import { HistoryDetailsDrawer } from "./history-details-drawer";
import { MyCustomerProfiles } from "./my-customer-profiles";
import styles from "./customer-journey.module.css";

const PAGE_SIZE = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function format(item: CustomerActivity, options: Intl.DateTimeFormatOptions) {
  const date = new Date(item.type === "booking" ? item.startAt : item.occurredAt);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { ...options, timeZone: item.timezone ?? "America/Chicago" }).format(date) : "Date unavailable";
}
function monthKey(item: CustomerActivity) { return format(item, { year: "numeric", month: "long" }); }
function status(item: CustomerActivity) {
  if (item.type === "purchase") return "Visited";
  if (item.status === "cancelled")return "Cancelled";
  if (item.status === "no_show") return bookingStatusLabel(item.status, item.type === "booking" ? item.noShowKind : null);
  if (item.visitState==="checkout")return "Ready for checkout";
  if (item.visitState==="in_service")return "In service";
  if (item.visitState==="completed")return "Visit recorded";
  if (item.status === "upcoming") {const label=item.type === "booking" && item.bookingStatus ? bookingStatusLabel(item.bookingStatus, item.noShowKind) : "Upcoming";return label.charAt(0).toUpperCase()+label.slice(1);}
  return ({ checked_in: "Checked in · Waiting", in_service: "In service", cancelled: "Cancelled", past_appointment: "Past appointment", completed: "Visited" } as Record<string,string>)[item.status] ?? item.status;
}
function tone(item: CustomerActivity) { return item.status === "completed" || item.status === "checked_in" || item.status === "in_service" || item.status === "upcoming" && (item.type !== "booking" || item.bookingStatus !== "pending") ? "teal" : item.status === "no_show" || item.type === "booking" && item.bookingStatus === "pending" ? "amber" : "neutral"; }
function kind(item: CustomerActivity) {
  if (item.type === "purchase") return `${item.bookingId || item.visitType === "appointment" ? "Appointment" : item.visitType === "walk_in" ? "Walk-in" : "Visit"} · Receipt ${item.ticketNumber}`;
  return item.type === "visit" ? "Salon check-in" : "Appointment";
}
function amount(item: CustomerActivity) {
  if (item.type === "visit" || ["cancelled", "no_show"].includes(item.status)) return "";
  return `${item.type === "booking" ? "Est. " : ""}${new Intl.NumberFormat("en-US", { style:"currency",currency:item.currency }).format(item.total)}`;
}
function JourneyRow({ item, onOpen }: { item: CustomerActivity; onOpen: (item: CustomerActivity) => void }) {
  return <button type="button" className={styles.row} onClick={() => onOpen(item)} aria-label={`Details: ${item.salon.name}, ${format(item,{month:"short",day:"numeric"})}, ${status(item)}`}>
    <span className={styles.date}><span className={styles.dateBadge}><small>{format(item,{month:"short"})}</small><strong>{format(item,{day:"numeric"})}</strong></span><span className={styles.time}>{format(item,{hour:"numeric",minute:"2-digit"})}</span></span>
    <span className={styles.body}><strong>{item.salon.name}</strong><span className={styles.kind}>{kind(item)}</span><span className={styles.services}>{item.services.map(service=>service.name).join(" · ") || item.title}</span><span className={styles.badge} data-tone={tone(item)}>{status(item)}</span></span>
    <span className={styles.end}><strong className={styles.amount}>{amount(item)}</strong><span className={styles.chevron} aria-hidden>›</span></span>
  </button>;
}

/** Only explicit legacy deep links outside the bounded list need this read.
 * Pass the freshly authorized result to the drawer, avoiding a second read. */
function SelectedBookingDetails({ bookingId, onClose, onChanged, onResolved }: { bookingId: string; onClose: () => void; onChanged?:()=>void;onResolved?:(tab:CustomerJourneyTab)=>void }) {
  const experience = useExperienceScope();
  const scope = experience?.context.authenticated ? experience.context.scope : undefined;
  const [loaded,setLoaded] = useState<{scope:string;data:{booking:CustomerBookingDetail|null;receipt:CustomerActivityReceipt|null}}|null>(null);
  const result=loaded && loaded.scope===scope?loaded.data:null;
  const [error,setError] = useState(""); const [retry,setRetry] = useState(0);
  useEffect(()=>{let active=true;if(!scope || !uuid.test(bookingId))return;loadCustomerHistoryRead(scope,{bookingId}).then(value=>{if(!active)return;if(value.error)setError(value.error);else{setLoaded({scope,data:value});const b=value.booking;if(b)onResolved?.(value.receipt||["cancelled","no_show"].includes(b.status)?"history":["checked_in","in_service"].includes(b.status)||Date.parse(b.start_at)>Date.now()?"upcoming":"history");}}).catch(()=>{if(active)setError("Appointment details could not be loaded.");});return()=>{active=false;};},[scope,bookingId,retry,onResolved]);
  if (!uuid.test(bookingId)) return <div role="alert"><p>This appointment link is invalid.</p><button className={styles.button} onClick={onClose}>Close</button></div>;
  if (!result?.booking) return <div role={error?"alert":"status"} className={styles.empty}><p>{error || "Loading appointment details…"}</p>{error?<button className={styles.button} onClick={()=>{setError("");setRetry(n=>n+1);}}>Try again</button>:null}<button className={styles.button} onClick={onClose}>Close</button></div>;
  const b=result.booking;
  const item:CustomerBookingActivity={type:"booking",id:`booking-${b.id}`,bookingId:b.id,href:`/my-bookings/${b.id}`,currency:"USD",startAt:b.start_at,endAt:b.end_at,occurredAt:b.start_at,timezone:b.salon_timezone_snapshot,status:b.status==="cancelled"?"cancelled":b.status==="no_show"?"no_show":"past_appointment",noShowKind:b.no_show_kind,historyEvidence:b.historyEvidence,salon:{id:b.salon_id,name:b.salon?.displayName??b.salon?.name??"Salon",location:b.salon?.city,imageUrl:b.salon?.logoUrl??null,coverUrl:null},services:(b.lines??[]).map(line=>({id:line.id,name:line.service_name_snapshot,staffName:line.assignedStaff?.displayName??null,lineTotal:Number(line.line_total)})),staffName:null,title:"Appointment",total:(b.lines??[]).reduce((sum,line)=>sum+Number(line.line_total),0)};
  return <HistoryDetailsDrawer activity={item} initialDetails={result} onClose={onClose} onChanged={onChanged}/>;
}

export type CustomerJourneyProps = { activity:CustomerActivityData; initialTab?:CustomerJourneyTab; initialStatus?:string; initialSelectedBookingId?:string; message?:string; error?:string; onRefresh?:()=>Promise<void>; refreshing?:boolean };
export function CustomerJourney({activity,initialTab="upcoming",initialStatus="all",initialSelectedBookingId,message,error,onRefresh,refreshing}:CustomerJourneyProps) {
  const [tab,setTab]=useState<CustomerJourneyTab>(()=>{const record=initialSelectedBookingId?[...activity.upcoming,...activity.history].find(item=>item.type!=="visit"&&item.bookingId===initialSelectedBookingId):undefined;return record?(record.status==="upcoming"||isActiveCustomerVisit(record)?"upcoming":"history"):initialTab;});
  const [query,setQuery]=useState(""); const [type,setType]=useState("all"); const [recordStatus,setRecordStatus]=useState(initialStatus); const [month,setMonth]=useState("all"); const [page,setPage]=useState(1);
  const [filters,setFilters]=useState(false); const [menu,setMenu]=useState(false); const [profiles,setProfiles]=useState(false);
  const panelId=useId(),filterTitleId=useId();const [localRefreshError,setLocalRefreshError]=useState("");const refreshBusy=useRef(false);
  const [selected,setSelected]=useState<CustomerActivity|null>(null);const [deepId,setDeepId]=useState(initialSelectedBookingId);
  const filterDialog=useRef<HTMLDialogElement>(null);const groups=useMemo(()=>customerJourneyGroups(activity),[activity]);
  const closeFilters=()=>{filterDialog.current?.close();setFilters(false);}; useCloseOnNavigation(closeFilters);
  useEffect(()=>{if(!filters)return;const element=filterDialog.current,previous=document.body.style.overflow;document.body.style.overflow="hidden";if(!element?.open)element?.showModal();return()=>{element?.close();document.body.style.overflow=previous;};},[filters]);
  const current=tab==="upcoming"?groups.upcoming:groups.history;
  const months=useMemo(()=>Array.from(new Set(current.map(monthKey))),[current]);
  const visible=useMemo(()=>current.filter(item=>(type==="all"||type==="booking"&&(item.type==="booking"||item.type==="purchase"&&Boolean(item.bookingId))||type==="purchase"&&item.type==="purchase")&&(recordStatus==="all"||item.status===recordStatus)&&(month==="all"||monthKey(item)===month)&&searchTextMatches([item.salon.name,item.salon.location,item.title,...item.services.flatMap(s=>[s.name,s.staffName]),format(item,{month:"short",day:"numeric",year:"numeric"})],query)),[current,type,recordStatus,month,query]);
  const pageCount=Math.max(1,Math.ceil(visible.length/PAGE_SIZE)),currentPage=Math.min(page,pageCount),rows=visible.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
  const selectedDeep=deepId?[...activity.upcoming,...activity.history].find(item=>item.type!=="visit"&&item.bookingId===deepId):undefined;
  function switchTab(next:CustomerJourneyTab){setTab(next);setQuery("");setType("all");setRecordStatus("all");setMonth("all");setPage(1);setSelected(null);setDeepId(undefined);}
  function reset(){setQuery("");setType("all");setRecordStatus("all");setMonth("all");setPage(1);}
  const open=(item:CustomerActivity)=>{setDeepId(undefined);setSelected(item);};
  async function refresh(){if(!onRefresh||refreshBusy.current)return;refreshBusy.current=true;setLocalRefreshError("");try{await onRefresh();}catch{setLocalRefreshError("Could not refresh. Showing the last loaded records.");}finally{refreshBusy.current=false;}}
  return <main className={styles.page}><div className={styles.inner}>
    <div className={styles.heading}><h1>Appointments &amp; visits</h1><button className={styles.iconButton} type="button" aria-label="More options for appointments and visits" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}>•••</button></div>
    {menu?<div className={styles.menu}>{onRefresh?<button type="button" disabled={refreshing} onClick={()=>{setMenu(false);void refresh();}}>Refresh</button>:null}<button type="button" onClick={()=>{setProfiles(v=>!v);setMenu(false);}}>Manage my customer profiles</button><Link prefetch={false} className={styles.menuLink} href="/support?from=/my-bookings">Report a problem</Link></div>:null}
    {profiles?<MyCustomerProfiles/>:null}
    {message?<p role="status" className={styles.muted}>{message}</p>:null}{error||localRefreshError?<p role="alert">{error||localRefreshError}</p>:null}{refreshing?<p role="status" className={styles.muted}>Updating records…</p>:null}
    <div className={styles.tabs} role="tablist" aria-label="Appointments and visits"><button type="button" role="tab" aria-selected={tab==="upcoming"} aria-controls={panelId} onClick={()=>switchTab("upcoming")}>Upcoming</button><button type="button" role="tab" aria-selected={tab==="history"} aria-controls={panelId} onClick={()=>switchTab("history")}>History</button></div>
    {tab==="upcoming"?<>
      {groups.active.length?<section aria-label="At salon"><h2 className={styles.month}>At salon</h2>{groups.active.map(item=><article className={styles.active} key={item.id}><span className={styles.badge} data-tone="teal">{status(item)}</span><h3>{item.salon.name}</h3>{customerVisitArrivedAt(item)?<p className={styles.muted}>Arrived · {new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:item.timezone??"America/Chicago"}).format(new Date(customerVisitArrivedAt(item)!))}</p>:null}<p className={styles.muted}>{item.services.map(s=>s.name).join(" · ")}</p><div className={styles.actions}><Link prefetch={false} className={styles.button} href={customerVisitQrHref(item)}>View my QR</Link><Link prefetch={false} className={styles.button} href={customerVisitQrHref(item)}>Visit details</Link></div></article>)}</section>:<section className={styles.checkin} aria-label="Salon check-in"><div><h2>At the salon?</h2><p>Scan the salon QR, or show your QR to staff.</p></div><div className={styles.actions}><Link prefetch={false} href="/qr?scan=1" className={`${styles.button} ${styles.primary}`}>Check in at salon</Link><Link prefetch={false} href="/qr" className={styles.button}>My QR</Link></div></section>}
    </>:null}
    {current.length?<div className={styles.toolbar}><input className={styles.search} aria-label="Search appointments and visits" type="search" value={query} placeholder="Salon, service or date" onChange={e=>{setQuery(e.target.value);setPage(1);}}/><button className={styles.iconButton} type="button" aria-label="Filter appointments and visits" aria-haspopup="dialog" onClick={()=>setFilters(true)}><svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>{type!=="all"||recordStatus!=="all"||month!=="all"?<span aria-hidden>•</span>:null}</button></div>:null}
    <section id={panelId} role="tabpanel" aria-label={tab==="upcoming"?"Upcoming appointments":"Salon history"}>
      {!current.length?<div className={styles.empty}><h2>{tab==="upcoming"?"No upcoming appointments":"No salon history yet"}</h2><p>{tab==="upcoming"?"Your next appointment will appear here after you book.":"Past appointments, visits and receipts will appear here."}</p><Link prefetch={false} className={`${styles.button} ${styles.primary}`} href="/explore">Find a salon</Link></div>:!rows.length?<div className={styles.empty}><h2>No matching records</h2><p>Try another salon, date or service.</p><button className={styles.button} onClick={reset}>Clear filters</button></div>:<div className={styles.list}>{rows.map((item,index)=><div key={item.id}>{index===0||monthKey(rows[index-1])!==monthKey(item)?<h2 className={styles.month}>{monthKey(item)}</h2>:null}<JourneyRow item={item} onOpen={open}/></div>)}</div>}
      {pageCount>1?<div className={styles.pagination}><button type="button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous</button><span>{currentPage} / {pageCount}</span><button type="button" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>Next</button></div>:null}
      {tab==="upcoming"&&current.length?<p className={`${styles.muted} mt-4`}>Times shown in the salon’s time zone.</p>:null}
    </section>
    {filters?<dialog ref={filterDialog} className={styles.dialog} aria-labelledby={filterTitleId} onClose={()=>setFilters(false)} onClick={event=>{if(event.target===event.currentTarget)closeFilters();}}><div className={styles.dialogHead}><h2 id={filterTitleId}>Filter {tab==="history"?"history":"appointments"}</h2><button className={styles.iconButton} type="button" aria-label="Close filters" onClick={closeFilters}>×</button></div>
      {tab==="history"?<label>Record type<select aria-label="Record type" value={type} onChange={e=>{setType(e.target.value);setPage(1);}}><option value="all">All records</option><option value="booking">Appointments</option><option value="purchase">Visits &amp; receipts</option></select></label>:null}
      {tab==="history"?<label>Status<select aria-label="Status" value={recordStatus} onChange={e=>{setRecordStatus(e.target.value);setPage(1);}}><option value="all">All statuses</option><option value="completed">Visited</option><option value="past_appointment">Past appointment</option><option value="cancelled">Cancelled</option><option value="no_show">No-show</option></select></label>:null}
      <label>Date<select aria-label="Date" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);}}><option value="all">All dates</option>{months.map(m=><option value={m} key={m}>{m}</option>)}</select></label><div className={styles.actions}><button className={styles.button} type="button" onClick={reset}>Reset</button><button className={`${styles.button} ${styles.primary}`} type="button" onClick={closeFilters}>Apply filters</button></div></dialog>:null}
    {selected||selectedDeep?<HistoryDetailsDrawer key={(selected??selectedDeep)!.id} activity={(selected??selectedDeep)!} onClose={()=>{setSelected(null);setDeepId(undefined);}} onChanged={()=>void refresh()}/>:deepId?<SelectedBookingDetails key={deepId} bookingId={deepId} onClose={()=>setDeepId(undefined)} onChanged={()=>void refresh()} onResolved={setTab}/>:null}
  </div></main>;
}

export function CustomerJourneyLoading({failed,onRetry}:{failed?:string;onRetry?:()=>void}) {
  return <main className={styles.page}><div className={styles.inner}><div className={styles.heading}><h1>Appointments &amp; visits</h1></div>{failed?<div className={styles.empty} role="alert"><h2>Appointments couldn’t be loaded</h2><p>{failed}</p>{onRetry?<button type="button" className={`${styles.button} ${styles.primary}`} onClick={onRetry}>Try again</button>:null}</div>:<div className={styles.loading} role="status" aria-label="Loading appointments and visits">{[0,1,2].map(n=><div className={styles.skeleton} key={n}/>)}</div>}</div></main>;
}
