"use client";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import styles from "./ticket-filters.module.css";

function TicketCalendar({ date, onSelect, onClose }: { date:string; onSelect:(date:string)=>void; onClose:()=>void }) {
  const translate=useWorkspaceTranslation();
  const [month,setMonth]=useState(()=>new Date(`${date.slice(0,7)}-01T12:00:00`));
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ const node=dialog.current!; node.showModal(); node.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus(); return ()=>node.close(); },[]);
  const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  return createPortal(<dialog ref={dialog} className={styles.calendar} aria-label={translate("Date")} onCancel={onClose} onClick={event=>{
    if(event.target!==event.currentTarget)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();
  }}>
    <div className={styles.monthHeader}>
      <button type="button" aria-label={translate("Previous month")} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1,12))}>‹</button>
      <strong aria-live="polite">{new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(month)}</strong>
      <button type="button" aria-label={translate("Next month")} onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1,12))}>›</button>
    </div>
    <div className={styles.days}>
      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day=><span key={day}>{translate(day)}</span>)}
      {Array.from({length:month.getDay()},(_,index)=><span key={`blank-${index}`}/>)}
      {Array.from({length:days},(_,index)=>{
        const value=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,"0")}-${String(index+1).padStart(2,"0")}`;
        return <button key={value} type="button" aria-label={value} aria-pressed={value===date} onClick={()=>onSelect(value)}>{index+1}</button>;
      })}
    </div>
    <button className={styles.close} type="button" onClick={onClose}>{translate("Close")}</button>
  </dialog>,document.body);
}

export function TicketFilters({date,query,onQueryChange,title,actions,filters}:{title?:string;actions?:ReactNode;filters?:ReactNode;date:string;query:string;onQueryChange:(value:string)=>void}) {
  const router=useRouter(), pathname=usePathname(), translate=useWorkspaceTranslation();
  const [open,setOpen]=useState(false);
  const [pending,startTransition]=useTransition();
  const trigger=useRef<HTMLButtonElement>(null);
  const dateLabel=new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date(`${date}T12:00:00`));
  const close=()=>{setOpen(false);trigger.current?.focus();};
  const select=(value:string)=>{
    close();
    const params=new URLSearchParams(window.location.search);
    params.set("date",value);
    if(query)params.set("q",query);else params.delete("q");
    startTransition(()=>{
      // Selecting the displayed date is also an explicit request to reload it.
      if (value===date && window.location.search===`?${params}`) router.refresh();
      else router.replace(`${pathname}?${params}`,{scroll:false});
    });
  };
  return <>
    <header className={styles.header}>
      {title?<h1 className={styles.title}>{translate(title)}</h1>:null}
      <div className={styles.headerDate}>
      <button ref={trigger} data-ticket-date type="button" className={styles.dateButton} aria-label={`${translate("Date")}: ${dateLabel}`} aria-haspopup="dialog" aria-expanded={open} disabled={pending} onClick={()=>setOpen(true)}>{dateLabel}</button>
      </div>
      <div className={styles.headerActions}>{filters}{actions}</div>
    </header>
    <form className={styles.toolbar} data-ticket-toolbar data-owner-ticket-toolbar={title?"true":undefined} role="search" aria-busy={pending}
      onSubmit={event=>{event.preventDefault();(event.currentTarget.elements.namedItem("q") as HTMLInputElement)?.blur();}}>
      <div className={styles.search}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
        <input aria-label={translate("Search customer, staff, service, ticket #")} name="q" type="search" enterKeyHint="search" autoComplete="off" placeholder={translate("Customer, staff, service, ticket #")} value={query} onChange={event=>onQueryChange(event.target.value)}/>
      </div>
    </form>
    {pending?<p role="status" className={styles.status}>{translate("Loading tickets…")}</p>:null}
    {open?<TicketCalendar date={date} onSelect={select} onClose={close}/>:null}
  </>;
}
