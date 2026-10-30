"use client";
import {useEffect,useRef,useState} from "react";
import {WorkspaceText as Text} from "@/components/workspace-language";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import styles from "./financial-input-history.module.css";
const fields:Record<string,string>={service_total:"Service sales",gross_sales:"Service sales",tip_amount:"Tips",tip_input:"Entered tips",discount_amount:"Customer discount",discount_value:"Discount",discount_type:"Discount type",cash_amount:"Cash",credit_card_amount:"Card",other_amount:"Other",bonus_amount:"Bonus",commission_rate:"Commission %",tax_rate:"Tax %",check_rate:"Check %",fixed_pay_amount:"Fixed pay",pay_type:"Pay type",effective_from:"Effective from",effective_to:"Effective to",tip_payout_method:"Tip payout",bonus_payout_method:"Bonus payout",tax_tips:"Tax tips",tax_bonus:"Tax bonus",apply_tax_to_fixed_pay:"Tax fixed pay",cash_to_tax_company:"Cash reported",tax_company_enabled:"Tax company",legal_name:"Legal name",check_number:"Check number",cycle_type:"Pay cycle",biweekly_anchor_date:"Anchor date",note:"Note",notes:"Ticket note",status:"Ticket status",entered:"Report entered",work_date:"Business date"};
const money=new Set(["service_total","gross_sales","tip_amount","tip_input","discount_amount","cash_amount","credit_card_amount","other_amount","bonus_amount","fixed_pay_amount"]);
function format(field:string,value:unknown){if(value===null||value===undefined||value==="")return "—";if(typeof value==="boolean")return value?"Yes":"No";if(money.has(field)&&Number.isFinite(Number(value)))return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(value));if(typeof value==="object")return "Updated";return String(value);}
function label(source:string){return ({ticket:"Ticket inputs",staff_day:"Staff daily inputs",daily_report:"Daily Report",payroll_settings:"Pay settings",pos_daily_closings:"Earlier Daily Report",pos_ticket_staff_earnings:"Earlier service / tip inputs",staff_payroll_settings:"Earlier pay settings",salon_payroll_settings:"Pay schedule",payroll_period_staff_inputs:"Payroll inputs"} as Record<string,string>)[source]??"Recorded inputs";}
function changedFields(before:Record<string,unknown>,after:Record<string,unknown>){return Object.keys(fields).filter(key=>JSON.stringify(before[key]??null)!==JSON.stringify(after[key]??null));}
function inputValues(before:Record<string,unknown>,after:Record<string,unknown>){return <dl>{changedFields(before,after).map(key=><div className={styles.value} key={key}><dt><Text text={fields[key]}/></dt><dd><Text text={format(key,before[key])}/> <span aria-hidden="true">→</span> <Text text={format(key,after[key])}/></dd></div>)}</dl>;}
function serviceLines(values:Record<string,unknown>){return Array.isArray(values.lines)?values.lines.flatMap((line:unknown)=>{
 if(!line||typeof line!=="object")return [];const row=line as Record<string,unknown>;
 return [{service:typeof row.service_name==="string"?row.service_name:"Service",staff:typeof row.staff_name==="string"?row.staff_name:"Staff",amount:row.service_total}];
}):[];}
export function PayrollChangeHistory({changes,staffNames={},title="Input change history",compact=false}:{changes:PayrollLiveChange[];staffNames?:Record<string,string>;title?:string;compact?:boolean}){
 const [visible,setVisible]=useState(10);
 const disclosure=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const reveal=()=>{const element=disclosure.current;if(location.hash!=="#input-history"||!element?.closest("#input-history"))return;element.open=true;element.scrollIntoView({block:"nearest"});};
  reveal();window.addEventListener("hashchange",reveal);return()=>window.removeEventListener("hashchange",reveal);
 },[compact,changes.length]);
 const contents=<><p className={styles.hint}><Text text="Recorded changes are already reflected in current inputs. History does not add another amount."/></p>
 {!changes.length&&<p className={styles.hint}><Text text="No recorded input changes in this period."/></p>}
 <ol className={styles.list}>{changes.slice(0,visible).map(change=>{
  const keys=changedFields(change.before_values,change.after_values);
  const projections=!change.staff_id?(change.staff_projections??[]).filter(projection=>changedFields(projection.before_values,projection.after_values).length && !(change.staff_projections?.length===1&&JSON.stringify(projection.before_values)===JSON.stringify(change.before_values)&&JSON.stringify(projection.after_values)===JSON.stringify(change.after_values))):[];
  const beforeLines=serviceLines(change.before_values),afterLines=serviceLines(change.after_values);
  const linesChanged=JSON.stringify(beforeLines)!==JSON.stringify(afterLines);
  const name=change.staff_id?(staffNames[change.staff_id]??change.staff_snapshot?.displayName):change.staff_projections?.map(p=>p.staff_name).join(", ");
  const ticket=change.after_values.ticket_number??change.before_values.ticket_number;
  return <li key={change.id}><details className={styles.entry}><summary><span><strong><Text text={label(change.source_table)}/></strong>{name&&<span> · {name}</span>}{typeof ticket==="string"||typeof ticket==="number"?<span> · <Text text="Ticket"/> {String(ticket)}</span>:null}</span><time dateTime={change.created_at}>{new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:change.business_timezone??"UTC"}).format(new Date(change.created_at))}</time></summary>
   <p className={styles.meta}><Text text="Business date"/> {change.period_start}{change.period_end!==change.period_start&&change.period_end!=="9999-12-31"?` – ${change.period_end}`:""} · <Text text={change.actor_name??(change.actor_id?"Owner":"System")}/></p>
   {inputValues(change.before_values,change.after_values)}
   {projections.length>0&&<div className={styles.projections}>{projections.map(projection=><section key={projection.staff_id} aria-label={`${projection.staff_name} input changes`}><h3>{projection.staff_name}</h3>{inputValues(projection.before_values,projection.after_values)}</section>)}</div>}
   {linesChanged&&<div className={styles.projections}>{[["Services before",beforeLines],["Services after",afterLines]].map(([heading,lines])=><section key={heading as string}><h3><Text text={heading as string}/></h3><ul>{(lines as ReturnType<typeof serviceLines>).map((line,index)=><li key={index}>{line.service} · {line.staff} · {format("service_total",line.amount)}</li>)}</ul></section>)}</div>}
   {!keys.length&&!projections.length&&!linesChanged&&<p className={styles.hint}><Text text={change.source_table.includes("setting")?"Pay settings updated.":"Ticket details or staff allocation changed."}/></p>}
   {change.note&&<p className={styles.note}>{change.note}</p>}
   {change.source_table.startsWith("pos_")&&<p className={styles.hint}><Text text="Earlier source values are preserved. Historical take-home impact is not inferred."/></p>}
  </details></li>;
 })}</ol>{visible<changes.length&&<button type="button" className={styles.more} onClick={()=>setVisible(n=>n+10)}><Text text="Show more changes"/></button>}</>;
 if(compact)return changes.length?<details ref={disclosure} className={styles.section}><summary><Text text={title}/> · {changes.length}</summary>{contents}</details>:null;
 return <section className={styles.section}><h2><Text text={title}/></h2>{contents}</section>;
}
