"use client";
import {useEffect,useState} from 'react';
export function PrepareWorkspaceDevice(){
 const [failed,setFailed]=useState(false);
 useEffect(()=>{let active=true;void fetch('/api/pos/portable/device',{method:'POST'}).then(response=>{if(!response.ok)throw Error();if(active)window.location.reload();}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[]);
 return <section className="grid h-full place-items-center p-6">{failed?<div><p>Connect to prepare this POS for its first use.</p><button className="mt-3 min-h-12 rounded-lg border px-5" onClick={()=>window.location.reload()}>Try again</button></div>:<p>Preparing this POS…</p>}</section>;
}
