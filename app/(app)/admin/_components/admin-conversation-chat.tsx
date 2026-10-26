"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { SupportConversation } from "@/lib/support-cases";
import { sendSupportMessage, uploadSupportEvidence } from "@/app/support/actions";

type Pending = { id: string; body: string; failed: boolean };
export function AdminConversationChat({ conversation, onRefresh, onDraftChange }: { conversation: SupportConversation; onRefresh: () => Promise<void>; onDraftChange: (value: boolean) => void }) {
 const [body,setBody]=useState("");
 const [pending,setPending]=useState<Pending|null>(null);
 const [uploading,setUploading]=useState(false);
 const [error,setError]=useState("");
 const scroll=useRef<HTMLDivElement>(null), file=useRef<HTMLInputElement>(null), sending=useRef(false), nearBottom=useRef(true);
 const ended=["resolved","closed"].includes(conversation.status), canReply=conversation.can_reply!==false;
 useEffect(()=>{onDraftChange(!!body.trim()||!!pending||uploading);},[body,pending,uploading,onDraftChange]);
 useEffect(()=>{if(nearBottom.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[conversation.messages.length,conversation.attachments.length,pending]);
 async function send(retry?:Pending){
  if(sending.current||!canReply)return;
  const message=retry??{id:crypto.randomUUID(),body:body.trim(),failed:false};
  if(!message.body)return;
  sending.current=true;nearBottom.current=true;setPending({...message,failed:false});if(!retry)setBody("");setError("");
  try{await sendSupportMessage(conversation.id,message.body,ended,message.id);await onRefresh();setPending(null);}
  catch{setPending({...message,failed:true});setError("Delivery could not be confirmed. Retry safely with the same message.");}
  finally{sending.current=false;}
 }
 async function attach(selected:File){
  if(uploading)return;
  setUploading(true);setError("");
  try{const form=new FormData();form.set("caseId",conversation.id);form.set("file",selected);await uploadSupportEvidence(form);nearBottom.current=true;await onRefresh();}
  catch(e){setError(e instanceof Error?e.message:"Could not upload evidence.");}
  finally{setUploading(false);if(file.current)file.current.value="";}
 }
 return <div className="admin-messenger">
  <div className="admin-chat-context"><h2>{conversation.review?.kind==="post_report"?"Content report":conversation.summary}</h2><span>{conversation.reference} · {conversation.status.replaceAll("_"," ")}</span></div>
  <div className="admin-chat-history" ref={scroll} onScroll={()=>{const el=scroll.current;if(el)nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}} aria-label="Conversation messages" aria-live="polite">
   <p className="admin-chat-start">Private conversation with the requester</p>
   {conversation.messages.map(message=><div key={message.id} className={`admin-chat-message ${message.sender==="support"?"is-own":""}`}><small>{message.sender==="support"?"Support":"Requester"}</small><p>{message.body}</p><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</time></div>)}
   {conversation.attachments.map(a=><a className="admin-chat-attachment" href={a.url} key={a.id} target="_blank" rel="noreferrer">{a.url&&/\.(png|jpe?g|webp)$/i.test(a.name)&&<Image src={a.url} alt={a.name} width={280} height={180} unoptimized />}<span>↗ {a.name}</span></a>)}
   {conversation.resolution&&<p className="admin-chat-start">{conversation.resolution}</p>}
   {pending&&<div className="admin-chat-message is-own is-pending"><p>{pending.body}</p><small>{pending.failed?<button type="button" onClick={()=>void send(pending)}>Retry message</button>:"Sending…"}</small></div>}
  </div>
  {error&&<p className="admin-chat-error" role="alert">{error}</p>}
  {canReply?<form className="admin-chat-composer" onSubmit={e=>{e.preventDefault();if(!pending)void send();}}>
   <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e=>{const selected=e.target.files?.[0];if(selected)void attach(selected);}} />
   <button type="button" aria-label="Attach evidence" disabled={uploading} onClick={()=>file.current?.click()}>{uploading?"…":"＋"}</button>
   <textarea aria-label="Reply to the user" placeholder="Write a message…" maxLength={10000} rows={2} value={body} onChange={e=>setBody(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!pending)void send();}}}/>
   <button type="submit" aria-label="Send message" disabled={!body.trim()||!!pending}>➤</button>
  </form>:<p className="admin-chat-start">You do not have permission to reply.</p>}
 </div>;
}
