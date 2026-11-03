"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { WorkspaceText } from "@/components/workspace-language";
import { loadCampaignPreviewAction } from "./preview-actions";
import styles from "./campaign-ui.module.css";

type Preview = Awaited<ReturnType<typeof loadCampaignPreviewAction>>;

/** Owner inspection only: never selects delivery or admits a billable impression. */
export function CampaignPostContent({ id, sourceId, title, children, onPreview }: { id:string; sourceId:string; title:string; children?:ReactNode; onPreview:()=>void }) {
  const root=useRef<HTMLDivElement>(null);
  const [near,setNear]=useState(false),[attempt,setAttempt]=useState(0);
  const [result,setResult]=useState<{key:string;preview:Preview|null;error:boolean}|null>(null);
  const [failedImage,setFailedImage]=useState<string|null>(null);
  const key=`${id}:${sourceId}:${attempt}`;
  const loadedKey=result?.key;
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const observer=new IntersectionObserver(entries=>setNear(entries[0].isIntersecting),{rootMargin:"300px"});
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!near||loadedKey===key)return;
    let current=true;
    loadCampaignPreviewAction(id).then(preview=>{if(current)setResult({key,preview,error:false});})
      .catch(()=>{if(current)setResult({key,preview:null,error:true});});
    return()=>{current=false;};
  },[id,key,near,loadedKey]);
  useEffect(()=>{
    const timer=setInterval(()=>{if(near&&document.visibilityState==="visible")setAttempt(n=>n+1);},240000);
    return()=>clearInterval(timer);
  },[near]);
  const current=result?.key===key?result:null;
  const creative=current?.preview?.creative;
  const image=creative?.image;
  const unavailable=current?.error||current?.preview?.creativeError||failedImage===key;
  return <div ref={root} className={styles.postContent}>
    <button className={styles.postPhoto} onClick={onPreview} aria-label={`Preview post: ${title}`}>
      {image&&failedImage!==key?<Image unoptimized src={image} alt={creative?.title||title} width={144} height={144} sizes="72px" onError={()=>setFailedImage(key)}/>:<span className={styles.postLoading}><WorkspaceText text={!current?"Loading…":"No photo"}/></span>}
    </button>
    <div className={styles.postDetails}>{children}
      {creative?.caption?<p className={styles.postCaption}>{creative.caption}</p>:null}
      {unavailable?<p className={styles.postFallback} role="status"><WorkspaceText text="Photo unavailable."/> <button className={styles.link} onClick={()=>setAttempt(n=>n+1)}><WorkspaceText text="Retry photo"/></button></p>:current&&!creative?<p className={styles.postFallback}><WorkspaceText text="Post unavailable. History is preserved."/></p>:null}
    </div>
  </div>;
}
