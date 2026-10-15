'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {WorkspaceText} from '@/components/workspace-language';
import {loadBlockedUsers,setUserBlocked,type BlockedUser} from '@/app/post-moderation/block-actions';
import {notifyUserBlocksChanged} from '@/components/post-safety';

export function BlockedUsersPanel() {
 const router=useRouter();
 const [users,setUsers]=useState<BlockedUser[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 function load(){return loadBlockedUsers().then(nextUsers=>{setUsers(nextUsers);setLoaded(true);}).catch(()=>{setError('Blocked users could not be loaded. Please retry.');});}
 useEffect(()=>{void load();},[]);
 async function unblock(id:string){setBusy(id);setError('');try{const result=await setUserBlocked(id,false);if(result.error)throw Error(result.error);setUsers(current=>current.filter(user=>user.user_id!==id));notifyUserBlocksChanged();router.refresh();}catch(e){setError(e instanceof Error?e.message:'Could not unblock this user.');}finally{setBusy('');}}
 return <section className="grid gap-4"><p><WorkspaceText text="Blocked users cannot interact with you through posts, comments or follows while signed in. You will not see each other's social content. Public content may still be accessible when signed out. Salon bookings and business records are not affected."/></p>
 {error?<div role="alert"><p><WorkspaceText text={error}/></p><button onClick={()=>{setError('');void load();}} className="underline"><WorkspaceText text="Try again"/></button></div>:null}
 {!loaded&&!error?<p role="status"><WorkspaceText text="Loading…"/></p>:null}
 {loaded&&users.length===0?<p><WorkspaceText text="You have not blocked anyone."/></p>:null}
 {users.map(user=><div key={user.user_id} className="flex items-center justify-between gap-4 rounded-xl border p-3"><span>{user.display_name}</span><button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-lg border px-4 disabled:opacity-50" onClick={()=>void unblock(user.user_id)}><WorkspaceText text={busy===user.user_id?'Please wait…':'Unblock'}/></button></div>)}
 </section>;
}
