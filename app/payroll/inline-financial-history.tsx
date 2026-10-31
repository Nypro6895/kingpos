"use client";

import {createContext,useCallback,useContext,useEffect,useId,useMemo,useRef,useState,type ReactNode} from "react";
import {useSearchParams} from "next/navigation";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {describeFinancialInputChange,financialHistoryText} from "@/lib/financial-change-presentation";
import {financialHistoryForObject,financialHistoryMatchesObject,type FinancialHistoryObject} from "@/lib/inline-financial-history";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import styles from "./inline-financial-history.module.css";

export const inlineHistoryEditedClassName=styles.editedRow;
type ContextValue={changes:PayrollLiveChange[];record?:PayrollLiveChange;focusedEventId?:string;loading:boolean;error:string;retry:()=>void;claim?:(id:string,key:string)=>()=>void};
const empty:ContextValue={changes:[],loading:false,error:"",retry:()=>{}};
const Context=createContext<ContextValue>(empty);
type Result={key:string;changes:PayrollLiveChange[];record?:PayrollLiveChange;loading:boolean;error:string};
export type InlineFinancialHistoryReader=(eventId?:string)=>Promise<{rows:PayrollLiveChange[];record?:PayrollLiveChange}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function time(change:PayrollLiveChange){
 if(!Number.isFinite(Date.parse(change.created_at)))return "";
 try{return new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:change.business_timezone??"UTC"}).format(new Date(change.created_at));}catch{return "";}
}
function openObject(element:HTMLElement|null){
 let parent=element?.parentElement;
 while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
 element?.scrollIntoView?.({block:"nearest"});
}
function Entries({changes,focusedEventId}:{changes:PayrollLiveChange[];focusedEventId?:string}){
 const ref=useRef<HTMLUListElement>(null);
 useEffect(()=>{if(focusedEventId)openObject(ref.current?.querySelector<HTMLElement>(`[data-input-event="${focusedEventId}"]`)??null);},[focusedEventId,changes]);
 return <ul ref={ref} className={styles.entries}>{changes.map(change=>{
  const description=describeFinancialInputChange(change);
  const details=description.details.filter(detail=>!(change.source_table==="ticket"&&description.groups.length&&detail.label==="Service sales"));
  const rows=[...details,...description.groups.flatMap(group=>group.details.map(detail=>({...detail,label:`${group.title} · ${detail.label}`})))].map(detail=>{
   if(change.source_table!=="daily_report"&&change.source_table!=="pos_daily_closings")return detail;
   const display=(values:Record<string,unknown>,value:string)=>detail.label==="Entered tips"&&values.tip_input===null?"Not entered":["Cash","Card","Other"].includes(detail.label)&&values.entered===false?"Not entered":value;
   return {...detail,before:display(change.before_values,detail.before),after:display(change.after_values,detail.after)};
  });
  const note=financialHistoryText(change.note),actor=financialHistoryText(change.actor_name,"Owner"),edited=time(change);
  const userNote=note&&!['Ticket created','Daily Report inputs updated','Payroll settings updated'].includes(note)?note:"";
  return <li key={`${change.id}:${change.staff_id??""}`} data-input-event={change.id} data-business-date={change.period_start} className={styles.entry}>
   {rows.length?<dl className={styles.values}>{rows.map((detail,index)=><div className={styles.value} key={`${detail.label}:${index}`}><dt><Text text={detail.label}/></dt><dd>{detail.before} <span aria-hidden="true">→</span> {detail.after}</dd></div>)}</dl>:<p className={styles.unavailable}><Text text={description.incomplete?"Earlier record; full before / after details were not recorded.":description.summary}/></p>}
   {userNote&&<p className={styles.note}>{userNote}</p>}
   <p className={styles.meta}>{actor}{edited&&<> · <time dateTime={change.created_at}>{edited}</time></>}</p>
  </li>;
 })}</ul>;
}

/** A direct child of the existing object's disclosure: no second history module. */
export function InlineFinancialHistory({changes,className}:{changes:readonly PayrollLiveChange[];className?:string}){
 const context=useContext(Context),query=useSearchParams(),key=useId(),claim=context.claim;
 const focused=context.focusedEventId??query?.get("inputEvent")?.toLowerCase();
 const rows=financialHistoryForObject(changes),matching=focused&&rows.some(row=>row.id===focused)?focused:undefined;
 useEffect(()=>matching?claim?.(matching,key):undefined,[claim,matching,key]);
 if(!rows.length)return null;
 return <div className={className}><Entries changes={rows} focusedEventId={matching}/></div>;
}

