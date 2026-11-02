"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { DailyReportOverview } from "@/types/daily-report-overview";
import type { DailyPosReport } from "@/types/pos-daily-closing";
import styles from "./daily-accounting-overview.module.css";

const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
export function DailyAccountingDate({date,today,timeZone,onDate}:{date:string;today:string;timeZone:string;onDate?:(date:string)=>void}){
 const router=useRouter(),path=usePathname();const t=useWorkspaceTranslation();
 return <div className={styles.date}><input aria-label={t("Business Date")} type="date" value={date} max={today} onChange={e=>{if(!e.target.value)return;if(onDate)onDate(e.target.value);else router.push(`${path}?${new URLSearchParams({date:e.target.value,preset:"custom",start:e.target.value,end:e.target.value})}#overview`,{scroll:false});}}/><small>{timeZone}</small></div>;
}
export function DailyAccountingOverview({overview,report,query,updatedAt,onClosing}:{overview:DailyReportOverview;report:DailyPosReport;query?:string;updatedAt?:number;onClosing:()=>void}){
 const path=usePathname(),routeParams=useSearchParams();const params=new URLSearchParams(query??routeParams.toString());
 const selected=params.get("staff")??"";const [limit,setLimit]=useState(30);const t=useWorkspaceTranslation();
 const date=report.reportDate;
 const reportHref=(staff:string)=>{const next=new URLSearchParams(params);next.set("date",date);if(staff)next.set("staff",staff);else next.delete("staff");return `${path}?${next}#overview`;};
 const closingHref=`${path}?${params}#daily-closing`;
 const ticketListHref=`${path.startsWith("/pos/report")?"/pos/ticket":"/pos-tickets"}?${new URLSearchParams({date,status:"closed"})}`;
 const visits=selected?overview.visits.filter(v=>v.lines.some(l=>l.staff.some(s=>s.id===selected))):overview.visits;
 const selectedStaff=overview.staff.find(s=>s.id===selected);
 const scopeKey=`reports-scroll:${path}:${date}:${selected}`;
 useEffect(()=>{let frame:number|undefined;try{const saved=JSON.parse(sessionStorage.getItem(scopeKey)??"null");if(saved)frame=requestAnimationFrame(()=>{setLimit(saved.limit??30);window.scrollTo(0,saved.y??0);});}catch{}return()=>{if(frame!==undefined)cancelAnimationFrame(frame);};},[scopeKey]);
 function remember(){try{sessionStorage.setItem(scopeKey,JSON.stringify({y:window.scrollY,limit}));}catch{}}
 const collected=Math.round((Number(report.closingInputs.cashAmount)+Number(report.closingInputs.creditCardAmount)+Number(report.closingInputs.otherAmount))*100)/100;
 const diff=Math.round((collected-report.totals.expectedTotal)*100);
 const status=diff===0?t("Balanced"):diff<0?t("Short"):t("Over");
 const [profit,setProfit]=useState<{date:string;value:number|null}|null>(null);const [profitError,setProfitError]=useState(false);const [profitBusy,setProfitBusy]=useState(false);
 async function loadProfit(){if(profit?.date===date||profitBusy)return;setProfitBusy(true);setProfitError(false);try{const res=await fetch(`/api/reports/day-profit?${new URLSearchParams({date})}`,{cache:"no-store"});if(!res.ok)throw Error();const result=await res.json();if(result.date!==date)throw Error();setProfit({date,value:result.shopNetIncome});}catch{setProfitError(true);}finally{setProfitBusy(false);}}
 return <section className={styles.overview} aria-label={t("Daily report")}>
  <Link href={ticketListHref} prefetch={false} onClick={remember} className={styles.row}><span><WorkspaceText text="Expected"/><small className={styles.note}> · POS</small></span><strong>{money(report.totals.expectedTotal)}<span className={styles.arrow}>›</span></strong></Link>
  <a href={closingHref} onClick={e=>{e.preventDefault();onClosing();}} className={styles.row}><span><WorkspaceText text="Collected"/><small className={styles.note}> · Cash + Card + Other</small></span><strong>{money(collected)}<span className={styles.arrow}>›</span></strong></a>
  <a href={closingHref} onClick={e=>{e.preventDefault();onClosing();}} className={`${styles.row} ${diff===0?styles.balanced:styles.balance}`}><span><WorkspaceText text="Balance"/></span><strong>{status}{diff!==0?` ${money(Math.abs(diff)/100)}`:""}<span className={styles.arrow}>›</span></strong></a>
  <details className={styles.profit} onToggle={e=>{if(e.currentTarget.open)void loadProfit();}}><summary><WorkspaceText text="Shop net income"/> · Payroll {profit?.date===date&&profit.value!==null?money(profit.value):""}</summary><p>{profitBusy?t("Loading…"):profitError?t("Could not load. Please try again."):profit?.date===date?(profit.value===null?t("Not available"):money(profit.value)):""} · <Link href={`/payroll?${new URLSearchParams({preset:"custom",start:date,end:date})}`} prefetch={false}>Payroll ›</Link></p></details>
  <div className={styles.heading}><h2><WorkspaceText text="Staff"/> & <WorkspaceText text="Turns"/></h2>{selected&&<Link href={reportHref("")} scroll={false}><WorkspaceText text="Clear filter"/> ×</Link>}</div>
  <table className={styles.table}><thead><tr><th><WorkspaceText text="Staff"/> / Check-in</th><th><WorkspaceText text="Turns"/></th><th><WorkspaceText text="POS amount"/></th></tr></thead><tbody>{overview.staff.map(s=><tr key={s.id} className={selected===s.id?styles.selected:undefined}><td><Link href={reportHref(s.id===selected?"":s.id)} scroll={false} prefetch={false}><strong>{s.sequence!==null?`${s.sequence}. `:""}{s.name}</strong><small>{s.checkedInAt?new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",timeZone:overview.timeZone}).format(new Date(s.checkedInAt)):"—"}</small></Link></td><td>{s.turns}</td><td><Link href={reportHref(s.id===selected?"":s.id)} scroll={false} prefetch={false}>{money(s.posAmount)}<span className={styles.arrow}>›</span></Link></td></tr>)}</tbody><tfoot><tr><td><WorkspaceText text="Total"/></td><td>{overview.staff.reduce((n,s)=>n+s.turns,0)}</td><td>{money(overview.staff.reduce((n,s)=>n+s.posAmount,0))}</td></tr></tfoot></table>
  <div className={styles.counts}><Link href={reportHref("")} scroll={false}><strong>{overview.checkInCount}</strong><span><WorkspaceText text="Check-ins"/></span></Link><Link href={ticketListHref} prefetch={false} onClick={remember}><strong>{overview.submittedCount} ›</strong><span><WorkspaceText text="Submitted tickets"/></span></Link><div><strong>{overview.staff.reduce((n,s)=>n+s.turns,0)}</strong><span><WorkspaceText text="Turns"/></span></div></div>
  <div className={styles.heading}><h2><WorkspaceText text="Customers & services"/></h2><span>{selectedStaff?.name??""}</span></div>
  {selected&&<p className={styles.filter}><WorkspaceText text="Staff filter applies to this list; totals above are for the salon."/></p>}
  <div className={styles.columns}><span><WorkspaceText text="Customer / Service / Staff"/></span><span><WorkspaceText text="Amount due"/></span></div>
  {visits.slice(0,limit).map(v=>{const content=<><div className={styles.visitHead}><strong>{v.customerName}{v.ticketNumber?` · #${v.ticketNumber}`:""}</strong><strong>{v.amount===null?"—":money(v.amount)}{v.ticketId&&<span className={styles.arrow}>›</span>}</strong></div><div className={styles.meta}><span>Check-in {v.checkedInAt?new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",timeZone:overview.timeZone}).format(new Date(v.checkedInAt)):"—"}</span><span><WorkspaceText text={v.status==="submitted"?"POS submitted":v.status==="open"?"Open ticket":v.status==="voided"?"Voided":v.status==="cancelled"?"Cancelled":"Checked in"}/></span></div>{v.lines.length?v.lines.map((l,i)=><div className={styles.service} key={i}><span>{l.name}{!v.ticketId&&<> · <WorkspaceText text="Requested"/></>}</span><span>{l.staff.map(s=>s.name).join(", ")||"—"}</span></div>):<p className={styles.note}><WorkspaceText text="No services selected"/></p>}</>;
   return v.ticketId?<Link key={v.id} href={`/pos-tickets/${encodeURIComponent(v.ticketId)}?${new URLSearchParams({returnTo:reportHref(selected)})}`} prefetch={false} onClick={remember} className={styles.visit}>{content}</Link>:<div key={v.id} className={styles.visit}>{content}</div>;})}
  {!visits.length&&<p className={styles.note}><WorkspaceText text="No activity for this date."/></p>}
  {visits.length>limit&&<button className={styles.more} onClick={()=>setLimit(n=>n+30)}><WorkspaceText text="Show more"/> ({visits.length-limit})</button>}
  <div className={styles.total}><span><WorkspaceText text={selected?"Total of displayed tickets":"Ticket total"}/></span><strong>{money(visits.reduce((n,v)=>n+(v.amount??0),0))}</strong></div>
  <p className={styles.note}><WorkspaceText text="Submitted ticket totals may include tax and tips. Expected follows the existing daily POS formula."/></p>
  {overview.notes.map(note=><p className={styles.error} key={note}><WorkspaceText text={note}/></p>)}
  <p className={styles.note}><WorkspaceText text="Updated"/> {new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",timeZone:overview.timeZone}).format(new Date(updatedAt??overview.updatedAt))}</p>
 </section>;
}
