"use client";
import Image from "next/image";
import {useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import type {OwnerCampaign} from "@/types/owner-campaign";
import {previewOwnerCampaignAction,reviewOwnerCampaignAction} from "../owner-settings-actions";
import styles from "@/components/owner-campaign.module.css";
export function CampaignReviewQueue({campaigns}:{campaigns:OwnerCampaign[]}){
 const router=useRouter();const [busy,start]=useTransition();const [message,setMessage]=useState("");
 const [preview,setPreview]=useState<{id:string;href:string|null;caption:string;image:string|null}|null>(null);
 const [reasons,setReasons]=useState<Record<string,string>>({});
 return <section>{message?<p role="status">{message}</p>:null}{!campaigns.length?<p>No ads are waiting for review.</p>:campaigns.map(c=><article key={c.id} className={styles.card} style={{marginBottom:16}}>
 <div className={styles.cardHeader}><h2>{c.title}</h2><small>In review</small></div><p>{c.location}, {c.country} · Submitted {new Date(c.updated_at??c.created_at).toLocaleString()}</p>
 <button disabled={busy} className={styles.secondary} onClick={()=>start(async()=>{try{setPreview({id:c.id,...await previewOwnerCampaignAction(c.id)});}catch{setMessage("Ad preview could not load. Please retry.");}})}>Preview ad</button>
 {preview?.id===c.id?<div>{preview.image?<Image unoptimized src={preview.image} alt={c.title} width={600} height={400} style={{width:"100%",maxWidth:600,height:"auto"}}/>:null}<p style={{whiteSpace:"pre-wrap"}}>{preview.caption}</p>{preview.href?<a href={preview.href} target="_blank" rel="noopener noreferrer">Open published post</a>:null}</div>:null}
 <label className={styles.label}>Review note for salon<input maxLength={1000} value={reasons[c.id]??""} placeholder="Explain a decline or add an approval note" onChange={e=>setReasons({...reasons,[c.id]:e.target.value})}/></label>
 <div className={styles.actions}>{[true,false].map(approve=><button key={String(approve)} className={approve?styles.primary:styles.secondary} disabled={busy||(!approve&&(reasons[c.id]??"").trim().length<3)} onClick={()=>start(async()=>{try{const result=await reviewOwnerCampaignAction(c.id,approve,reasons[c.id]?.trim()||(approve?"Approved after ad review":""));setMessage(result.message);if(result.ok){setPreview(null);router.refresh();window.dispatchEvent(new Event("campaign:reviewed"));}}catch{setMessage("Review could not save. Please retry.");}})}>{approve?"Approve & run":"Decline & return unused credits"}</button>)}</div>
 </article>)}</section>;
}
