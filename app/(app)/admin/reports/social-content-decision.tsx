'use client';

import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import type {ExactTextModerationState} from '@/types/admin-exact-text-moderation';
import type {SocialTextReportEvidence} from '@/types/social-text-reports';
import {loadExactTextModerationAction, setExactTextVisibilityAction} from './exact-text-actions';
import styles from './report-case-view.module.css';

type Attempt = {reportId:string;requestId:string;expectedVersion:string;action:'hide'|'restore';reason:string};
type Notice = {ok:boolean;message:string};
const labels:Record<string,{title:string;source:string;noun:string}> = {
 comment:{title:'Reported comment',source:'Post comment',noun:'comment'},
 review:{title:'Reported review',source:'Salon review',noun:'review'},
 experience:{title:'Reported experience',source:'Visit experience',noun:'experience'},
 review_reply:{title:'Reported salon reply',source:'Reply to a review',noun:'reply'},
 experience_reply:{title:'Reported salon reply',source:'Reply to a visit experience',noun:'reply'},
};
function date(value:string){return Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Chicago'}).format(new Date(value))+' CT':'Time not recorded';}

export function SocialContentDecision({reportId,reportNumber,initialState,fallbackEvidence,canRead,canReview}:{
 reportId:string;reportNumber:string;initialState?:ExactTextModerationState|null;fallbackEvidence?:SocialTextReportEvidence|null;canRead:boolean;canReview:boolean;
}){
 const router=useRouter(),reasonId=useId();
 const [view,setView]=useState<{source:ExactTextModerationState|null|undefined;current:ExactTextModerationState|null}>({source:initialState,current:initialState??null});
 const [reason,setReason]=useState(''),[pending,setPending]=useState(false),[refreshing,setRefreshing]=useState(false);
 const [uncertain,setUncertain]=useState(false),[needsRefresh,setNeedsRefresh]=useState(false),[notice,setNotice]=useState<Notice|null>(null);
 const attempt=useRef<Attempt|null>(null),busy=useRef(false),mounted=useRef(true),authority=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 // A response authorized against older SSR evidence/role props must never
 // replace newer unavailable evidence or revoked capabilities after commit.
 useLayoutEffect(()=>{authority.current+=1;},[initialState,canRead,canReview]);
 // Keep an incoming unavailable/revoked state authoritative without a second
 // effect render; an older server render must not undo a confirmed decision.
 let state=view.current;
 if(view.source!==initialState){
  state=!initialState||initialState.status==='unavailable'||!state||initialState.revision>=state.revision?initialState??null:state;
  setView({source:initialState,current:state});
 }
 const setState=(next:ExactTextModerationState)=>setView(previous=>({...previous,current:next}));

 const kind=state?.kind??(fallbackEvidence?.status==='available'?fallbackEvidence.kind:null);
 const label=labels[kind??'']??{title:'Reported content',source:'Text report',noun:'content'};
 const current=canRead&&state?.status==='available';
 const operation=state&&current&&state.evidenceVersion&&canReview
  ?state.moderationStatus==='hidden'&&state.canRestore?'restore':state.canHide?'hide':null:null;
 const otherHolds=Math.max(0,state?.otherHoldCount??0);
 const recovery=uncertain&&canReview&&current;
 const canUseRecordedEvidence=!state||state.availabilityVerified===false;
 const body=canRead?state?.body??(canUseRecordedEvidence&&fallbackEvidence?.status==='available'?fallbackEvidence.body:null):null;
 const visibility=canRead&&state?.moderationStatus==='hidden'?'Hidden':current&&state?.moderationStatus==='visible'?(state.canHide?'Visible':'Not hidden'):'Unavailable';
 const history=canRead&&Array.isArray(state?.history)?state.history:[];

 async function refresh(){
  if(busy.current)return;busy.current=true;setRefreshing(true);const generation=authority.current;
  try{
   const fresh=await loadExactTextModerationAction(reportId);
   if(!mounted.current||authority.current!==generation)return;
   setState(fresh);setNeedsRefresh(false);
   if(!uncertain)setNotice(null);
  }catch{
   if(mounted.current&&authority.current===generation)setNotice({ok:false,message:'The content could not refresh. Your decision reason is kept. Please try again.'});
  }finally{busy.current=false;if(mounted.current)setRefreshing(false);}
 }
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy.current||!canRead||!canReview)return;
  let request=attempt.current;
  if(!request){
   if(!operation||!state?.evidenceVersion||needsRefresh)return;
   const trimmed=reason.trim();
   if(trimmed.length<3||trimmed.length>2000){setNotice({ok:false,message:'Enter a decision reason of 3–2,000 characters.'});return;}
   request={reportId,requestId:crypto.randomUUID(),expectedVersion:state.evidenceVersion,action:operation,reason:trimmed};
   attempt.current=request;
  }
  busy.current=true;setPending(true);setNotice(null);const generation=authority.current;
  try{
   const result=await setExactTextVisibilityAction(request);
   if(!mounted.current)return;
   if(authority.current!==generation){setUncertain(true);setNotice({ok:false,message:'The case changed while this decision was saving. Its result is not confirmed here. Your reason is kept; refresh the current content before retrying.'});return;}
   if(result.ok){
    setState(result.state);attempt.current=null;setUncertain(false);setNeedsRefresh(false);setReason('');
    setNotice({ok:true,message:request.action==='restore'&&result.state.moderationStatus==='hidden'?'This case’s hide was released. Another restriction keeps the content hidden.':'Decision recorded. The current content status is shown above.'});
    router.refresh();
   }else if(result.code==='unknown'){
    setUncertain(true);setNotice({ok:false,message:'The decision result is not confirmed. Keep this reason and retry the same decision.'});
   }else{
    if(result.state)setState(result.state);
    attempt.current=null;setUncertain(false);setNeedsRefresh(true);
    setNotice({ok:false,message:result.message});
   }
  }catch{
   if(mounted.current){setUncertain(true);setNotice({ok:false,message:'The decision result is not confirmed. Keep this reason and retry the same decision.'});}
  }finally{busy.current=false;if(mounted.current)setPending(false);}
 }

 return <section className={styles.socialDecision} aria-label="Reported text evidence">
  <header className={styles.header}><div><h2>{label.title}</h2><p className={styles.meta}>{label.source} · {reportNumber}</p></div><span className={styles.status} data-complete={visibility==='Visible'}>{visibility}</span></header>
  <div className={styles.socialDecisionBody}>
   {body!==null?<><p className={styles.meta}>{current?'Current content':'Recorded text · current availability not confirmed'}</p><p className={`${styles.body} ${styles.quote}`}>{body||'No written text remains.'}</p></>:<p className={styles.muted}>The reported text is unavailable. Review the case history or refresh to check its current state.</p>}
   {current&&visibility==='Visible'?<p className={styles.muted}>Currently visible to eligible viewers.</p>:visibility==='Hidden'?<p className={styles.muted}>Hidden from public view. The record is kept.</p>:null}
   {current&&otherHolds>0?<p className={styles.muted}>Another case also keeps this content hidden. This decision changes only this case’s hide.</p>:null}
   {!canRead||!canReview?<p className={styles.muted}>Content decisions are unavailable for your role.</p>:!operation&&!uncertain?<p className={styles.muted}>{state?.blockedReason||'A current, eligible target is required before changing content visibility.'}</p>:null}
   {(operation||uncertain||reason)&&<form className={`${styles.form} ${styles.socialDecisionForm}`} onSubmit={submit}>
    <label htmlFor={reasonId}>Decision reason<textarea id={reasonId} value={reason} onChange={e=>{setReason(e.target.value);if(!needsRefresh&&!uncertain)setNotice(null);}} required minLength={3} maxLength={2000} rows={3} readOnly={!canReview||uncertain||!operation} disabled={pending||refreshing} placeholder={operation==='restore'?'Explain why this case’s hide can be released.':'Explain why this content should be hidden.'}/></label>
    {(recovery||operation)&&<button type="submit" className={`${styles.button} ${styles.primary}`} disabled={pending||refreshing||(!recovery&&needsRefresh)}>{pending?'Saving decision…':recovery?'Confirm previous decision':operation==='restore'&&otherHolds>0?'Release this hide':operation==='hide'&&visibility==='Hidden'?'Hide for this case':`${operation==='restore'?'Restore':'Hide'} ${label.noun}`}</button>}
    {uncertain?<p className={styles.muted}>Editing is locked until this same decision is confirmed. Refreshing does not start another decision.</p>:operation?<p className={styles.muted}>{operation==='hide'?'Soft hide. Keep the content and decision history.':'Release only this case’s hide after reviewing the appeal and current content. Other restrictions remain.'}</p>:null}
   </form>}
   {notice&&<p className={notice.ok?styles.socialSuccess:styles.socialNotice} role={notice.ok?'status':'alert'}>{notice.message}</p>}
   {needsRefresh&&<p className={styles.muted}>Refresh the content before starting another decision. Your reason is kept.</p>}
   <button type="button" className={styles.caseTextAction} onClick={()=>void refresh()} disabled={pending||refreshing}>{refreshing?'Refreshing content…':'Refresh content'}</button>
   <details className={styles.socialDecisionHistory}><summary>Decision history{history.length?` (${history.length})`:''}</summary>{history.length?<ol className={styles.timeline}>{history.map(item=><li key={item.id}><strong>{item.action==='hide'?'Hidden for this case':'This case’s hide released'}</strong><p className={styles.body}>{item.reason}</p><span className={styles.time}>{item.actorName||'Reviewer'} · {date(item.createdAt)}</span></li>)}</ol>:<p className={styles.muted}>No content decision recorded.</p>}</details>
  </div>
 </section>;
}
