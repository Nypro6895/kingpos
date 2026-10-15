'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {setUserBlocked} from '@/app/post-moderation/block-actions';
import {WorkspaceText} from './workspace-language';
import {notifyUserBlocksChanged} from './post-safety';

export function BlockUserButton({userId}:{userId:string}) {
 const router=useRouter();
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function block(){setBusy(true);setError('');try{const result=await setUserBlocked(userId,true);if(result.error)throw Error(result.error);notifyUserBlocksChanged();router.refresh();setConfirm(false);}catch(e){setError(e instanceof Error?e.message:'Could not block this user.');}finally{setBusy(false);}}
 return <span className="grid gap-2 text-xs">{confirm?<><span><WorkspaceText text="Block this user and hide their social content? You can unblock them in Settings."/></span><button className="min-h-11 text-red-700" disabled={busy} onClick={()=>void block()} type="button"><WorkspaceText text={busy?'Please wait…':'Confirm block'}/></button><button disabled={busy} onClick={()=>setConfirm(false)} type="button"><WorkspaceText text="Cancel"/></button></>:<button className="min-h-11 px-2 text-red-700" onClick={()=>setConfirm(true)} type="button"><WorkspaceText text="Block user"/></button>}{error?<span role="alert"><WorkspaceText text={error}/></span>:null}</span>;
}
