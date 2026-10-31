"use client";
import type {StaffPayrollView} from "@/lib/staff-my-work-experience";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {InlineFinancialHistory} from "@/app/payroll/inline-financial-history";
import {financialHistoryForObject} from "@/lib/inline-financial-history";
import styles from "@/app/payroll/payroll-object-history.module.css";
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
const date=(value:string)=>new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"short",day:"numeric"}).format(new Date(`${value}T12:00:00Z`));
export function StaffPayrollDailyRows({data}:{data:StaffPayrollView}){
 const rows=[...data.dailyRows].sort((a,b)=>b.businessDate.localeCompare(a.businessDate));
 if(!rows.length)return <p className={styles.note}><Text text="No daily payroll entries yet."/></p>;
 return <div><div className={styles.dayHeader}><span><Text text="Work date"/></span><span><Text text="Services"/></span><span><Text text="Tips"/></span></div>{rows.map(row=>{
  const changes=financialHistoryForObject(data.history??[],{staffId:data.line?.staff_id,businessDate:row.businessDate,sourceKinds:["staff_day","staff_day_financial_inputs"]});
  return <details key={row.id} className={`${styles.object} ${changes.length?styles.edited:""}`}><summary><span className={styles.dayCells}><span>{date(row.businessDate)}</span><strong>{money(row.shopGross)}</strong><strong>{money(row.tipAmount)}</strong></span>{changes.length>0&&<span className={styles.badge}><Text text="Daily inputs edited"/> · {changes.length}</span>}</summary><div className={styles.dayBody}><InlineFinancialHistory changes={changes}/><dl className={styles.metrics}><div><dt><Text text="Calculated service pay"/></dt><dd>{money(row.commissionGross)}</dd></div><div><dt><Text text="Tips"/></dt><dd>{money(row.tipAmount)}</dd></div></dl><p className={styles.note}><Text text="Before tax and period bonus."/></p></div></details>;
 })}</div>;
}
