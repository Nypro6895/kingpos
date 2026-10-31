"use client";
import {useEffect,useRef,useState} from "react";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {describeFinancialInputChange,financialHistoryText,hasMeaningfulFinancialInputChange,type FinancialChangeDetail} from "@/lib/financial-change-presentation";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import styles from "./financial-input-history.module.css";

function Chevron(){return <svg className={styles.chevron} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
function ChangeValues({details}:{details:FinancialChangeDetail[]}){return <dl>{details.map((detail,index)=><div className={styles.value} key={`${detail.label}:${index}`}><dt><Text text={detail.label}/></dt><dd><Text text={detail.before}/> <span aria-hidden="true">→</span> <Text text={detail.after}/></dd></div>)}</dl>;}
export function PayrollChangeHistory({changes,staffNames={},title="Input change history",compact=false,focusedEventId}:{changes:PayrollLiveChange[];staffNames?:Record<string,string>;title?:string;compact?:boolean;focusedEventId?:string}){
 const [visible,setVisible]=useState(10);
 const disclosure=useRef<HTMLDetailsElement>(null),entries=useRef(new Map<string,HTMLDetailsElement>());
 const previousFocus=useRef<{id:string;wasOpen:boolean}|null>(null);
 const filtered=changes.filter(hasMeaningfulFinancialInputChange);
 const targetIndex=focusedEventId?filtered.findIndex(change=>change.id===focusedEventId):-1;
 const shown=Math.max(visible,targetIndex+1);
 useEffect(()=>{
  const reveal=()=>{
   const outer=disclosure.current,target=focusedEventId?entries.current.get(focusedEventId):undefined;
   if(previousFocus.current&&previousFocus.current.id!==focusedEventId){const previous=entries.current.get(previousFocus.current.id);if(previous&&!previousFocus.current.wasOpen)previous.open=false;previousFocus.current=null;}
   if(target&&focusedEventId){if(previousFocus.current?.id!==focusedEventId)previousFocus.current={id:focusedEventId,wasOpen:target.open};if(outer)outer.open=true;target.open=true;target.scrollIntoView({block:"nearest"});return;}
   if(location.hash==="#input-history"&&outer?.closest("#input-history")){outer.open=true;outer.scrollIntoView({block:"nearest"});}
  };
  reveal();window.addEventListener("hashchange",reveal);return()=>window.removeEventListener("hashchange",reveal);
 },[compact,filtered.length,focusedEventId,shown]);
 if(!filtered.length)return null;
 const contents=<><p className={styles.hint}><Text text="These records explain changes to inputs and settings; they do not add another amount."/></p>
  <ol className={styles.list}>{filtered.slice(0,shown).map(change=>{
   const presentation=describeFinancialInputChange(change);
   const name=change.staff_id?financialHistoryText(staffNames[change.staff_id]??change.staff_snapshot?.displayName):[...new Set(change.staff_projections?.map(p=>financialHistoryText(p.staff_name)).filter(Boolean))].join(", ");
   const actor=financialHistoryText(change.actor_name,change.actor_id?"Owner":"System");
   return <li key={change.id}><details ref={element=>{if(element)entries.current.set(change.id,element);else entries.current.delete(change.id);}} className={styles.entry} data-focused={focusedEventId===change.id||undefined}>
    <summary><span className={styles.summaryText}><span className={styles.summaryHeading}><strong><Text text={presentation.title}/></strong>{name&&<span> · {name}</span>}</span><span className={styles.changeText}><Text text={presentation.summary}/></span><time dateTime={change.created_at}>{new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:change.business_timezone??"UTC"}).format(new Date(change.created_at))}</time></span><Chevron/></summary>
    <div className={styles.detailBody}><p className={styles.meta}><Text text="Business date"/> {change.period_start}{change.period_end!==change.period_start&&change.period_end!=="9999-12-31"?` – ${change.period_end}`:""} · <Text text="Edited by"/> {actor}</p>
     <ChangeValues details={presentation.details}/>
     {presentation.groups.length>0&&<div className={styles.projections}>{presentation.groups.map((group,index)=><section key={`${group.title}:${index}`} aria-label={`${group.title} input changes`}><h3>{group.title}</h3><ChangeValues details={group.details}/></section>)}</div>}
     {presentation.incomplete&&<p className={styles.hint}><Text text="Only the values preserved in this record can be shown."/></p>}
     {change.note&&<div className={styles.reason}><h3><Text text="Reason / note"/></h3><p className={styles.note}>{change.note}</p></div>}
     {(change.source_table.startsWith("pos_")||change.source_table==="staff_payroll_settings")&&<p className={styles.hint}><Text text="Earlier source values are preserved. Historical take-home impact is not inferred."/></p>}
    </div>
   </details></li>;
  })}</ol>{shown<filtered.length&&<button type="button" className={styles.more} onClick={()=>setVisible(shown+10)}><Text text="Show more changes"/></button>}</>;
 return compact?<details ref={disclosure} className={styles.section}><summary className={styles.sectionSummary}><span><Text text={title}/> · {filtered.length}</span><Chevron/></summary>{contents}</details>:<section className={styles.section}><h2><Text text={title}/></h2>{contents}</section>;
}
