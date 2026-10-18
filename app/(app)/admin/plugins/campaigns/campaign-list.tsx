"use client";
import Image from 'next/image';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import type {OwnerCampaign} from '@/types/owner-campaign';
import {formatCredits} from '@/lib/campaign-credit-display';
import {manageCampaignAction} from './actions';
export type CampaignAdminRow=OwnerCampaign&{salonName:string;image:string|null;caption:string;href:string|null};
const statuses:Record<OwnerCampaign['status'],string>={pending_review:'Awaiting review',running:'Running',completed:'Finished',cancelled:'Cancelled',rejected:'Not approved',paused:'Paused',awaiting_payment:'Needs credits'};
function AdRow({campaign:c}:{campaign:CampaignAdminRow}){
 const router=useRouter(),[busy,start]=useTransition(),[editor,setEditor]=useState<'edit'|'reject'|'archive'|'preview'|null>(null),[message,setMessage]=useState('');
 const [title,setTitle]=useState(c.title),[caption,setCaption]=useState(c.caption),[reason,setReason]=useState('');
 const act=(action:'edit'|'pause'|'resume'|'archive'|'approve'|'reject')=>start(async()=>{try{const result=await manageCampaignAction({id:c.id,expected:c.updated_at??'',action,title,caption:c.source_type==='custom'?caption:undefined,reason});setMessage(result.message);if(result.ok){setEditor(null);router.refresh();window.dispatchEvent(new Event('campaign:reviewed'));}}catch{setMessage('Ad could not save. Refresh and retry.');}});
 const editable=['pending_review','awaiting_payment'].includes(c.status);
 return <article className="campaign-list-row"><button className="campaign-thumbnail" aria-label={`Preview ${c.title}`} onClick={()=>setEditor(editor==='preview'?null:'preview')}>{c.image?<Image unoptimized src={c.image} alt={c.title} width={76} height={76}/>:<span>Photo unavailable</span>}</button><div className="campaign-row-content"><div className="campaign-row-heading"><h2>{c.title}</h2><span className="campaign-row-status">{statuses[c.status]}</span></div><p>{c.salonName} · {c.location}, {c.country} · {formatCredits(c.spent_cents)} / {formatCredits(c.cycle_credit_limit??c.total_price_cents)} credits</p><p className="campaign-row-date">{new Date(c.created_at).toLocaleDateString()} {c.status==='rejected'&&c.review_note?`· ${c.review_note}`:''}</p><div className="campaign-row-actions">
 {c.status==='pending_review'?<><button disabled={busy} className="campaign-primary" onClick={()=>act('approve')}>Approve</button><button disabled={busy} onClick={()=>setEditor(editor==='reject'?null:'reject')}>Decline</button></>:null}
 {c.status==='running'?<button disabled={busy} onClick={()=>act('pause')}>Pause</button>:null}
 {c.status==='paused'?<button disabled={busy} onClick={()=>act('resume')}>Resume</button>:null}
 {editable?<button disabled={busy} onClick={()=>setEditor(editor==='edit'?null:'edit')}>Edit</button>:null}
 <button disabled={busy} className="campaign-danger" onClick={()=>setEditor(editor==='archive'?null:'archive')}>Delete</button>
 {c.href?<a href={c.href} target="_blank" rel="noopener noreferrer">{c.source_type==='salon_profile_look'?'View post ↗':'View business ↗'}</a>:<button onClick={()=>setEditor(editor==='preview'?null:'preview')}>View ad</button>}
 <button onClick={()=>setEditor(editor==='preview'?null:'preview')}>Details</button></div></div>
 {editor==='preview'?<div className="campaign-inline"><div className="campaign-inline-heading"><strong>{c.salonName}</strong><button onClick={()=>setEditor(null)}>Close</button></div>{c.image?<Image unoptimized src={c.image} alt={c.title} width={600} height={450} className="campaign-preview-image"/>:null}<p style={{whiteSpace:'pre-wrap'}}>{c.caption||'Source content is unavailable.'}</p><p>{c.views.toLocaleString()} views · {c.likes.toLocaleString()} likes · {c.bookings.toLocaleString()} bookings</p></div>:null}
 {editor==='edit'?<form className="campaign-inline" onSubmit={e=>{e.preventDefault();act('edit');}}><label>Title<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)}/></label>{c.source_type==='custom'?<label>Message<textarea required maxLength={2200} rows={3} value={caption} onChange={e=>setCaption(e.target.value)}/></label>:<p>The published post is kept unchanged.</p>}<div className="campaign-inline-actions"><button type="button" disabled={busy} onClick={()=>setEditor(null)}>Cancel</button><button disabled={busy} className="campaign-primary">{busy?'Saving…':'Save'}</button></div></form>:null}
 {editor==='reject'?<form className="campaign-inline" onSubmit={e=>{e.preventDefault();act('reject');}}><label>Reason for the salon<input required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="campaign-inline-actions"><button type="button" disabled={busy} onClick={()=>setEditor(null)}>Cancel</button><button disabled={busy||reason.trim().length<3}>Decline & return unused credits</button></div></form>:null}
 {editor==='archive'?<div className="campaign-inline"><p>Remove this ad? Unused reserved credits will be returned. The original post and credit history are kept.</p><div className="campaign-inline-actions"><button disabled={busy} onClick={()=>setEditor(null)}>Cancel</button><button className="campaign-danger" disabled={busy} onClick={()=>act('archive')}>{busy?'Removing…':'Delete ad'}</button></div></div>:null}
 {message?<p className="campaign-row-message" role="status">{message}</p>:null}</article>;
}
export function CampaignList({campaigns}:{campaigns:CampaignAdminRow[]}){return <section aria-label="Ads">{campaigns.length?campaigns.map(c=><AdRow key={`${c.id}:${c.updated_at}`} campaign={c}/>):<p className="campaign-empty">No ads match these filters.</p>}</section>;}
