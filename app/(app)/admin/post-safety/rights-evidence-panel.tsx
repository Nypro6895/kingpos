'use client';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import Image from 'next/image';
import type {RightsCaseEvidence,RightsOperatorResult} from '@/lib/platform-admin/rights-evidence';
import {readRightsEvidenceIntent,saveRightsEvidenceIntent,clearRightsEvidenceIntent,type RightsEvidenceIntent as Attempt} from '@/lib/rights-evidence-intent';
import {captureRightsEvidenceAction,loadRightsEvidenceCaseAction,requestRightsOriginRemovalAction} from './rights-evidence-actions';
import styles from './rights-evidence-panel.module.css';

const statusLabels:Record<string,string>={blocked_policy:'Setup required',escalation_required:'Separate safety handling',capture_queued:'Copy requested',capturing:'Copy pending',evidence_ready:'Private copy verified',removal_blocked:'Removal blocked',removing:'Removal pending',origin_removed:'Original removed',purging:'Private copy expiring',purged:'Private copy removed',conflict:'Review required',erasure_owned:'Account deletion handling'};
const blocked:Record<string,string>={permission:'Only the currently assigned, authorized support operator can make this decision.',policy_disabled:'Evidence handling is not activated. No photo will be copied until the approved policy and operator are in place.',special_safety:'Use the separate safety escalation process. Do not open or copy this photo through ordinary evidence handling.',unavailable:'The case evidence could not be verified. Refresh before making a decision.'};
function date(value:string){return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'America/Chicago'}).format(new Date(value));}

