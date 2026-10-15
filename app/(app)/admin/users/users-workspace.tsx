"use client";
import { AdminIcon } from "../_components/admin-icon";
import Form from "next/form";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EntityPicker } from "../_components/entity-picker";
import { PLATFORM_ADMIN_PERMISSIONS as P, type PlatformAdminContext, type PlatformAdminPageResult, type PlatformAdminUserListItem } from "@/types/platform-admin";
import type { UserWorkspace, UserDrawerTab, UserOperationResult } from "@/types/admin-users-workspace";
import { UserOperationForm, UserReason } from "./user-operation-form";
import { UserDrawerContent, userDate, userName } from "./user-drawer-content";
import { bulkUserAccessAction } from "./workspace-actions";
import styles from "./users.module.css";

type Props={users:PlatformAdminPageResult<PlatformAdminUserListItem>&{can_read_sensitive:boolean};context:PlatformAdminContext;query:Record<string,string|undefined>;initialUserId?:string;initialTab?:UserDrawerTab;identityReady:boolean};
function UserRowMenu({label,children}:{label:string;children:ReactNode}) {
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const outside=(event:Event)=>{if(event.target instanceof Node&&!ref.current?.contains(event.target)&&ref.current)ref.current.open=false;};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&ref.current?.open){event.preventDefault();event.stopPropagation();ref.current.open=false;ref.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape,true);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape,true);};
 },[]);
 return <details ref={ref} className={styles.rowMenu} onPointerLeave={event=>{if(event.pointerType==='mouse')event.currentTarget.open=false;}}><summary aria-label={label}><AdminIcon name="more" /></summary><div onClick={event=>{if((event.target as HTMLElement).closest('button')&&ref.current)ref.current.open=false;}}>{children}</div></details>;
}
export function UsersWorkspace({users,context,query,initialUserId,initialTab='profile',identityReady}:Props) {
 const router=useRouter();const [selected,setSelected]=useState<string[]>([]);
 const [current,setCurrent]=useState<string|null>(initialUserId??null);const [tab,setTab]=useState<UserDrawerTab>(initialTab);
 const [data,setData]=useState<UserWorkspace|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 const [mode,setMode]=useState<'invite'|'create'|null>(null);const [caseId,setCaseId]=useState<string|null>(null);
 const [bulk,setBulk]=useState<'suspend'|'restore'|null>(null);const [notice,setNotice]=useState<UserOperationResult|null>(null);
 const [revision,setRevision]=useState(0);const [dirty,setDirty]=useState(false);const [mobile,setMobile]=useState(false);
 const drawerRef=useRef<HTMLElement>(null);const opener=useRef<HTMLElement|null>(null);const allRef=useRef<HTMLInputElement>(null);
 const can=(p:typeof P[keyof typeof P])=>context.permissions.includes(p);const open=!!current||!!mode;
 const visibleIds=users.items.map(u=>u.id);const eligible=visibleIds.filter(id=>id!==context.userId);
 const chosen=selected.filter(id=>eligible.includes(id));const all=eligible.length>0&&eligible.every(id=>chosen.includes(id));
 useEffect(()=>{if(allRef.current)allRef.current.indeterminate=chosen.length>0&&!all;},[chosen.length,all]);
 useEffect(()=>{const media=window.matchMedia('(max-width: 1199px)');const update=()=>setMobile(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 useEffect(()=>{
  if(!current)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{setLoading(true);setError('');setData(null);},0);
  fetch(`/admin/users/workspace?id=${encodeURIComponent(current)}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to load user.');return result as UserWorkspace;}).then(result=>{if(!controller.signal.aborted){setData(result);setLoading(false);}}).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Unable to load user.');setLoading(false);}});
  return()=>{clearTimeout(timer);controller.abort();};
 },[current,revision]);
 const guard=useCallback(()=>{if(drawerRef.current?.querySelector('form[aria-busy="true"]'))return false;return !dirty||window.confirm('Discard unsaved changes in this drawer?');},[dirty]);
 const close=useCallback(()=>{if(!guard())return;setCurrent(null);setMode(null);setData(null);setCaseId(null);setDirty(false);opener.current?.focus();},[guard]);
 useEffect(()=>{
  if(!open)return;const panel=drawerRef.current;panel?.focus();
 },[open]);
 useEffect(()=>{
  if(!open)return;const panel=drawerRef.current;
  function key(e:KeyboardEvent){if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'&&mobile&&panel){const nodes=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),a[href],summary')).filter(n=>n.getClientRects().length>0);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[open,mobile,close]);
 useEffect(()=>{if(!dirty)return;const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty]);
 function choose(id:string,nextTab:UserDrawerTab='profile'){if(!guard())return;opener.current=document.activeElement as HTMLElement;setDirty(false);setCurrent(id);setMode(null);setTab(nextTab);setCaseId(null);setData(null);setNotice(null);setRevision(v=>v+1);}
 function changeTab(next:UserDrawerTab){if(next===tab)return;if(!guard())return;setDirty(false);setTab(next);setCaseId(null);}
 function result(r:UserOperationResult){setNotice(r);if(r.ok||r.requestStatus){setDirty(false);if(mode&&r.userId){setMode(null);setCurrent(r.userId);}router.refresh();}if(current&&(r.ok||r.requestStatus))setRevision(v=>v+1);}
 function newUser(next:'invite'|'create'){if(!guard())return;opener.current=document.activeElement as HTMLElement;setMode(next);setCurrent(null);setData(null);setDirty(false);setNotice(null);}
 const filterParams=new URLSearchParams();for(const [k,v] of Object.entries(query))if(v&&k!=='user'&&k!=='tab')filterParams.set(k,v);
 const pageHref=(page:number)=>{const q=new URLSearchParams(filterParams);q.set('page',String(page));q.set('pageSize',String(users.page_size));return `/admin/users?${q}`;};
 return <div className={styles.workspace} data-user-workspace>
  <div className={`${styles.body} ${open?styles.withDrawer:''}`}>
   <div className={styles.list}>
    <header className={styles.header}><h1>Users</h1><div className={styles.actions}><button type="button" className={styles.button} onClick={()=>{if(guard())router.refresh();}}><AdminIcon name="refresh" />Refresh</button><a className={styles.button} href={`/admin/users/export?${filterParams}`}><AdminIcon name="download" />Export CSV</a>{can(P.usersCreate)&&<><button className={styles.button} disabled={!identityReady} onClick={()=>newUser('invite')}><AdminIcon name="plus" />Invite</button><button className={styles.primary} disabled={!identityReady} onClick={()=>newUser('create')}><AdminIcon name="plus" />Create user</button></>}</div></header>
    <Form action="/admin/users" key={JSON.stringify(query)} className={styles.toolbar} onSubmit={e=>{if(!guard())e.preventDefault();}}>
     <label className={styles.search}><span className="sr-only">Search users</span><input type="search" name="q" defaultValue={query.q} maxLength={100} placeholder="Name, email, phone, ID"/></label>
     <label><span className="sr-only">Status</span><select name="status" defaultValue={query.status??''}><option value="">Status · All</option>{['active','inactive','suspended','pending_deletion','deleted'].map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label>
     <label><span className="sr-only">Role</span><select name="role" defaultValue={query.role??''}><option value="">Role · All</option>{['owner','manager','staff','customer','platform_admin'].map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label>
     <div className={styles.businessFilter}><EntityPicker kind="location" label="Business" name="businessId" defaultValue={query.businessId} defaultLabel={query.businessId?'Selected business':''}/></div>
     <label><span className="sr-only">Sort</span><select name="sort" defaultValue={query.sort??'created_desc'}><option value="created_desc">Sort · Newest</option><option value="name_asc">Name A–Z</option><option value="last_login_desc">Last login</option></select></label>
     <label className={styles.rowsFilter}><span className="sr-only">Rows</span><select name="pageSize" defaultValue={String(users.page_size)}>{[...new Set([25,50,100,users.page_size])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>Rows {n}</option>)}</select></label>
     <button className={styles.button} type="submit">Apply</button>{['q','status','role','businessId'].some(k=>query[k])&&<Link className={styles.ghost} href="/admin/users" onClick={e=>{if(!guard())e.preventDefault();}}>Reset</Link>}
    </Form>
    {chosen.length>0&&<div className={styles.bulkBar}><strong>{chosen.length} selected</strong>{can(P.usersSuspend)&&<button className={styles.button} onClick={()=>setBulk(bulk==='suspend'?null:'suspend')}><AdminIcon name="lock" />Suspend</button>}{can(P.usersRestore)&&<button className={styles.button} onClick={()=>setBulk(bulk==='restore'?null:'restore')}>Restore</button>}<a className={styles.button} href={`/admin/users/export?ids=${chosen.join(',')}`}><AdminIcon name="download" />Export selected</a><button className={styles.ghost} onClick={()=>{setSelected([]);setBulk(null);}}>Clear selection</button></div>}
    {bulk&&chosen.length>0&&<UserOperationForm operation={bulk} action={bulkUserAccessAction} onResult={r=>{setNotice(r);if(r.results){setSelected(r.results.filter(v=>!v.ok).map(v=>v.id));setBulk(null);router.refresh();if(current&&(r.ok||r.requestStatus))setRevision(v=>v+1);}}} label={`${bulk==='suspend'?'Suspend':'Restore'} ${chosen.length} users`} confirm={`Apply ${bulk} to ${chosen.length} selected users? Each result will be recorded separately.`} onCancel={()=>setBulk(null)}><input type="hidden" name="selection" value={JSON.stringify(chosen)}/><UserReason/></UserOperationForm>}
    {notice&&(!open||notice.results)&&<div className={notice.ok?styles.success:styles.error} role={notice.ok?'status':'alert'}>{notice.message}<button className={styles.ghost} aria-label="Dismiss result" onClick={()=>setNotice(null)}><AdminIcon name="close" /></button>{notice.results&&<ul>{notice.results.map(r=><li key={r.id}>{userName(users.items.find(u=>u.id===r.id)??{display_name:r.id})} · {r.message}</li>)}</ul>}</div>}
    <div className={styles.tableScroll}><table className={styles.table}><caption className="sr-only">Platform users matching current filters</caption><thead><tr><th><input ref={allRef} type="checkbox" aria-label="Select all users on this page" checked={all} disabled={!eligible.length} onChange={e=>setSelected(e.target.checked?eligible:[])}/></th><th scope="col">User / ID</th><th scope="col">Contact</th><th scope="col">Status</th><th scope="col">Business / role</th><th scope="col">Last login</th><th scope="col">Actions</th></tr></thead>
    <tbody>{users.items.map(u=><tr key={u.id} className={current===u.id?styles.selectedRow:undefined}>
     <td><input type="checkbox" aria-label={`Select ${userName(u)}`} disabled={u.id===context.userId} checked={chosen.includes(u.id)} onChange={e=>setSelected(e.target.checked?[...chosen,u.id]:chosen.filter(id=>id!==u.id))}/></td>
     <td><div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{userName(u).split(' ').map(v=>v[0]).slice(0,2).join('').toUpperCase()}</span><div><button className={styles.name} onClick={()=>choose(u.id)}>{userName(u)}</button><small className={styles.identifier} title={u.id}>{u.id.slice(0,8)}</small></div></div></td>
     <td><span className={styles.contact} title={users.can_read_sensitive?u.email??undefined:undefined}>{users.can_read_sensitive?u.email??'—':'Restricted'}</span>{users.can_read_sensitive&&u.phone&&<small>{u.phone}</small>}</td>
     <td><span className={`${styles.status} ${styles[u.status]??''}`}>{u.status.replaceAll('_',' ')}</span></td>
     <td>{u.businesses?.length?u.businesses.slice(0,2).map(b=><span key={b.id}>{b.name}</span>):<span>—</span>}<small>{u.roles?.join(', ')||'Customer'}{(u.businesses?.length??0)>2&&` · +${u.businesses!.length-2} more`}</small></td>
     <td className={styles.dates}>{u.last_login_at?<span>{userDate(u.last_login_at)}</span>:<small>Never signed in</small>}</td>
     <td><div className={styles.rowActions}><button className={styles.button} onClick={()=>choose(u.id,'profile')}><AdminIcon name={can(P.usersUpdate)&&u.status!=='deleted'?'edit':'next'} />{can(P.usersUpdate)&&u.status!=='deleted'?'Edit':'View'}</button><button className={styles.button} onClick={()=>choose(u.id,'security')}><AdminIcon name="lock" />Security</button><UserRowMenu label={`More actions for ${userName(u)}`}><button onClick={()=>choose(u.id,'access')}>Access & roles</button><button onClick={()=>choose(u.id,'activity')}>Activity</button><button onClick={()=>{choose(u.id,'security');setCaseId('new');}}>Support case</button></UserRowMenu></div></td>
    </tr>)}{!users.items.length&&<tr><td colSpan={7} className={styles.empty}>No users match these filters.</td></tr>}</tbody></table></div>
    <footer className={styles.pagination}><span>{users.total?`${(users.page-1)*users.page_size+1}–${Math.min(users.page*users.page_size,users.total)} of ${users.total}`:'0 users'}</span><div className={styles.actions}>{users.page>1&&<Link className={styles.button} href={pageHref(users.page-1)} onClick={e=>{if(!guard())e.preventDefault();}}><AdminIcon name="previous" />Previous</Link>}<span className={styles.pageNumber}>{users.page}</span>{users.page*users.page_size<users.total&&<Link className={styles.button} href={pageHref(users.page+1)} onClick={e=>{if(!guard())e.preventDefault();}}>Next<AdminIcon name="next" /></Link>}</div></footer>
   </div>
   {open&&<>{mobile&&<button className={styles.backdrop} aria-label="Close user drawer" onClick={close}/>}
   <aside ref={drawerRef} className={styles.drawer} role="dialog" aria-modal={mobile||undefined} aria-labelledby="user-drawer-heading" tabIndex={-1} onChange={()=>setDirty(true)}>
    <header className={styles.drawerHeader}><div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{mode?'+':data?userName(data.user).split(' ').map(v=>v[0]).slice(0,2).join('').toUpperCase():'…'}</span><div><h2 id="user-drawer-heading">{mode?mode==='invite'?'Invite user':'Create user':data?userName(data.user):'User account'}</h2>{data&&<small className={styles.identifier}>{data.user.id}</small>}</div>{data&&<span className={`${styles.status} ${styles[data.user.status]??''}`}>{data.user.status.replaceAll('_',' ')}</span>}</div><div className={styles.actions}>{current&&<><button className={styles.button} aria-label="Previous user" disabled={visibleIds.indexOf(current)<=0} onClick={()=>choose(visibleIds[visibleIds.indexOf(current)-1],tab)}><AdminIcon name="previous" /></button><button className={styles.button} aria-label="Next user" disabled={visibleIds.indexOf(current)<0||visibleIds.indexOf(current)>=visibleIds.length-1} onClick={()=>choose(visibleIds[visibleIds.indexOf(current)+1],tab)}><AdminIcon name="next" /></button></>}<button className={styles.ghost} aria-label="Close drawer" onClick={close}><AdminIcon name="close" /></button></div></header>
    {!mode&&<div className={styles.tabs} role="tablist" aria-label="User administration">{(['profile','access','security','activity'] as const).map(t=><button id={`user-tab-${t}`} role="tab" aria-selected={t===tab} aria-controls={`user-panel-${tab}`} className={t===tab?styles.activeTab:undefined} key={t} onClick={()=>changeTab(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}</div>}
    <div className={styles.drawerBody}>{notice&&!notice.results&&<div className={notice.ok?styles.success:styles.error} role={notice.ok?"status":"alert"}>{notice.message}<button className={styles.ghost} aria-label="Dismiss result" onClick={()=>setNotice(null)}><AdminIcon name="close" /></button></div>}
    {mode?<UserOperationForm key={mode} operation={mode} label={mode==='invite'?'Send invitation':'Create user'} onResult={result} confirm={mode==='create'?'Create this authentication account with an unverified email?':undefined}><div className={styles.fields}><label className={styles.full}>Email<input name="email" type="email" required maxLength={254} autoComplete="off"/></label><FieldForNew name="display_name" label="Display name"/><FieldForNew name="first_name" label="First name"/><FieldForNew name="last_name" label="Last name"/>{mode==='create'&&<label className={styles.full}>Temporary password<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/><small>Email starts unverified. No password is sent by email.</small></label>}<UserReason/></div></UserOperationForm>:<>
     {loading&&<p role="status" className={styles.notice}>Loading user…</p>}
     {error&&<div role="alert"><p className={styles.error}>{error}</p><button className={styles.button} onClick={()=>setRevision(v=>v+1)}>Retry</button></div>}
     {data&&<div id={`user-panel-${tab}`} role="tabpanel" aria-labelledby={`user-tab-${tab}`}><UserDrawerContent key={`${data.user.id}-${tab}-${data.user.updated_at}-${data.cases.map(c=>c.updated_at).join(',')}`} data={data} tab={tab} onResult={result} caseId={caseId} setCaseId={id=>{if(guard()){setDirty(false);setCaseId(id);}}}/>{data.errors.length>0&&<div className={styles.error}>{data.errors.map(message=><p key={message}>{message}</p>)}<button className={styles.button} onClick={()=>setRevision(v=>v+1)}>Retry sections</button></div>}</div>}
    </>}
    </div>
   </aside></>}
  </div>
 </div>;
}
function FieldForNew({name,label}:{name:string;label:string}) {return <label>{label}<input name={name} maxLength={150}/></label>;}


