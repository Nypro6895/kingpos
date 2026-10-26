"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { WorkspaceText } from "@/components/workspace-language";
import { formatCredits } from "@/lib/campaign-credit-display";
import { campaignStatus } from "@/lib/campaign-status";
import { loadCampaignPreviewAction } from "./preview-actions";
import { CampaignModal } from "./campaign-modal";
import styles from "./campaign-ui.module.css";
type Preview = Awaited<ReturnType<typeof loadCampaignPreviewAction>>;
export function CampaignPreview({id,onClose}:{id:string;onClose:()=>void}) {
  const [result,setResult]=useState<Preview|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  const [refreshing,setRefreshing]=useState(false),[imageFailed,setImageFailed]=useState(false);
  useEffect(()=>{
    let current=true;
    loadCampaignPreviewAction(id).then(data=>{
      if(current){setResult(data);setError("");setImageFailed(false);setRefreshing(false);}
    }).catch(()=>{if(current){setResult(null);setError("Preview could not load. Please retry.");setRefreshing(false);}});
    return()=>{current=false;};
  },[id,attempt]);
  const text=(s:string)=><WorkspaceText text={s}/>;
  const report=result?.campaign.id===id?result:null,c=report?.campaign;
  const status=c?campaignStatus(c,Date.parse(report!.checkedAt)):null;
  const creativeError=imageFailed?"Preview image could not load. Accounting totals are still available.":report?.creativeError;
  function retry(){setError("");setRefreshing(true);setAttempt(n=>n+1);}
  return <CampaignModal title="Ad preview" status={status?.label} onClose={onClose}>
    <p>{text("Preview only. No views are counted and no credits are used here.")}</p>
    {error?<p role="alert">{text(error)} <button className={styles.link} disabled={refreshing} onClick={retry}>{text("Try again")}</button></p>:null}
    {!report&&!error?<p role="status">{text("Loading preview…")}</p>:null}
    {report?<>
      {creativeError?<p role="alert">{text(creativeError)} <button className={styles.link} disabled={refreshing} onClick={retry}>{text(refreshing?"Retrying preview…":"Retry preview image")}</button></p>:null}
      {report.creative?<article><small>{text("Sponsored · Preview")}</small><h3>{report.creative.title}</h3>{report.creative.image&&!imageFailed?<Image key={`${report.creative.image}:${attempt}`} src={report.creative.image} alt="" width={960} height={720} unoptimized onError={()=>setImageFailed(true)} style={{width:"100%",height:"auto",maxHeight:320,objectFit:"contain"}}/>:null}<p style={{whiteSpace:"pre-wrap"}}>{report.creative.caption}</p></article>:!creativeError?<p>{text("The source post is unavailable for delivery.")}</p>:null}
      <p>{text("Target area")}: {[c!.location,c!.area==="neighborhood"?c!.city:"",c!.area!=="country"?c!.state:"",c!.country].filter((v,i,a)=>v&&a.indexOf(v)===i).join(", ")}</p>
      <p>{text("Delivery depends on audience location, search relevance, schedule and available views. Your own salon's ads are excluded from your Explore feed.")}</p>
      {status?.ownerPaused&&c?.status==="paused"?<p role="status">{text("Unused credits stay reserved while paused. Resume continues this campaign; Cancel returns the unused credits to your salon balance.")}</p>:null}
      {status?.awaitingReconciliation?<p role="status">{text("This period has ended. Delivery has stopped; credit reconciliation is pending.")}</p>:null}
      <dl>{[["Campaign budget",formatCredits(c!.total_price_cents)],["Credits used",formatCredits(c!.spent_cents)],["Reserved credits remaining",c!.reserved_credits==null||c!.released_credits==null?"Unavailable":formatCredits(Math.max(0,c!.reserved_credits-c!.released_credits-c!.spent_cents))],["Credits returned",report.returns.complete&&report.returns.total!==null?formatCredits(report.returns.total):"Unavailable (incomplete records)"],["Valid delivery views",c!.views.toLocaleString()]].map(([label,value])=><div className={styles.detailRow} key={label}><dt>{text(label)}</dt><dd>{text(value)}</dd></div>)}</dl>
      {!report.returns.complete?<>
        <p role="status">{text(report.returns.reason==="legacy_unattributed_refunds"?"Some older refunds cannot be attributed to this campaign. The total returned is unavailable; recorded refunds are shown below.":"Refund records need reconciliation. The total returned is unavailable; recorded refunds are shown below.")}</p>
        <dl>{[["Recorded refunds",report.returns.known],["Recorded closure refunds",report.returns.closure],["Recorded limit refunds",report.returns.limit]].map(([label,value])=><div className={styles.detailRow} key={label}><dt>{text(String(label))}</dt><dd>{formatCredits(Number(value))}</dd></div>)}</dl>
      </>:null}
      <p className={styles.muted}>{text("Accounting totals at")}: {new Date(report.checkedAt).toLocaleString()}. {text("Use Campaign results for the daily breakdown. Returned credits are separate from unused reserved credits.")}</p>
    </>:null}
  </CampaignModal>;
}
