"use client";
import { useEffect, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { CampaignReport } from "@/types/owner-campaign";
import { campaignDaySeries, campaignDeliveryExplanation } from "@/lib/campaign-report";
import { loadCampaignReportAction } from "./actions";
import styles from "./campaign-ui.module.css";
const names = { views:"Views", clicks:"Unique clicks", likes:"Likes", comments:"Comments", bookings:"Customers who booked" };
type Metric = keyof typeof names;

export function CampaignResults({ id, compact=false, revision="" }: { id:string; compact?:boolean; revision?:string }) {
  const t=useWorkspaceTranslation();
  const [days,setDays]=useState(7),[metric,setMetric]=useState<Metric>("views"),[retry,setRetry]=useState(0),[selected,setSelected]=useState("");
  const [result,setResult]=useState<{key:string;data:CampaignReport|null;error:string}|null>(null);
  const key=`${id}:${days}:${revision}:${retry}`;
  useEffect(()=>{
    let active=true;
    loadCampaignReportAction(id,days).then(data=>{if(active)setResult({key,data,error:""});})
      .catch(()=>{if(active)setResult({key,data:null,error:"Results could not load. Please retry."});});
    return()=>{active=false;};
  },[id,days,key]);
  const current=result?.key===key?result:null;
  const report=current?.data;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const series=campaignDaySeries(report?.days??[],days,today);
  const max=Math.max(1,...series.map(r=>r[metric]));
  return <div className={styles.chart}>
    <div className={styles.row}><span className={styles.muted}><WorkspaceText text={names[metric]}/> · {days} <WorkspaceText text="days"/></span>{!compact?<label className={styles.muted}><WorkspaceText text="Period"/><select aria-label={t("Result period")} value={days} onChange={e=>{setDays(Number(e.target.value));setSelected("");}}>{[7,30,90].map(d=><option key={d} value={d}>{d} {t("days")}</option>)}</select></label>:null}</div>
    {current?.error?<p className={styles.error} role="alert">{t(current.error)} <button className={styles.link} onClick={()=>setRetry(n=>n+1)}>{t("Try again")}</button></p>:!report?<p className={styles.muted}>{t("Loading results…")}</p>:<>
      {!compact?<>
        <p role="status"><WorkspaceText text={campaignDeliveryExplanation(report.deliveryReason)}/></p>
        <small className={styles.muted}><WorkspaceText text="Last recorded view"/>: {report.lastViewAt?new Date(report.lastViewAt).toLocaleString():t("None yet")} · <WorkspaceText text="Updated"/>: {new Date(report.checkedAt).toLocaleString()}</small>
      </>:null}
      <div className={styles.plot} role="group" aria-label={t("Daily campaign results")}>{series.map(r=>{
        const end=new Date(`${r.until}T12:00:00Z`);end.setUTCDate(end.getUTCDate()-1);
        const label=r.day===end.toISOString().slice(0,10)?r.day:`${r.day} – ${end.toISOString().slice(0,10)}`;
        const value=`${label}: ${r[metric]} ${t(names[metric])}`;
        return <button className={styles.bar} key={r.day} aria-label={value} aria-pressed={selected===value} onClick={()=>setSelected(value)}><span className={styles.barValue}>{r[metric].toLocaleString()}</span><span className={styles.barMark} style={{height:`${r[metric]/max*80}px`}}/><span className={styles.barDay}>{r.day.slice(5).replace("-","/")}</span></button>;
      })}</div>
      <small className={styles.muted} aria-live="polite">{selected||t(days===7?"Select a day to see its results.":"Select a date range to see its results.")}</small>
      {!compact?<>
        <p className={styles.muted}><WorkspaceText text="Reporting days use America/Chicago. Clicks are unique per visitor and campaign and may occur before a billable view. Views are not unique people."/></p>
        <h3><WorkspaceText text="Attributed customer outcomes · all time"/></h3>
        <div className={styles.detailRow}><span><WorkspaceText text="Completed booking evidence"/></span><strong>{report.bookingOutcomes.completed}</strong></div>
        <div className={styles.detailRow}><span><WorkspaceText text="Cancelled booking evidence"/></span><strong>{report.bookingOutcomes.cancelled}</strong></div>
        <div className={styles.detailRow}><span><WorkspaceText text="Other booking states"/></span><strong>{report.bookingOutcomes.other}</strong></div>
        <div className={styles.detailRow}><span><WorkspaceText text="Evidence unavailable"/></span><strong>{report.bookingOutcomes.unavailable}</strong></div>
        <p className={styles.muted}><WorkspaceText text="Attribution counts a customer once per campaign after a signed-in click within 7 days. Guest-to-login journeys and booking starts are not measured. The original attributed booking may later be cancelled; attributed totals remain historical. These counts are not revenue or all appointments."/></p>
      </>:null}
    </>}
    {!compact?<div className={styles.chartChoice}>{Object.entries(names).map(([name,label])=><button key={name} aria-pressed={metric===name} onClick={()=>{setMetric(name as Metric);setSelected("");}}><WorkspaceText text={label}/></button>)}</div>:null}
  </div>;
}