type Props={caseId:string;viewerId?:string;canReview:boolean;specialSafety?:boolean;refreshKey?:string;parentBusy?:boolean};
export function RightsEvidencePanel(props:Props){return <RightsEvidenceScope key={`${props.viewerId??'unavailable'}:${props.caseId}`} {...props}/>;}
function RightsEvidenceScope({caseId,viewerId,canReview,specialSafety=false,refreshKey='',parentBusy=false}:Props){
 const fieldId=useId(),signature=`${viewerId}:${caseId}:${canReview}:${specialSafety}:${refreshKey}`;
 const [view,setView]=useState<{signature:string;workspace:RightsCaseEvidence|null;loaded:boolean}>({signature,workspace:null,loaded:false});
 const [selection,setSelection]=useState(''),[captureReason,setCaptureReason]=useState(''),[removalReason,setRemovalReason]=useState('');
 const [ordinaryChoice,setOrdinaryChoice]=useState<{signature:string;objectId:string}|null>(null);
 const [attempt,setAttempt]=useState<Attempt|null>(null),[uncertain,setUncertain]=useState(false),[pending,setPending]=useState(false),[refreshing,setRefreshing]=useState(false),[needsRefresh,setNeedsRefresh]=useState(false),[notice,setNotice]=useState<{ok:boolean;message:string}|null>(null);
 const [privateView,setPrivateView]=useState<{signature:string;version:string}|null>(null);
 const [recoveryReady,setRecoveryReady]=useState(false),[recoveryBlocked,setRecoveryBlocked]=useState(false);
 const generation=useRef(0),busy=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useLayoutEffect(()=>{mounted.current=true;generation.current+=1;return()=>{generation.current+=1;mounted.current=false;};},[signature]);
 let current=view;
 if(view.signature!==signature){current={signature,workspace:null,loaded:false};setView(current);setOrdinaryChoice(null);}
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{
  if(!active)return;const stored=readRightsEvidenceIntent(window.sessionStorage,viewerId??'',caseId);
  if(stored.status==='saved'){const saved=stored.value.attempt;setAttempt(saved);setSelection(saved.objectId);setUncertain(true);if(saved.kind==='capture')setCaptureReason(saved.input.reason);else setRemovalReason(saved.input.reason);setNotice({ok:false,message:'A previous request is not confirmed here. Confirm that same request; its original reason is kept.'});}
  else if(stored.status==='expired'){setNeedsRefresh(true);setNotice({ok:false,message:'The local recovery receipt expired. Refresh and review the current case before starting a new decision.'});}
  else if(stored.status==='invalid'||stored.status==='unavailable'){setRecoveryBlocked(true);setNotice({ok:false,message:'Recovery storage is unavailable. No new request will be sent.'});}
  setRecoveryReady(true);
 }).catch(()=>{if(active){setRecoveryBlocked(true);setRecoveryReady(true);setNotice({ok:false,message:'Recovery storage is unavailable. No new request will be sent.'});}});return()=>{active=false;};},[caseId,viewerId]);
 useEffect(()=>{let active=true;const authority=generation.current;void loadRightsEvidenceCaseAction(caseId).then(workspace=>{if(active&&authority===generation.current)setView({signature,workspace,loaded:true});}).catch(()=>{if(active&&authority===generation.current)setView({signature,workspace:null,loaded:true});});return()=>{active=false;};},[caseId,signature]);
 const workspace=current.workspace,selected=workspace?.photos.find(p=>p.objectId===(attempt?.objectId??selection))??(attempt?null:workspace?.photos[0])??null,state=selected?.state??null;
 const ordinary=ordinaryChoice?.signature===signature&&ordinaryChoice.objectId===selected?.objectId;
 const setOrdinary=(accepted:boolean)=>setOrdinaryChoice(accepted&&selected?{signature,objectId:selected.objectId}:null);
 const safetyBlocked=specialSafety||workspace?.blockedReason==='special_safety'||state&&state.safetyClassification!=='ordinary';
 const allowed=Boolean(workspace?.policyEnabled&&workspace.blockedReason===null&&canReview&&!safetyBlocked&&recoveryReady&&!recoveryBlocked),locked=pending||refreshing||parentBusy;
 const canCapture=Boolean(allowed&&workspace?.canCapture&&selected&&!selected.evidenceId),canRemove=Boolean(allowed&&state?.canRequestRemoval);
 const canRetry=Boolean(uncertain&&attempt&&allowed&&workspace?.blockedReason!=='permission'&&workspace?.blockedReason!=='unavailable');
 const privateAvailable=Boolean(!safetyBlocked&&workspace?.policyEnabled&&state?.captured&&['evidence_ready','removal_blocked','removing','origin_removed'].includes(state.status)&&[null,'shared_references','already_requested','permission'].includes(state.removalBlockedReason));
 const selectedLabel=state?state.removalBlockedReason==='erasure_owned'?'Account deletion handling':state.captured&&state.removalBlockedReason==='capture_required'?'Private copy unavailable':statusLabels[state.status]??'Status unavailable':selected?.evidenceId?'Status unavailable':current.loaded?'Not copied':'Loading…';
 const update=(next:RightsCaseEvidence|null)=>setView({signature,workspace:next,loaded:true});

 async function refresh(){if(busy.current||parentBusy)return;busy.current=true;setRefreshing(true);const authority=generation.current;try{const next=await loadRightsEvidenceCaseAction(caseId);if(mounted.current&&authority===generation.current){update(next);setNeedsRefresh(false);if(!uncertain)setNotice(null);}}catch{if(mounted.current&&authority===generation.current){update(null);setNotice({ok:false,message:'The evidence status could not refresh. Your decision reason is kept.'});}}finally{busy.current=false;if(mounted.current)setRefreshing(false);}}
 async function submit(event:React.FormEvent<HTMLFormElement>,kind:'capture'|'remove'){
  event.preventDefault();if(busy.current||parentBusy||!canReview||safetyBlocked)return;
  let request=attempt;
  if(request&&!canRetry)return;
  if(!request){
   if(needsRefresh||!selected||kind==='capture'&&(!canCapture||!ordinary)||kind==='remove'&&(!canRemove||!state))return;
   const reason=(kind==='capture'?captureReason:removalReason).trim();if(reason.length<3||reason.length>2000){setNotice({ok:false,message:'Enter a reason of 3–2,000 characters.'});return;}
   request=kind==='capture'?{kind,objectId:selected.objectId,input:{caseId,objectId:selected.objectId,requestId:crypto.randomUUID(),reason,ordinaryConfirmed:true}}:{kind,objectId:selected.objectId,input:{caseId,evidenceId:state!.id,expectedVersion:state!.version,requestId:crypto.randomUUID(),reason}};
  }
  try{saveRightsEvidenceIntent(window.sessionStorage,viewerId??'',caseId,request);}catch{setNotice({ok:false,message:'Recovery storage is unavailable. No new request was sent. Your reason is kept.'});return;}
  setAttempt(request);
  busy.current=true;setPending(true);setNotice(null);const authority=generation.current;
  const unconfirmed=()=>{setUncertain(true);setNotice({ok:false,message:'The request result is not confirmed. Keep this reason and confirm the same request.'});};
  try{
   const result:RightsOperatorResult=request.kind==='capture'?await captureRightsEvidenceAction(request.input):await requestRightsOriginRemovalAction(request.input);
   if(!mounted.current)return;if(authority!==generation.current){unconfirmed();return;}
   if(result.ok){update(result.workspace);if(!clearRightsEvidenceIntent(window.sessionStorage,viewerId??'',caseId,request.input.requestId)){setUncertain(true);setNotice({ok:false,message:'The request was recorded, but its local recovery receipt could not be cleared. Confirm this same request before starting another decision.'});return;}setAttempt(null);setUncertain(false);setNeedsRefresh(false);setNotice({ok:true,message:result.message});if(request.kind==='capture'){setCaptureReason('');setOrdinary(false);}else setRemovalReason('');}
   else if(result.code==='unknown')unconfirmed();
   else{if(result.workspace)update(result.workspace);if(!clearRightsEvidenceIntent(window.sessionStorage,viewerId??'',caseId,request.input.requestId)){unconfirmed();return;}setAttempt(null);setUncertain(false);setNeedsRefresh(true);setNotice({ok:false,message:result.message});}
  }catch{if(mounted.current)unconfirmed();}
  finally{busy.current=false;if(mounted.current)setPending(false);}
 }

 return <details className={styles.panel}><summary>Evidence &amp; removal <span className={styles.badge}>{safetyBlocked?'Separate safety handling':selectedLabel}</span></summary><div className={styles.body}>
  {!current.loaded?<p className={styles.muted}>Checking case evidence…</p>:safetyBlocked?<p role="status" className={styles.warning}>{blocked.special_safety}</p>:!workspace?<p className={styles.warning}>The case evidence is unavailable for your current access. Refresh to check again.</p>:<>
   {workspace.blockedReason&&<p className={styles.warning}>{blocked[workspace.blockedReason]}</p>}
   {workspace.photos.length>1&&<label className={styles.field}>Photo<select aria-label="Evidence photo" value={selected?.objectId??''} disabled={locked||uncertain} onChange={e=>{setSelection(e.target.value);setCaptureReason('');setRemovalReason('');setOrdinary(false);setNotice(null);}}>{workspace.photos.map((p,index)=><option key={p.objectId} value={p.objectId}>Photo {index+1}</option>)}</select></label>}
   {!selected?<p className={styles.muted}>{attempt?'The original request is kept, but its current photo status is unavailable. Refresh before continuing.':'No eligible approved photo or evidence record is available for this case.'}</p>:<>
    <dl className={styles.facts}><div><dt>Original photo</dt><dd>{state?.originRemoved?'Removal confirmed':'Selected from this case'}</dd></div><div><dt>Private copy</dt><dd>{state?.status==='purged'?'Removed':state?.captured?['capture_required','erasure_owned'].includes(state.removalBlockedReason??'')?'Unavailable':'Verified capture':selected.evidenceId?'Not yet verified':'Not saved'}</dd></div></dl>
    {privateAvailable&&<button type="button" className={styles.textAction} disabled={locked} onClick={()=>setPrivateView(privateView?null:{signature,version:state!.version})}>{privateView?.signature===signature?'Close private view':'View private copy'}</button>}
    {privateAvailable&&privateView?.signature===signature&&privateView.version===state?.version&&<div className={styles.privateView}><strong>Private evidence · this case only</strong><Image unoptimized src={`/api/admin/rights-evidence/${state.id}`} width={900} height={700} alt="Private evidence for this case" onError={()=>{setPrivateView(null);setNotice({ok:false,message:'The private copy is unavailable for your current access. Refresh evidence status to check again.'});}}/></div>}
    {(canCapture||attempt?.kind==='capture'||captureReason)&&<form onSubmit={e=>void submit(e,'capture')}>
     <label className={styles.field} htmlFor={`${fieldId}-capture`}>Reason for private capture<textarea id={`${fieldId}-capture`} required minLength={3} maxLength={2000} rows={2} value={captureReason} readOnly={uncertain||!canCapture} disabled={locked} onChange={e=>{if(!uncertain&&!pending)setCaptureReason(e.target.value);}}/></label>
     <label className={styles.check}><input type="checkbox" checked={ordinary} required disabled={locked||uncertain||!canCapture} onChange={e=>setOrdinary(e.target.checked)}/>I reviewed this as an ordinary rights complaint. Special safety concerns use the separate escalation process.</label>
     <p className={styles.muted}>Saving a private copy does not remove the original.</p>
     {(canCapture||canRetry&&attempt?.kind==='capture')&&<button className={styles.primary} disabled={locked||needsRefresh&&!canRetry}>{pending?'Saving request…':uncertain?'Confirm previous request':'Save private copy'}</button>}
    </form>}
    {selected.evidenceId&&!state?<p className={styles.warning}>Current evidence status could not be verified. Refresh before making a decision.</p>:state&&<>
     {(state.captured&&!state.originRemoved&&state.status!=='purged'||attempt?.kind==='remove')&&<section className={styles.removal}><h3>{state.originRemoved?'Confirm the previous removal request':'Remove the stored original'}</h3><p className={styles.muted}>{state.originRemoved?'Origin removal is already confirmed. Settling this previous request does not remove another photo.':'This is a separate decision. The private case copy stays protected. Previously saved or cached copies cannot be recalled.'}</p>
      {state.removalBlockedReason==='shared_references'?<p className={styles.warning}>Removal is blocked by another use. Review other posts, covers, saved items or cases first. This action does not detach them automatically.</p>:state.removalBlockedReason==='already_requested'||state.status==='removing'?<p className={styles.muted}>Removal requested. The original is not marked removed until processing confirms its absence.</p>:state.removalBlockedReason==='erasure_owned'?<p className={styles.warning}>Account deletion is handling this photo. Ordinary evidence removal is unavailable.</p>:null}
      {(canRemove||attempt?.kind==='remove'||removalReason)&&<form onSubmit={e=>void submit(e,'remove')}><label className={styles.field} htmlFor={`${fieldId}-remove`}>Removal reason<textarea id={`${fieldId}-remove`} required minLength={3} maxLength={2000} rows={2} value={removalReason} readOnly={uncertain||!canRemove} disabled={locked} onChange={e=>{if(!uncertain&&!pending)setRemovalReason(e.target.value);}}/></label>{(canRemove||canRetry&&attempt?.kind==='remove')&&<button className={styles.destructive} disabled={locked||needsRefresh&&!canRetry}>{pending?'Saving request…':uncertain?'Confirm previous request':'Request original removal'}</button>}</form>}
     </section>}
     <details className={styles.retention}><summary>Retention &amp; preservation hold</summary><p>Ordinary private evidence is kept for 30 days after this support case is closed. Resolution alone does not start that clock.</p>{state.hasLegalHold?<p>Owner-approved hold{state.legalHoldReviewAt?` · review by ${date(state.legalHoldReviewAt)}`:''}. Contact the owner to review its recorded reason or release. It is read-only here and does not override account deletion in this version.</p>:state.retainUntil?<p>Closed-case expiry: {date(state.retainUntil)}.</p>:<p>No closed-case expiry date applies yet.</p>}</details>
    </>}
   </>}
  </>}
  {notice&&<p role={notice.ok?'status':'alert'} className={notice.ok?styles.success:styles.warning}>{notice.message}</p>}
  {uncertain&&<p className={styles.muted}>The original request and reason are locked until confirmed. Refreshing does not start another request.</p>}
  {needsRefresh&&<p className={styles.muted}>Refresh before starting another decision. Your reason is kept.</p>}
  <button type="button" className={styles.textAction} disabled={locked} onClick={()=>void refresh()}>{refreshing?'Refreshing…':'Refresh evidence status'}</button>
  <p className={styles.muted}>Closing the Support case does not hide the post or request photo removal.</p>
 </div></details>;
}
