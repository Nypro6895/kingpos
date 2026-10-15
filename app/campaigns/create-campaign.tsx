"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import Image from "next/image";
import {createCampaignCreativeAction} from "./creative-actions";
import type {CampaignCreativeTarget} from "@/types/owner-campaign";
import styles from "@/components/owner-campaign.module.css";
export function CreateCampaign({onClose,onCreated}:{onClose:()=>void;onCreated:(target:CampaignCreativeTarget)=>void}){
  const __vt = useWorkspaceTranslation();

  const dialog=useRef<HTMLDialogElement>(null);const opener=useRef<HTMLElement|null>(null);
  const [id]=useState(()=>crypto.randomUUID());const [image,setImage]=useState<File|null>(null);const [preview,setPreview]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{opener.current=document.activeElement as HTMLElement;const element=dialog.current;element?.showModal();return()=>{element?.close();opener.current?.focus();};},[]);
  useEffect(()=>{
    const url=image?URL.createObjectURL(image):"";
    // Publish the Blob URL renewed by the browser when Activity restores this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return()=>{if(url)URL.revokeObjectURL(url);};
  },[image]);
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="create-ad-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><div className={styles.modal}><header className={styles.modalHeader}><span className={styles.eyebrow}><WorkspaceText text="YOUR NEXT OPPORTUNITY" /></span><button className={styles.close} aria-label={__vt("Close create ad")} disabled={busy} onClick={onClose}>×</button></header><h2 id="create-ad-title"><WorkspaceText text="Create your ad." /></h2><p className={styles.muted}><WorkspaceText text="A great photo. A simple message. More people discovering your business." /></p><form onSubmit={async event=>{event.preventDefault();setBusy(true);setError("");try{const form=new FormData(event.currentTarget);form.set("id",id);const result=await createCampaignCreativeAction(form);if(result.ok&&result.target)onCreated(result.target);else setError(result.message??"Please try again.");}catch{setError("Your ad could not save. Please try again.");}finally{setBusy(false);}}}><label className={styles.label}><WorkspaceText text="Your photo" /><input name="image" type="file" required accept="image/jpeg,image/png,image/webp" onChange={event=>{const file=event.target.files?.[0];if(file&&file.size<=5242880)setImage(file);else{setImage(null);setError("Choose an image under 5 MB.");}}}/></label>{preview?<Image src={preview} alt={__vt("Your ad preview")} width={480} height={300} unoptimized style={{width:"100%",height:200,objectFit:"cover",borderRadius:14}}/>:null}<label className={styles.label}><WorkspaceText text="Headline" /><input name="title" required maxLength={120} placeholder={__vt("A little time for yourself")}/></label><label className={styles.label}><WorkspaceText text="What would you like to say?" /><textarea name="caption" required maxLength={2200} rows={4} placeholder={__vt("Tell people what makes your salon special…")}/></label><p className={styles.note}><WorkspaceText text="JPG, PNG or WebP · Up to 5 MB. Your ad is reviewed before it appears." /></p>{error?<p className={styles.error} role="alert"><WorkspaceText text={error} /></p>:null}<div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={onClose}><WorkspaceText text="Cancel" /></button><button className={styles.primary} disabled={busy}><WorkspaceText text={busy?"Saving…":"Choose audience →"} /></button></div></form></div></dialog>,document.body);
}
