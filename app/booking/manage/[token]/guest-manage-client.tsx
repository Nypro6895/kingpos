"use client";
import { cancelGuestBookingAction, claimGuestBookingAction, loadGuestManageSlotsAction, rescheduleGuestBookingAction } from "@/app/book/actions";
import type { GuestManagePageData, PublicBookingSlot } from "@/lib/public-booking";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./guest-manage.module.css";

type Props = {claimIntent:boolean;currentUser:{displayName:string|null;email:string|null;id:string}|null;data:GuestManagePageData;token:string};
function dateKey(value:string,timezone:string) {
  const parts=new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:timezone}).formatToParts(new Date(value));
  const read=(type:string)=>parts.find(part=>part.type===type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
export function GuestManageClient(props:Props) {
  if(!props.data.ok)return <main className={styles.root} data-testid="manage-booking-root"><section className={styles.receipt}><h1>Link unavailable</h1><p className={styles.muted}>{props.data.message}</p><a className={styles.link} href="/explore">Back to Explore</a></section></main>;
  return <GuestManageReady {...props} data={props.data}/>;
}
function GuestManageReady({data,token,currentUser,claimIntent}:Omit<Props,"data">&{data:Extract<GuestManagePageData,{ok:true}>}) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const [slotsPending,startSlotsTransition]=useTransition();
  const [claimPending,startClaimTransition]=useTransition();
  const [mode,setMode]=useState<"reschedule"|"cancel"|null>(null);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);
  const [updated,setUpdated]=useState<{startAt:string;endAt:string;status:string;lines:typeof data.booking.lines}|null>(null);
  const original=data.booking.booking;
  const booking={...original,...updated};
  const lines=updated?.lines??data.booking.lines;
  const timezone=booking.timezone;
  const salon=data.booking.salon;
  const [date,setDate]=useState(dateKey(booking.startAt,timezone));
  const [slots,setSlots]=useState<PublicBookingSlot[]>(data.slots);
  const [selectedStart,setSelectedStart]=useState("");
  const [reason,setReason]=useState("");
  const request=useRef(0);
  const cache=useRef(new Map<string,{until:number;slots:PublicBookingSlot[]}>());
  const selected=slots.find(slot=>slot.startAt===selectedStart);
  const canChange=original.canChange&&!['cancelled','completed','no_show'].includes(booking.status);
  const format=(value:string,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat("en-US",{...options,timeZone:timezone}).format(new Date(value));
  const time=(value:string)=>format(value,{hour:"numeric",minute:"2-digit"});
  const duration=Math.round((+new Date(booking.endAt)-+new Date(booking.startAt))/60000);
  const total=lines.reduce((sum,line)=>sum+line.unitPrice,0);
  const returnPath=`/booking/manage/${token}?claim=1`;
  const loginHref=`/login?next=${encodeURIComponent(returnPath)}`;
  const signupHref=`/signup?next=${encodeURIComponent(returnPath)}`;
  function loadSlots(nextDate:string,findEarliest=false) {
    const version=++request.current;
    setDate(nextDate);setError("");setSelectedStart("");
    const known=findEarliest?undefined:cache.current.get(nextDate);
    setSlots([]);
    startSlotsTransition(async()=>{
      if(known&&known.until>performance.now()){setSlots(known.slots);return;}
      try{const next=await loadGuestManageSlotsAction({token,date:nextDate,findEarliest});if(request.current!==version)return;if(cache.current.size>=7)cache.current.delete(cache.current.keys().next().value!);cache.current.set(nextDate,{until:performance.now()+30000,slots:next});if(findEarliest&&next[0])setDate(dateKey(next[0].startAt,timezone));setSlots(next);}
      catch{if(request.current===version)setError("Times could not be loaded. Please retry.");}
    });
  }
  function reschedule() {
    if(!selected)return;
    setError("");startTransition(async()=>{
      try{const result=await rescheduleGuestBookingAction({token,startAt:selected.startAt});if(result.ok){setUpdated({startAt:selected.startAt,endAt:selected.endAt,status:result.status??booking.status,lines:selected.lines});setMode(null);cache.current.clear();setMessage(result.message);}else{cache.current.clear();loadSlots(date);setError(result.message);}}
      catch{setError("Your appointment could not be changed. Please try again.");}
    });
  }
  function cancel() {
    setError("");startTransition(async()=>{
      try{const result=await cancelGuestBookingAction({token,reason});if(result.ok){setUpdated({startAt:booking.startAt,endAt:booking.endAt,status:"cancelled",lines});setMode(null);setMessage(result.message);}else setError(result.message);}
      catch{setError("Your appointment could not be cancelled. Please try again.");}
    });
  }
  function claim() {
    setError("");startClaimTransition(async()=>{
      try{const result=await claimGuestBookingAction({token});if(result.ok){setSaved(true);if(result.bookingId){router.replace(`/my-bookings?details=${encodeURIComponent(result.bookingId)}&message=${encodeURIComponent(result.message)}`);return;}setMessage(result.message);}else setError(result.message);}
      catch{setError("This booking could not be saved. Please try again.");}
    });
  }
  return <main className={styles.root} data-testid="manage-booking-root"><section className={styles.receipt}>
    <header className={styles.header}><h1>Booking details</h1><a className={styles.link} href="/explore">Explore</a></header>
    <section className={styles.salon}><span className={styles.logo}>{salon.name.slice(0,2)}</span><div><div className={styles.row}><h2>{salon.name}</h2><span className={styles.muted}>{booking.status.replaceAll("_"," ")}</span></div><p className={styles.muted}>{salon.addressLine1}</p><p className={styles.muted}>{[salon.city,salon.state].filter(Boolean).join(", ")}</p><div className={styles.links}>{salon.phone?<a href={`tel:${salon.phone.replace(/[^\d+]/g,"")}`}>Call salon</a>:null}<a href={`/explore/salons/${booking.salonId}`}>View salon</a></div></div></section>
    <section className={styles.section}><h2>{format(booking.startAt,{weekday:"short",month:"short",day:"numeric",year:"numeric"})}</h2><p className={styles.time}>{time(booking.startAt)}&ndash;{time(booking.endAt)}</p><p className={styles.muted}>{duration} min</p></section>
    <section className={styles.section}><h3 className={styles.muted}>Services</h3>{lines.map((line,index)=><div className={styles.service} key={`${line.serviceId}:${index}`}><div><strong>{line.serviceName}</strong><p className={styles.muted}>{line.staffName} &middot; {line.durationMinutes} min</p></div><strong>{money(line.unitPrice)}</strong></div>)}</section>
    <section className={styles.section}><div className={styles.row}><h2 className={styles.totalLabel}>Estimated total</h2><strong className={styles.total}>{money(total)}</strong></div><p className={styles.muted}>Booking estimate. Final amount is recorded by the salon.</p></section>
    {message?<p className={styles.message} role="status">{message}</p>:null}{error?<p className={styles.error} role="alert">{error}</p>:null}
    {canChange?<div className={styles.actions}><button className={styles.primary} disabled={pending} onClick={()=>{setMode("reschedule");setMessage("");loadSlots(date,true);}}>Reschedule</button><button className={styles.secondary} disabled={pending} onClick={()=>{setMode("cancel");setError("");}}>Cancel</button></div>:null}
    {mode==="reschedule"&&canChange?<section className={styles.editor} aria-label="Reschedule appointment"><div className={styles.row}><strong>Choose a new time</strong><button className={styles.link} disabled={pending} onClick={()=>setMode(null)}>Close</button></div><label className={styles.date}>Date<input type="date" value={date} min={dateKey(new Date().toISOString(),timezone)} disabled={pending} onChange={event=>{if(event.target.value)loadSlots(event.target.value);}}/></label><div className={styles.slots}>{slots.map(slot=><button key={slot.startAt} aria-pressed={selectedStart===slot.startAt} disabled={pending} onClick={()=>setSelectedStart(slot.startAt)}>{slot.label}</button>)}</div>{slotsPending?<p className={styles.muted} role="status">Checking times...</p>:!slots.length?<p className={styles.muted}>No matching times. <button className={styles.link} onClick={()=>loadSlots(date)}>Retry</button></p>:null}<button className={styles.primary} disabled={pending||slotsPending||!selected} onClick={reschedule}>{pending?"Saving...":"Save new time"}</button></section>:null}
    {mode==="cancel"&&canChange?<section className={styles.editor} aria-label="Cancel appointment"><strong>Cancel this appointment?</strong><p className={styles.muted}>The salon will be notified.</p><label className={styles.date}>Reason (optional)<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2}/></label><div className={styles.actions}><button className={styles.secondary} disabled={pending} onClick={()=>setMode(null)}>Keep booking</button><button className={styles.danger} disabled={pending} onClick={cancel}>{pending?"Cancelling...":"Confirm cancellation"}</button></div></section>:null}
    {canChange&&!mode?<p className={`${styles.muted} ${styles.policy}`}>Subject to salon availability.</p>:null}
    <details className={styles.details}><summary>Customer &amp; booking notes</summary><dl><dt>Customer</dt><dd>{data.booking.customer.name??"-"}</dd><dt>Phone</dt><dd>{data.booking.customer.phone??"-"}</dd><dt>Email</dt><dd>{data.booking.customer.email??"-"}</dd></dl>{booking.publicNotes?<p className={styles.muted}>{booking.publicNotes}</p>:null}{data.booking.inspiration?<p className={styles.muted}>{data.booking.inspiration.source_title_snapshot??"Booked look"}{data.booking.inspiration.source_caption_snapshot?` — ${data.booking.inspiration.source_caption_snapshot}`:""}</p>:null}</details>
    <section className={styles.account}><p className={styles.muted}>Keep this appointment in your account.</p>{currentUser?<><button className={styles.primary} disabled={claimPending||saved} onClick={claim}>{saved?"Saved to account":claimPending?"Saving...":claimIntent?"Save booking to account":"Save to account"}</button><p className={styles.muted}>Signed in as {currentUser.displayName??currentUser.email??"your account"}</p></>:<div className={styles.actions}><a className={styles.primary} href={loginHref}>Sign in</a><a className={styles.secondary} href={signupHref}>Create account</a></div>}</section>
  </section></main>;
}
