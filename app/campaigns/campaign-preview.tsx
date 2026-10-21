"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { WorkspaceText } from "@/components/workspace-language";
import { formatCredits } from "@/lib/campaign-credit-display";
import { loadCampaignPreviewAction } from "./preview-actions";
import { CampaignModal } from "./campaign-modal";
import styles from "./campaign-ui.module.css";
type Preview = Awaited<ReturnType<typeof loadCampaignPreviewAction>>;
const labels = {awaiting_payment:"Credits needed",pending_review:"In review",running:"Running",paused:"Paused",cancelled:"Cancelled",completed:"Finished",rejected:"Not approved"};
export function CampaignPreview({id,onClose}:{id:string;onClose:()=>void}) {
  const [result,setResult]=useState<Preview|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let current=true;loadCampaignPreviewAction(id).then(data=>{if(current)setResult(data);}).catch(()=>{if(current)setError("Preview could not load. Please retry.");});return()=>{current=false;};},[id,attempt]);
  const text=(s:string)=><WorkspaceText text={s}/>;
  const c=result?.campaign;
  const status=c ? c.status==="running" && c.ends_at && Date.parse(c.ends_at)<=Date.parse(result!.checkedAt) ? "Period ended — awaiting reconciliation" : c.status==="running" && c.starts_at && Date.parse(c.starts_at)>Date.parse(result!.checkedAt) ? "Scheduled" : labels[c.status] : undefined;
  return <CampaignModal title="Ad preview" status={status} onClose={onClose}>
    <p>{text("Preview only. No views are counted and no credits are used here.")}</p>
    {error?<p role="alert">{text(error)} <button className={styles.link} onClick={()=>{setError("");setResult(null);setAttempt(n=>n+1);}}>{text("Try again")}</button></p>:!result?<p role="status">{text("Loading preview…")}</p>:<>
      {result.creative?<article><small>{text("Sponsored · Preview")}</small><h3>{result.creative.title}</h3>{result.creative.image?<Image src={result.creative.image} alt="" width={960} height={720} unoptimized style={{width:"100%",height:"auto",maxHeight:320,objectFit:"contain"}}/>:null}<p style={{whiteSpace:"pre-wrap"}}>{result.creative.caption}</p></article>:<p>{text("The source post is unavailable for delivery.")}</p>}
      <p>{text("Target area")}: {[c!.location,c!.area==="neighborhood"?c!.city:"",c!.area!=="country"?c!.state:"",c!.country].filter((v,i,a)=>v&&a.indexOf(v)===i).join(", ")}</p>
      <p>{text("Delivery depends on audience location, search relevance, schedule and available views. Your own salon's ads are excluded from your Explore feed.")}</p>
      <dl>{[["Campaign budget",formatCredits(c!.total_price_cents)],["Credits used",formatCredits(c!.spent_cents)],["Reserved credits remaining",c!.reserved_credits==null||c!.released_credits==null?"Unavailable":formatCredits(Math.max(0,c!.reserved_credits-c!.released_credits-c!.spent_cents))],["Credits returned",c!.released_credits==null?"Unavailable":formatCredits(c!.released_credits)],["Valid delivery views",c!.views.toLocaleString()]].map(([label,value])=><div className={styles.detailRow} key={label}><dt>{text(label)}</dt><dd>{value}</dd></div>)}</dl>
      <p className={styles.muted}>{text("Accounting totals at")}: {new Date(result.checkedAt).toLocaleString()}. {text("Use Campaign results for the daily breakdown. Returned credits are separate from unused reserved credits.")}</p>
    </>}
  </CampaignModal>;
}
