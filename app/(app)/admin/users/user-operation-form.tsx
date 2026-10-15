"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import type { UserOperationResult } from "@/types/admin-users-workspace";
import { userWorkspaceAction } from "./workspace-actions";
import styles from "./users.module.css";

export function UserOperationForm({children,operation,userId,confirm,label="Save changes",onResult,action=userWorkspaceAction,onCancel,reset=false}: {
 children:ReactNode;operation:string;userId?:string;confirm?:string;label?:string;
 onResult:(result:UserOperationResult)=>void;action?:(form:FormData)=>Promise<UserOperationResult>;onCancel?:()=>void;reset?:boolean;
}) {
 const ref=useRef<HTMLFormElement>(null);const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
 const [confirmation,setConfirmation]=useState<FormData|null>(null);
 const [pending,startTransition]=useTransition();const busy=useRef(false);
 function submit(form:FormData) {
  if(busy.current||ref.current?.closest('[data-user-workspace]')?.querySelector('form[aria-busy="true"]'))return;busy.current=true;setConfirmation(null);
  startTransition(async()=>{let result:UserOperationResult;
   try{result=await action(form);}catch{result={ok:false,message:"The result could not be confirmed. Refresh before retrying."};}
   busy.current=false;
   if(result.ok){setRequestId(crypto.randomUUID());if(reset)ref.current?.reset();}
   onResult(result);
  });
 }
 return <form ref={ref} aria-busy={pending} className={styles.operationForm} onSubmit={e=>{
  e.preventDefault();if(pending||busy.current||!requestId)return;
  const form=new FormData(e.currentTarget);const button=(e.nativeEvent as SubmitEvent).submitter;
  if(button instanceof HTMLButtonElement&&button.name)form.set(button.name,button.value);
  if(confirm)setConfirmation(form);else submit(form);
 }}>
  <input type="hidden" name="operation" value={operation}/>{userId&&<input type="hidden" name="user_id" value={userId}/>}
  <input type="hidden" name="request_id" value={requestId}/>
  <fieldset disabled={pending||!!confirmation}>{children}<div className={styles.formFooter}><button type="submit" className={styles.primary} disabled={!requestId}>{label}</button>{onCancel&&<button type="button" className={styles.button} onClick={onCancel}>Cancel</button>}</div></fieldset>
  {confirmation&&<div className={styles.confirmation} role="group" aria-label="Confirm action"><p>{confirm}</p><div className={styles.actions}><button type="button" className={styles.primary} onClick={()=>submit(confirmation)}>Confirm</button><button type="button" className={styles.button} onClick={()=>setConfirmation(null)}>Back</button></div></div>}
  {pending&&<p role="status" className={styles.notice}>Saving…</p>}
 </form>;
}
export function UserReason({label="Reason"}:{label?:string}) {return <label className={styles.full}>{label}<textarea name="reason" required minLength={3} maxLength={1000} rows={2} placeholder="Explain this change…"/></label>;}
