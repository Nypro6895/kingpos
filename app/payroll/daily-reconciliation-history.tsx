"use client";
import {useEffect,useState} from "react";
import {WorkspaceText as Text} from "@/components/workspace-language";
import type {DailyInputReconciliation} from "@/lib/daily-input-reconciliation";
import styles from "./payroll-object-history.module.css";
export type DailyReconciliationCase={id:string;business_date:string;revision:number;latest_values:DailyInputReconciliation;revisions:Array<{revision:number;values:DailyInputReconciliation;created_at:string}>};
function facts(values:DailyInputReconciliation){return JSON.stringify([values.grossService,values.discount,values.expectedService,values.expectedTip,values.actualService,values.actualTip,values.serviceDifference,values.tipDifference]);}
export function previousDailyChecks(value:DailyReconciliationCase){
 const seen=new Set([facts(value.latest_values)]);
 return [...value.revisions].filter(row=>row.revision<value.revision).sort((a,b)=>b.revision-a.revision).filter(row=>{const key=facts(row.values);if(seen.has(key))return false;seen.add(key);return true;});
}
export function useDailyReconciliationHistory({salonId,start,end,enabled}:{salonId?:string;start:string;end:string;enabled:boolean}){
 const key=JSON.stringify([salonId,start,end,enabled]),[attempt,setAttempt]=useState(0);
 const [state,setState]=useState<{key:string;rows:DailyReconciliationCase[];timezone:string;error:string}>({key:"",rows:[],timezone:"UTC",error:""});
 useEffect(()=>{
  if(!enabled||!salonId||!start||!end)return;
  const controller=new AbortController();let version=0;
  const load=async()=>{const current=++version;try{const response=await fetch('/api/reports/reconciliation-cases?'+new URLSearchParams({salonId,start,end}),{credentials:"same-origin",cache:"no-store",signal:controller.signal}),data=await response.json();if(!response.ok||!Array.isArray(data.rows))throw Error();if(!controller.signal.aborted&&current===version)setState({key,rows:data.rows,timezone:typeof data.timezone==="string"?data.timezone:"UTC",error:""});}catch{if(!controller.signal.aborted&&current===version)setState({key,rows:[],timezone:"UTC",error:"Previous checks could not be loaded."});}};
  void load();const refresh=()=>{if(document.visibilityState==="visible")void load();};window.addEventListener("financial-input-saved",refresh);window.addEventListener("focus",refresh);
  return()=>{controller.abort();window.removeEventListener("financial-input-saved",refresh);window.removeEventListener("focus",refresh);};
 },[key,salonId,start,end,enabled,attempt]);
 return {...(state.key===key?state:{rows:[],timezone:"UTC",error:""}),retry:()=>setAttempt(value=>value+1)};
}
export function DailyReconciliationPreviousChecks({value,timezone}:{value?:DailyReconciliationCase;timezone:string}){
 const checks=value?previousDailyChecks(value):[];
 if(!checks.length)return null;
 const amount=(number:number|null)=>number===null?"Not entered":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(number);
 return <details className={styles.subdetail}><summary><Text text="Previous automatic checks"/> · {checks.length}</summary>{checks.map(row=><div key={row.revision} className={styles.check}><time dateTime={row.created_at}>{new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:timezone}).format(new Date(row.created_at))}{timezone==="UTC"?" UTC":""}</time><span><Text text="Service difference"/>: <Text text={amount(row.values.serviceDifference)}/></span><span><Text text="Tip difference"/>: <Text text={amount(row.values.tipDifference)}/></span></div>)}</details>;
}