export function useFinancialHistoryContext(){return useContext(Context);}
export function useInlineFinancialHistory(object:FinancialHistoryObject={}){
 const context=useContext(Context),key=useId(),selector=JSON.stringify(object),claim=context.claim;
 const changes=useMemo(()=>financialHistoryForObject(context.changes,JSON.parse(selector) as FinancialHistoryObject),[context.changes,selector]);
 const record=context.record&&financialHistoryMatchesObject(context.record,object)?context.record:undefined;
 const focused=context.focusedEventId&&(changes.some(row=>row.id===context.focusedEventId)||record?.id===context.focusedEventId)?context.focusedEventId:undefined;
 useEffect(()=>focused?claim?.(focused,key):undefined,[claim,focused,key]);
 return {changes,hasChanges:changes.length>0,loading:context.loading,error:context.error,record,focusedEventId:focused,retry:context.retry};
}

export function InlineFinancialRecord({record,claimFocus=true}:{record:PayrollLiveChange;claimFocus?:boolean}){
 const ref=useRef<HTMLDivElement>(null),values=record.after_values,context=useContext(Context),key=useId(),claim=context.claim;
 const matching=claimFocus&&context.focusedEventId===record.id?record.id:undefined;
 useEffect(()=>matching?claim?.(matching,key):undefined,[claim,matching,key]);
 useEffect(()=>openObject(ref.current),[record.id]);
 const money=(value:unknown)=>value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(value)):"—";
 const lines=Array.isArray(values.lines)?values.lines.filter((line):line is Record<string,unknown>=>Boolean(line)&&typeof line==="object"):[];
 const items=record.source_table==="ticket"?[["Services",money(values.service_total)],["Tips",money(values.tip_amount)],...lines.map(line=>[financialHistoryText(line.service_name,"Service"),money(line.service_total)])]:describeFinancialInputChange(record).details.map(detail=>[detail.label,detail.after]);
 return <div ref={ref} className={styles.record} data-input-record={record.id}>
  <dl className={styles.values}>{items.map(([label,value],index)=><div className={styles.value} key={index}><dt><Text text={String(label)}/></dt><dd>{String(value)}</dd></div>)}</dl>
  <p className={styles.meta}><Text text="Recorded by"/> {financialHistoryText(record.actor_name,"POS")} · {time(record)}</p>
 </div>;
}

function FocusFallback({context,claimed}:{context:ContextValue;claimed:boolean}){
 const target=context.changes.find(change=>change.id===context.focusedEventId)??context.record;
 if(!context.focusedEventId||claimed)return null;
 if(context.loading)return <p role="status" className={styles.unavailable}><Text text="Loading this record…"/></p>;
 if(context.error||!target)return <p role="status" className={styles.unavailable}><Text text={context.error||"This record is unavailable in this view."}/><button type="button" className={styles.retry} onClick={context.retry}><Text text="Retry"/></button></p>;
 const ticket=financialHistoryText(target.ticket_number??target.after_values.ticket_number),staff=financialHistoryText(target.staff_snapshot?.displayName);
 const name=target.source_table==="ticket"?`Ticket${ticket?` ${ticket}`:""}`:target.source_table==="daily_report"?"Daily Report":target.source_table==="staff_day"?staff||"Staff daily inputs":target.source_table.includes("setting")?"Pay settings":target.source_table==="payroll_period_staff_inputs"?"Period inputs":"Recorded input";
 const edited=financialHistoryForObject([target]).length>0;
 return <details open className={`${styles.fallback} ${edited?styles.editedRow:""}`} data-focused-input-object={target.source_id}>
  <summary>{name} · {target.period_start}{target.period_end!==target.period_start?` – ${target.period_end}`:""}</summary>
  <div className={styles.fallbackBody}>{edited?<Entries changes={[target]} focusedEventId={context.focusedEventId}/>:<InlineFinancialRecord record={target} claimFocus={false}/>}</div>
 </details>;
}

