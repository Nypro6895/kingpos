"use client";
import {useEffect,useState} from "react";
import {useSearchParams} from "next/navigation";
import {PayrollChangeHistory} from "./payroll-change-history";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import {WorkspaceText as Text} from "@/components/workspace-language";
export function FinancialInputHistoryPanel({salonId="",surface="today",start,end,refreshKey,scope="",title="Recent input changes"}:{salonId?:string;surface?:"today"|"reports"|"payroll";start?:string;end?:string;refreshKey?:unknown;scope?:string;title?:string}){
 const query=useSearchParams(),eventDate=surface==="today"?query.get("eventDate"):null;
 const key=JSON.stringify([salonId,surface,start,end,eventDate,refreshKey,scope]);
 const [result,setResult]=useState<{key:string;rows:PayrollLiveChange[];error:string}>({key:"",rows:[],error:""});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const abort=new AbortController();
  let readVersion=0;
  async function load(){
   const version=++readVersion;
   const args=new URLSearchParams({surface});if(salonId)args.set("salonId",salonId);if(start)args.set("start",start);if(end)args.set("end",end);
   if(eventDate&&/^\d{4}-\d{2}-\d{2}$/.test(eventDate))args.set("date",eventDate);
   try{const response=await fetch(`/api/financial-input-history?${args}`,{credentials:"same-origin",cache:"no-store",signal:abort.signal});const data=await response.json();if(!response.ok||!Array.isArray(data.rows))throw new Error(data.error??"History unavailable.");if(!abort.signal.aborted&&version===readVersion)setResult({key,rows:data.rows,error:""});}
   catch{if(!abort.signal.aborted&&version===readVersion)setResult({key,rows:[],error:"Input history could not be loaded."});}
  }
  void load();const refresh=()=>{if(document.visibilityState==="visible")void load();};
  window.addEventListener("focus",refresh);window.addEventListener("financial-input-saved",refresh);window.addEventListener("hashchange",refresh);
  return()=>{abort.abort();window.removeEventListener("focus",refresh);window.removeEventListener("financial-input-saved",refresh);window.removeEventListener("hashchange",refresh);};
 },[key,attempt,salonId,surface,start,end,eventDate]);
 if(result.key!==key)return <div id="input-history"><p role="status" className="py-3 text-sm text-zinc-500"><Text text="Loading input history…"/></p></div>;
 if(result.error)return <div id="input-history"><p role="status" className="py-3 text-sm"><Text text={result.error}/> <button type="button" className="min-h-11 underline" onClick={()=>setAttempt(n=>n+1)}><Text text="Retry"/></button></p></div>;
 return <div id="input-history"><PayrollChangeHistory compact changes={result.rows} title={title}/></div>;
}
