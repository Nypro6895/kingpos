"use client";
import Link from 'next/link';
import { TimeZoneSelect } from "@/components/time-zone-select";
import { useState } from "react";
import { EntityPicker } from "../_components/entity-picker";
import { PLATFORM_ADMIN_PERMISSIONS as P, PLATFORM_ADMIN_ROLE_SLUGS } from "@/types/platform-admin";
import type { UserWorkspace, UserOperationResult, UserRecoveryCase, UserDrawerTab } from "@/types/admin-users-workspace";
import { UserOperationForm, UserReason } from "./user-operation-form";
import styles from "./users.module.css";

export function userDate(value:string|null|undefined) {return value?new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Chicago"}).format(new Date(value))+" CT":"—";}
export function userName(user:{display_name:string|null;first_name?:string|null;last_name?:string|null;email?:string|null}) {return user.display_name||[user.first_name,user.last_name].filter(Boolean).join(" ")||user.email||"Unnamed user";}
function Section({title,children}:{title:string;children:React.ReactNode}) {return <section className={styles.section}><h3>{title}</h3>{children}</section>;}
function Field({label,value}:{label:string;value:string|null|undefined}) {return <label>{label}<input name={label.toLowerCase().replaceAll(" ","_")} defaultValue={value??""} maxLength={label==="Phone"?40:150}/></label>;}

export function UserDrawerContent({data,tab,onResult,caseId,setCaseId}:{data:UserWorkspace;tab:UserDrawerTab;onResult:(r:UserOperationResult)=>void;caseId:string|null;setCaseId:(id:string|null)=>void}) {
 const can=(p:typeof P[keyof typeof P])=>data.permissions.includes(p);
 const [command,setCommand]=useState<string|null>(null);
 const [membership,setMembership]=useState<{scope:string;entityId:string;name:string;role:string;status:string;remove?:boolean}|null>(null);
 const [notify,setNotify]=useState(false);
 const [renderTime]=useState(()=>Date.now());
 const u=data.user;const editable=u.status!=="deleted";const accessEditable=!data.ownAccount&&!['deleted','pending_deletion'].includes(u.status);
 const identityBlocked=data.identity_jobs.some(j=>j.status==='pending'||j.status==='unknown');
 const authEditable=accessEditable&&data.identityReady&&!identityBlocked;
 const invitationCancelled=!!data.authentication?.banned_until&&Date.parse(data.authentication.banned_until)>renderTime;
 const verifiedCases=data.cases.filter(c=>!['resolved','closed'].includes(c.status)&&c.context.identity_verified&&c.context.contact_verified&&!!c.context.verification_evidence);
 const result=(r:UserOperationResult)=>{if(r.ok){setCommand(null);setMembership(null);setNotify(false);}onResult(r);};
 const caseSelect=<label>Verified recovery case<select name="case_id" required defaultValue={verifiedCases[0]?.id??""}><option value="">Select verified case</option>{verifiedCases.map(c=><option key={c.id} value={c.id}>{c.reference} · {c.category.replaceAll('_',' ')}</option>)}</select></label>;
 const memberships=(data.access_stores??[]).flatMap(store=>store.sources.map(source=>({scope:source.scope,entityId:source.entity_id,name:source.scope==='business'&&source.store_count>1?`Shared ownership · ${source.store_count} businesses`:store.name,role:source.role,status:source.status}))).filter((m,index,all)=>all.findIndex(other=>other.scope===m.scope&&other.entityId===m.entityId)===index);
 if(caseId) return <UserCaseEditor key={`${caseId}-${data.cases.find(c=>c.id===caseId)?.updated_at??''}`} data={data} existing={data.cases.find(c=>c.id===caseId)??null} onClose={()=>setCaseId(null)} onResult={r=>{if(r.ok&&r.caseId)setCaseId(r.caseId);onResult(r);}}/>;
 return <>
 {tab==='profile'&&<>
  <Section title="Profile & invitations">
   {can(P.usersUpdate)&&editable?<UserOperationForm operation="profile" userId={u.id} onResult={result}>
    <input type="hidden" name="expected_updated_at" value={u.updated_at}/>
    <div className={styles.fields}><Field label="Display name" value={u.display_name}/><Field label="First name" value={u.first_name}/><Field label="Last name" value={u.last_name}/>
    {can(P.usersReadSensitive)&&<Field label="Phone" value={u.phone}/>}
    <label>Email<input value={u.email??'Restricted'} readOnly/><small>Change verified email in Security.</small></label>
    <label>Language<select name="language" defaultValue={u.language}>{[['en','English'],['vi','Vietnamese'],['es','Spanish'],['fr','French']].map(([v,l])=><option value={v} key={v}>{l}</option>)}{!['en','vi','es','fr'].includes(u.language)&&<option>{u.language}</option>}</select></label>
    <label>Timezone<TimeZoneSelect name="timezone" defaultValue={u.timezone} required/></label>
    <UserReason/></div>
   </UserOperationForm>:<dl className={styles.facts}>{[['Email',u.email],['Phone',u.phone],['Language',u.language],['Timezone',u.timezone]].map(([l,v])=><div key={l}><dt>{l}</dt><dd>{v??'—'}</dd></div>)}</dl>}
   {data.authentication?.invited_at&&<div className={styles.invitation}><span>Invitation · {data.authentication.last_sign_in_at||data.authentication.email_confirmed_at?'Accepted':data.authentication.banned_until&&Date.parse(data.authentication.banned_until)>renderTime?'Cancelled':'Pending'}</span><small>{userDate(data.authentication.invited_at)}</small>
   {!data.authentication.last_sign_in_at&&!data.authentication.email_confirmed_at&&authEditable&&can(P.usersAuthManage)&&<div className={styles.actions}><button className={styles.button} onClick={()=>setCommand('resend_invite')}>{invitationCancelled?'Reinvite':'Resend'}</button>{!invitationCancelled&&can(P.recoveryManage)&&<button className={styles.button} onClick={()=>setCommand('cancel_invite')}>Cancel invitation</button>}</div>}</div>}
   {['resend_invite','cancel_invite'].includes(command??'')&&<UserOperationForm key={command} operation={command!} userId={u.id} onResult={result} onCancel={()=>setCommand(null)} label={command==='resend_invite'?'Resend invitation':'Cancel invitation'} confirm={command==='cancel_invite'?'Block this unused identity and invalidate its invitation access?':undefined}><UserReason/></UserOperationForm>}
  </Section>
  {(can(P.notesRead)||can(P.notesCreate))&&<Section title="Internal notes">
   {can(P.notesCreate)&&<UserOperationForm operation="note" userId={u.id} label="Add note" onResult={onResult} reset><label><span className="sr-only">Internal note</span><textarea name="body" required maxLength={5000} rows={2} placeholder="Add an internal note…"/></label></UserOperationForm>}
   {data.notes.map(note=><article key={note.id} className={styles.event}><p>{note.body}</p><small>{note.author?.display_name??'Admin'} · {userDate(note.created_at)}</small></article>)}
  </Section>}
  {can(P.notificationsSend)&&['active','pending_deletion'].includes(u.status)&&<Section title="Notification"><button className={styles.button} onClick={()=>setNotify(!notify)}>Send notification</button>{notify&&<UserOperationForm operation="notification" userId={u.id} label="Send in-app notification" onResult={result} confirm="Send this message to the user's in-app inbox?" onCancel={()=>setNotify(false)}><label>Title<input name="title" required maxLength={120}/></label><label>Message<textarea name="body" required maxLength={2000} rows={3}/></label><UserReason label="Internal send reason"/></UserOperationForm>}</Section>}
 </>}
 {tab==='access'&&<>
  <Section title="Access & ownership">
   <div className={styles.memberships}>{data.access_stores==null?<p className={styles.error}>Business access could not load. Refresh before changing permissions.</p>:data.access_stores.length?data.access_stores.map(store=>{
    const active=store.sources.filter(source=>source.status==='active'&&(source.scope==='salon'||source.account_status==='active'));const roles=[...new Set(active.map(source=>source.role))];
    const role=roles.includes('OWNER')?'OWNER':roles.includes('MANAGER')?'MANAGER':roles.join(' / ')||(store.staff_linked?'Staff profile linked':'No active access');
    return <article key={store.id} className={styles.event}><div className={styles.membership}><div><strong>{can(P.locationsRead)?<a href={`/admin/locations/${store.id}`}>{store.name}</a>:store.name}</strong><small>{role} · {active.length?'active':store.staff_linked?'Employment link':'inactive'}{store.status!=='active'?` · Business ${store.status}`:''}</small></div></div>
     {store.sources.length>0&&<details className={styles.disclosure}><summary>Access settings</summary>{store.sources.map(source=>{const m={scope:source.scope,entityId:source.entity_id,name:store.name,role:source.role,status:source.status};return <div key={source.membership_id} className={styles.membership}><div><strong>{source.role} · {source.status}</strong><small>{source.scope==='business'?`Shared access · ${source.store_count} business${source.store_count===1?'':'es'}`:'This business only'}{source.account_status!=='active'?` · Access group ${source.account_status}`:''}</small></div>{can(P.usersMembershipsManage)&&accessEditable&&source.role!=='OWNER'&&<div className={styles.actions}><button className={styles.button} onClick={()=>{setMembership(m);setCommand('membership');}}>Edit</button><button className={styles.ghost} onClick={()=>{setMembership({...m,remove:true});setCommand('membership');}}>Remove</button></div>}</div>;})}<small className={styles.notice}>Removing one access source may leave another active. Shared access changes affect every business in that group.</small></details>}
    </article>;
   }):<p className={styles.notice}>No business access.</p>}</div>
   {can(P.usersMembershipsManage)&&accessEditable&&data.access_stores!=null&&<button className={styles.button} onClick={()=>{setMembership(null);setCommand(command==='membership'?null:'membership');}}>+ Add business access</button>}
   {command==='membership'&&<UserOperationForm key={membership?`${membership.scope}-${membership.entityId}-${membership.remove}`:'new'} operation="membership" userId={u.id} onResult={result} onCancel={()=>setCommand(null)} label={membership?.remove?'Remove membership':'Save membership'} confirm={membership?.remove?'Remove this membership and its access?':undefined}>
    {membership?<><strong>{membership.name}</strong><input type="hidden" name="scope" value={membership.scope}/><input type="hidden" name="entity_id" value={membership.entityId}/>{membership.scope==='business'&&<p className={styles.notice}>This changes shared access for all businesses in the group.</p>}</>:<><input type="hidden" name="scope" value="salon"/><EntityPicker kind="location" label="Business" name="entity_id" required/></>}
    <input type="hidden" name="remove" value={membership?.remove?'true':'false'}/>
    <div className={styles.fields}><label>Role<select name="role" defaultValue={membership?.role??'STAFF'}><option value="STAFF">Staff</option><option value="MANAGER">Manager</option></select></label><label>Status<select name="status" defaultValue={membership?.status??'active'}>{['active','inactive','suspended'].map(s=><option key={s}>{s}</option>)}</select></label><UserReason/></div>
   </UserOperationForm>}
  </Section>
  {can(P.teamManage)&&can(P.usersMembershipsManage)&&accessEditable&&memberships.some(m=>m.role==='OWNER'&&m.status==='active')&&<Section title="Ownership tools"><button className={styles.button} onClick={()=>setCommand(command==='transfer'?null:'transfer')}>Transfer ownership</button>
   {command==='transfer'&&<UserOperationForm operation="transfer" userId={u.id} onResult={result} onCancel={()=>setCommand(null)} label="Transfer ownership" confirm="Transfer ownership to the selected user and remove the current owner's corresponding access?">
    <label>Ownership scope<select name="owner_entity">{memberships.filter(m=>m.role==='OWNER'&&m.status==='active').map(m=><option value={`${m.scope}:${m.entityId}`} key={`${m.scope}:${m.entityId}`}>{m.name} · {m.scope==='business'?'Shared ownership':'This business only'}</option>)}</select></label>
    <EntityPicker kind="user" name="recipient" label="New owner" required/>{caseSelect}<UserReason/><label>Type TRANSFER<input name="confirmation" required pattern="TRANSFER"/></label>
   </UserOperationForm>}
  </Section>}
  {can(P.teamRead)&&<Section title="Platform role">
   {can(P.teamManage)&&accessEditable?<UserOperationForm operation="platform_role" userId={u.id} onResult={result} label="Save platform access" confirm="Apply this platform role and access status?">
    {data.platform_membership&&<input type="hidden" name="membership_id" value={data.platform_membership.id}/>}
    <div className={styles.fields}><label>Role<select name="role_slug" defaultValue={data.platform_membership?.role_slug??'support_agent'}>{PLATFORM_ADMIN_ROLE_SLUGS.map(r=><option key={r} value={r}>{r.replaceAll('_',' ')}</option>)}</select></label><label>Status<select name="status" defaultValue={data.platform_membership?.status??'active'}>{(data.platform_membership?['active','suspended','revoked']:['active']).map(r=><option key={r}>{r}</option>)}</select></label><UserReason/></div>
   </UserOperationForm>:<p>{data.platform_membership?.role_name??'Standard user'} · {data.platform_membership?.status??'No platform access'}</p>}
  </Section>}
 </>}
 {tab==='security'&&<>
  <Section title="Authentication"><div className={styles.authFacts}><span>{data.authentication?data.authentication.email_confirmed_at?'✓ Email verified':'Email unverified':'Authentication restricted / unavailable'}</span>{data.authentication&&<span>{data.authentication.factors.some(f=>f.status==='verified')?'✓ MFA enabled':'MFA not enrolled'}</span>}</div>
   {can(P.usersAuthManage)&&<div className={styles.actions}>{[['password_reset',data.identity_jobs.some(j=>j.operation==='password_reset'&&j.status==='accepted')?'Resend reset link':'Send password reset'],['email_change','Change email'],['verify_email','Verify email'],['reset_mfa','Reset MFA']].map(([op,label])=><button key={op} disabled={!authEditable||(['email_change','verify_email','reset_mfa'].includes(op)&&(!verifiedCases.length||!can(P.recoveryManage)))} className={styles.button} onClick={()=>setCommand(command===op?null:op)}>{label}</button>)}</div>}
  {data.identity_jobs.slice(0,3).map(j=><div key={j.id} className={styles.notice}>{j.operation.replaceAll('_',' ')} · {j.status==='accepted'?'Provider accepted':j.status} · {userDate(j.created_at)}{can(P.teamManage)&&['pending','unknown'].includes(j.status)&&<button className={styles.ghost} onClick={()=>setCommand(`review:${j.id}`)}>Review outcome</button>}</div>)}
   {command?.startsWith('review:')&&<UserOperationForm operation="identity_review" userId={u.id} onResult={result} label="Record verified outcome" onCancel={()=>setCommand(null)}><input type="hidden" name="job_id" value={command.slice(7)}/><label>Verified provider outcome<select name="outcome"><option value="accepted">Accepted / completed</option><option value="failed">Not completed</option></select></label><UserReason label="Evidence from provider logs / current Auth state"/></UserOperationForm>}
   {can(P.usersAuthManage)&&!data.identityReady&&<p className={styles.error}>Authentication administration is not configured.</p>}
   {identityBlocked&&<p className={styles.error}>An identity operation needs outcome review before another action.</p>}
   {can(P.usersAuthManage)&&!verifiedCases.length&&<small className={styles.notice}>Email and MFA changes require a verified recovery case.</small>}
   {['password_reset','email_change','verify_email','reset_mfa'].includes(command??'')&&<UserOperationForm key={command} operation={command!} userId={u.id} onResult={result} onCancel={()=>setCommand(null)} label={{password_reset:'Send reset link',email_change:'Apply verified email',verify_email:'Confirm email',reset_mfa:'Reset MFA'}[command!]??'Confirm'} confirm={command==='password_reset'?undefined:'Apply this authentication change using the verified recovery case?'}>
    {(command!=='password_reset'||data.cases.some(c=>c.category==='account_takeover'&&!['resolved','closed'].includes(c.status)))&&caseSelect}
    {command==='email_change'&&<label>Verified recovery email<input name="email" type="email" required maxLength={254}/></label>}
    <UserReason/>{command==='password_reset'&&<small className={styles.notice}>Sends a reset link to {u.email}. No password is displayed or emailed.</small>}
   </UserOperationForm>}
  </Section>
  {can(P.recoveryRead)&&<Section title="Sessions"><div className={styles.sectionHeading}><span className={styles.notice}>{data.sessions.length} active authentication sessions</span>{can(P.recoveryManage)&&accessEditable&&<button className={styles.button} onClick={()=>setCommand('revoke_sessions')}>Revoke all sessions</button>}</div>
   {data.sessions.map(s=><div className={styles.membership} key={s.id}><div><strong>{s.device_label??'Authentication session'} · {s.id.slice(0,8)}</strong><small>{userDate(s.updated_at??s.created_at)}</small></div>{can(P.recoveryManage)&&accessEditable&&<button className={styles.button} onClick={()=>setCommand(`session:${s.id}`)}>Revoke</button>}</div>)}
   {(command==='revoke_sessions'||command?.startsWith('session:'))&&<UserOperationForm key={command} operation="revoke_sessions" userId={u.id} onResult={result} label="Revoke sessions" onCancel={()=>setCommand(null)} confirm="Revoke these authentication sessions and their refresh tokens?">
    {command.startsWith('session:')&&<input type="hidden" name="session_id" value={command.slice(8)}/>}
    <UserReason/><small className={styles.notice}>Existing access tokens may remain valid until expiry.</small>
   </UserOperationForm>}
  </Section>}
  <Section title="Account access"><div className={styles.actions}>
   {can(P.usersSuspend)&&accessEditable&&['active','inactive'].includes(u.status)&&<button className={styles.danger} onClick={()=>setCommand('suspend')}>Suspend access</button>}
   {can(P.usersRestore)&&accessEditable&&u.status==='suspended'&&<button className={styles.button} onClick={()=>setCommand('restore')}>Restore access</button>}
   {!accessEditable&&<span className={styles.notice}>{data.ownAccount?'Use account settings for your own access.':'Access changes are unavailable during deletion.'}</span>}
   </div>{['suspend','restore'].includes(command??'')&&<UserOperationForm key={command} operation={command!} userId={u.id} onResult={result} label={command==='suspend'?'Suspend access':'Restore access'} onCancel={()=>setCommand(null)} confirm={command==='suspend'?'Suspend this account and revoke its sessions?':'Restore access for this account?'}><UserReason/></UserOperationForm>}
  </Section>
  {can(P.reportsRead)&&<Section title="Recovery & support">
   {can(P.reportsCreate)&&can(P.recoveryManage)&&can(P.usersReadSensitive)&&<div className={styles.actions}><button className={styles.primary} disabled={['account_takeover','lost_access','ownership','other'].every(category=>data.cases.some(c=>c.category===category&&!['resolved','closed'].includes(c.status)))} onClick={()=>{setCaseId('new');setCommand(null);}}>+ Create support case</button><span className={styles.notice}>Lost access / account takeover</span></div>}
   {data.cases.map(c=><div key={c.id} className={styles.membership}><div><strong>{c.reference} · {c.category.replaceAll('_',' ')}</strong><small>{c.status.replaceAll('_',' ')}{c.context.identity_verified&&c.context.contact_verified?' · Verified':''}</small></div><button className={styles.button} onClick={()=>{setCaseId(c.id);setCommand(null);}}>Open case</button></div>)}
   {can(P.reportsUpdate)&&can(P.recoveryManage)&&can(P.usersReadSensitive)&&data.related_reports.some(r=>!data.cases.some(c=>c.id===r.id))&&<button className={styles.button} onClick={()=>setCommand('case_link')}>Link existing case</button>}
   {command==='case_link'&&<UserOperationForm operation="case_link" userId={u.id} onResult={r=>{if(r.ok&&r.caseId)setCaseId(r.caseId);result(r);}} label="Link existing case" onCancel={()=>setCommand(null)}><label>Related case<select name="report_id" required>{data.related_reports.filter(r=>!data.cases.some(c=>c.id===r.id)&&!['resolved','closed'].includes(r.status)).map(r=><option key={r.id} value={r.id}>{r.report_number} · {r.summary}</option>)}</select></label><label>Recovery type<select name="category"><option value="lost_access">Lost access</option><option value="account_takeover">Account takeover</option><option value="ownership">Ownership</option><option value="other">Other</option></select></label><UserReason/></UserOperationForm>}
  </Section>}
  {can(P.usersDelete)&&<Section title="Deletion & ownership"><details className={styles.disclosure}><summary>Review impact · 30-day grace period</summary>
   {data.deletion?<><p className={styles.notice}>Retained financial and audit records are preserved.</p>{data.deletion.salons.map(s=><div className={styles.membership} key={s.id}><span>{s.name}</span><small>{s.last_owner?'Last owner':'Other owner available'} · {s.status}</small></div>)}{data.deletion.blocked&&<p className={styles.error}>Transfer ownership or close last-owner salons before deletion.</p>}
   {!data.ownAccount&&u.status==='active'&&!data.deletion.blocked&&<button className={styles.danger} onClick={()=>setCommand('schedule_deletion')}>Schedule deletion</button>}
   {!data.ownAccount&&u.status==='pending_deletion'&&<button className={styles.button} onClick={()=>setCommand('cancel_deletion')}>Cancel deletion</button>}
   {u.deletion_scheduled_for&&<p className={styles.notice}>Scheduled: {userDate(u.deletion_scheduled_for)}</p>}
   {['schedule_deletion','cancel_deletion'].includes(command??'')&&<UserOperationForm key={command} operation={command!} userId={u.id} onResult={result} label={command==='schedule_deletion'?'Schedule deletion':'Cancel deletion'} onCancel={()=>setCommand(null)} confirm={command==='schedule_deletion'?'Schedule account deletion in 30 days?':'Cancel this pending account deletion?'}><UserReason/>{command==='schedule_deletion'&&<><label>Type DELETE<input name="confirmation" pattern="DELETE" required/></label><label className={styles.check}><input type="checkbox" name="backup_acknowledged" required/>I reviewed ownership, backups and retained records.</label></>}</UserOperationForm>}
   </>:<p className={styles.error}>Deletion impact is unavailable. Refresh before proceeding.</p>}
  </details></Section>}
 </>}
 {tab==='activity'&&<Section title="Activity"><div className={styles.timeline}>{data.activity.length?data.activity.map(e=><article className={styles.event} key={e.id}><strong>{e.title}</strong>{e.body&&<p>{e.body}</p>}<small>{userDate(e.at)}{e.actor&&` · ${e.actor}`}</small></article>):<p className={styles.notice}>No recorded activity available.</p>}</div></Section>}
 </>;
}

function UserCaseEditor({data,existing,onResult,onClose}:{data:UserWorkspace;existing:UserRecoveryCase|null;onResult:(r:UserOperationResult)=>void;onClose:()=>void}) {
 const can=(p:typeof P[keyof typeof P])=>data.permissions.includes(p);
 const duplicate=(category:string)=>data.cases.some(c=>c.id!==existing?.id&&c.category===category&&!['resolved','closed'].includes(c.status));
 const [category,setCategory]=useState(existing?.category??['account_takeover','lost_access','ownership','other'].find(c=>!duplicate(c))??'other');
 const writable=can(P.recoveryManage)&&can(P.usersReadSensitive)&&can(existing?P.reportsUpdate:P.reportsCreate);
 return <section className={styles.caseEditor}><div className={styles.sectionHeading}><h3>{existing?existing.reference:'Support case'} · {category.replaceAll('_',' ')}</h3><button className={styles.ghost} onClick={onClose}>Close panel</button></div>
  {existing&&<div className={styles.section}><h4>Reported issue</h4><p style={{whiteSpace:'pre-wrap'}}>{existing.description||'No description recorded.'}</p><p className={styles.notice}>Affected account: {userName(data.user)} · {existing.status.replaceAll('_',' ')} · {data.assignees.find(a=>a.id===existing.assigned_membership_id)?.name??'Unassigned'}</p><p className={styles.notice}>Received {userDate(existing.created_at)}</p>{existing.resolution&&<p>Outcome: {existing.resolution}</p>}{existing.context.attachments?.map(a=><p key={a.path}><a href={`/admin/users/evidence?user=${data.user.id}&case=${existing.id}&path=${encodeURIComponent(a.path)}`} target="_blank" rel="noopener noreferrer">{a.name} ↗</a></p>)}<Link href={`/admin/reports/${existing.id}`}>Open full report & activity ↗</Link></div>}
  <details open={!existing}><summary>{existing?'Edit handling & verification':'Create support case'}</summary>
  {!writable?<><p>{existing?.description}</p><p>{existing?.status}</p></>:<UserOperationForm operation="case" userId={data.user.id} onResult={onResult} label={existing?'Save case':'Create case'}>
   {existing&&<><input type="hidden" name="case_id" value={existing.id}/><input type="hidden" name="expected_updated_at" value={existing.updated_at}/></>}
   <label>User<input value={`${userName(data.user)} / ${data.user.id.slice(0,8)}`} readOnly/></label>
   <div className={styles.fields}>
    <label>Case type<select name="category" value={category} onChange={e=>setCategory(e.target.value)}>{[['account_takeover','Account takeover'],['lost_access','Lost access'],['ownership','Ownership'],['other','Other']].map(([v,l])=><option key={v} value={v} disabled={duplicate(v)}>{l}{duplicate(v)?' · case already open':''}</option>)}</select></label>
    <label>Priority<select name="priority" defaultValue={existing?.priority??(category==='account_takeover'?'high':'normal')}>{['low','normal','high','urgent'].map(s=><option key={s}>{s}</option>)}</select></label>
    {can(P.reportsAssign)?<label>Assignee<select name="assigned_membership_id" defaultValue={existing?.assigned_membership_id??''}><option value="">Unassigned</option>{data.assignees.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>:<input type="hidden" name="assigned_membership_id" value={existing?.assigned_membership_id??''}/>}
    <label>Recovery contact<input name="recovery_contact" type="email" maxLength={254} defaultValue={existing?.context.recovery_contact??''} placeholder="Independently verified email"/></label>
    <label className={styles.full}>Description<textarea name="description" required minLength={3} maxLength={5000} rows={3} defaultValue={existing?.description??''}/></label>
    <label className={styles.full}>Evidence (PDF / PNG / JPEG, total ≤ 12 MB)<input type="file" name="evidence" accept="application/pdf,image/png,image/jpeg" multiple/></label>
    {existing?.context.attachments?.map(a=><a key={a.path} className={styles.full} href={`/admin/users/evidence?user=${data.user.id}&case=${existing.id}&path=${encodeURIComponent(a.path)}`} target="_blank" rel="noopener noreferrer">{a.name} ↗</a>)}
    <label className={styles.full}>Verification evidence<textarea name="verification_evidence" defaultValue={existing?.context.verification_evidence??''} maxLength={3000} rows={2} placeholder="How was the owner and recovery contact independently verified?"/></label>
   </div>
   <div className={styles.checks}>{[['identity_verified','Identity confirmed'],['contact_verified','Recovery contact verified'],['ownership_verified','Business ownership confirmed']].map(([v,l])=><label key={v} className={styles.check}><input type="checkbox" name={v} defaultChecked={Boolean(existing?.context[v as keyof typeof existing.context])}/>{l}</label>)}</div>
   {!data.ownAccount&&!['pending_deletion','deleted'].includes(data.user.status)&&<div className={styles.checks}>{can(P.usersSuspend)&&data.user.status!=='suspended'&&<label className={styles.check}><input type="checkbox" name="suspend"/>Suspend account</label>}{can(P.recoveryManage)&&<label className={styles.check}><input type="checkbox" name="revoke"/>Revoke all sessions</label>}</div>}
   {existing&&<div className={styles.fields}><label>Status<select name="status" defaultValue={existing.status}>{['new','under_review','action_required',...(can(P.reportsResolve)?['resolved','closed']:[])].map(s=><option key={s}>{s}</option>)}</select></label><label>Resolution<textarea name="resolution" maxLength={1000} rows={2} defaultValue={existing.resolution??''}/></label></div>}
   <UserReason/><p className={styles.notice}>Verify ownership before changing email or MFA.</p>
  </UserOperationForm>}
  </details>
  {existing&&<small className={styles.notice}>Created {userDate(existing.created_at)} · Updated {userDate(existing.updated_at)}</small>}
 </section>;
}