export function FinancialHistoryProvider({salonId,surface,start,end,scope="",refreshKey,initialChanges,readChanges,query:routeQuery,children}:{salonId:string;surface:"today"|"reports"|"payroll";start?:string;end?:string;scope?:string;refreshKey?:unknown;initialChanges?:readonly PayrollLiveChange[];readChanges?:InlineFinancialHistoryReader;query?:string;children:ReactNode}){
 const params=useSearchParams(),rawFocus=(routeQuery===undefined?params:new URLSearchParams(routeQuery))?.get("inputEvent")?.toLowerCase(),focusedEventId=rawFocus&&uuid.test(rawFocus)?rawFocus:undefined;
 const key=JSON.stringify([salonId,surface,start,end,scope,refreshKey]);
 const [base,setBase]=useState<Result>({key:"",changes:[],loading:initialChanges===undefined,error:""}),[focus,setFocus]=useState<Result>({key:"",changes:[],loading:false,error:""});
 const [attempt,setAttempt]=useState(0),[claims,setClaims]=useState<Record<string,string[]>>({});
 const claim=useCallback((id:string,consumer:string)=>{setClaims(previous=>previous[id]?.includes(consumer)?previous:{...previous,[id]:[...previous[id]??[],consumer]});return()=>setClaims(previous=>({...previous,[id]:previous[id]?.filter(item=>item!==consumer)??[]}));},[]);
 const retry=useCallback(()=>setAttempt(n=>n+1),[]);
 const args=useMemo(()=>{const result=new URLSearchParams({surface});if(salonId)result.set("salonId",salonId);if(start)result.set("start",start);if(end)result.set("end",end);return result.toString();},[salonId,surface,start,end]);
 const seed=useMemo<Result|undefined>(()=>initialChanges!==undefined&&attempt===0?{key,changes:initialChanges.filter(row=>!salonId||row.salon_id===salonId),loading:false,error:""}:undefined,[initialChanges,attempt,key,salonId]);
 useEffect(()=>{
  const controller=new AbortController();let version=0;
  if(seed)return;
  async function load(){const current=++version;setBase(previous=>({key,changes:previous.key===key?previous.changes:[],loading:true,error:""}));try{
   const response=readChanges?undefined:await fetch(`/api/financial-input-history?${args}`,{credentials:"same-origin",cache:"no-store",signal:controller.signal}),data=readChanges?await readChanges():await response!.json();
   if((response&&!response.ok)||!Array.isArray(data.rows))throw new Error();
   if(!controller.signal.aborted&&version===current)setBase({key,changes:data.rows.filter((row:PayrollLiveChange)=>!salonId||row.salon_id===salonId),loading:false,error:""});
  }catch{if(!controller.signal.aborted&&version===current)setBase({key,changes:[],loading:false,error:"History could not be loaded. Please retry."});}}
  void load();const refresh=()=>{if(document.visibilityState==="visible")void load();};window.addEventListener("financial-input-saved",refresh);window.addEventListener("focus",refresh);
  return()=>{controller.abort();window.removeEventListener("financial-input-saved",refresh);window.removeEventListener("focus",refresh);};
 },[args,key,salonId,seed,attempt,readChanges]);
 const current=seed??(base.key===key?base:undefined),focusKey=JSON.stringify([key,focusedEventId]);
 const focusInBase=Boolean(focusedEventId&&current?.changes.some(row=>row.id===focusedEventId));
 useEffect(()=>{
  if(!focusedEventId||current?.loading||!current)return;
  if(focusInBase)return;
  const controller=new AbortController();
  void (async()=>{await Promise.resolve();if(controller.signal.aborted)return;setFocus({key:focusKey,changes:[],loading:true,error:""});try{const response=readChanges?undefined:await fetch(`/api/financial-input-history?${args}&inputEvent=${focusedEventId}`,{credentials:"same-origin",cache:"no-store",signal:controller.signal}),data=readChanges?await readChanges(focusedEventId):await response!.json();
   if((response&&!response.ok)||!Array.isArray(data.rows))throw new Error(response?.status===404?"This record is unavailable in this view.":"This record could not be loaded. Please retry.");
   const rows=(data.rows as PayrollLiveChange[]).filter(row=>row.id===focusedEventId&&(!salonId||row.salon_id===salonId));
   const record=data.record?.id===focusedEventId&&(!salonId||data.record.salon_id===salonId)?data.record as PayrollLiveChange:undefined;
   if(!controller.signal.aborted)setFocus({key:focusKey,changes:rows,record,loading:false,error:""});
  }catch(error){if(!controller.signal.aborted)setFocus({key:focusKey,changes:[],loading:false,error:error instanceof Error?error.message:"This record could not be loaded."});}})();
  return()=>controller.abort();
 },[args,current,focusInBase,focusKey,focusedEventId,salonId,attempt,readChanges]);
 const focused=useMemo(()=>focusInBase?{key:focusKey,changes:[],loading:false,error:""}:focus.key===focusKey?focus:undefined,[focusInBase,focusKey,focus]);
 const merged=useMemo(()=>{const rows=new Map((current?.changes??[]).map(row=>[row.id,row]));for(const row of focused?.changes??[])rows.set(row.id,row);return [...rows.values()];},[current?.changes,focused?.changes]);
 const value=useMemo<ContextValue>(()=>({changes:merged,record:focused?.record,focusedEventId,loading:!current||current.loading||Boolean(focused?.loading)||Boolean(focusedEventId&&!focused),error:focused?.error||current?.error||"",retry,claim}),[merged,focused,current,focusedEventId,retry,claim]);
 const claimed=Boolean(focusedEventId&&claims[focusedEventId]?.length);
 return <Context.Provider value={value}>{children}<FocusFallback context={value} claimed={claimed}/></Context.Provider>;
}
