"use client";
import { useEffect,useState,type ReactNode } from 'react';
// Web Locks are released by the browser even after a tab/process crashes.
// Different browser profiles/native app stores remain independent workspaces.
export function SingleWorkspaceWindow({id,children}:{id:string;children:ReactNode}){
  const [state,setState]=useState<'opening'|'ready'|'occupied'|'unsupported'>('opening');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true,release:(()=>void)|undefined;
    if(!navigator.locks){queueMicrotask(()=>{if(active)setState('unsupported');});return()=>{active=false;};}
    void (async()=>{
      // A responsive slot can mount before the previous slot's lock promise
      // settles. Give that same-window handoff a brief opportunity to finish.
      for(let round=0;round<20&&active;round++){
        let acquired=false;
        await navigator.locks.request('kingpos:workspace-window:'+id,{ifAvailable:true},async lock=>{
          if(!active||!lock)return;
          acquired=true;setState('ready');await new Promise<void>(resolve=>{release=resolve;});
        });
        if(acquired||!active)return;
        if(round<19)await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(active)setState('occupied');
    })().catch(()=>{if(active)setState('unsupported');});
    return()=>{active=false;release?.();};
  },[id,attempt]);
  if(state==='ready')return children;
  return <section className="grid min-h-64 place-items-center p-6 text-center"><div><h2 className="text-lg font-semibold">{state==='opening'?'Opening POS…':state==='occupied'?'POS is already open in another window':'Open POS in a supported browser'}</h2>{state==='occupied'?<><p className="mt-2 text-sm text-zinc-600">Continue in that window, or close it before opening POS here. Your saved work stays on this device.</p><button className="mt-4 min-h-12 rounded-xl bg-orange-600 px-5 font-semibold text-white" onClick={()=>setAttempt(v=>v+1)}>Open here</button></>:null}</div></section>;
}
