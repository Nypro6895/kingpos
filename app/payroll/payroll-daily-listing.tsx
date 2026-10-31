"use client";
import {WorkspaceText} from "@/components/workspace-language";
import {StaffDayFinancialEditor} from "./staff-day-financial-editor";
import {InlineFinancialHistory} from "./inline-financial-history";
import {financialHistoryForObject} from "@/lib/inline-financial-history";
import type {PayrollStaffDailyTotal} from "@/types/payroll";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import styles from "./payroll-object-history.module.css";
const money=(amount:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(amount);
const date=(value:string)=>new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"}).format(new Date(`${value}T12:00:00Z`));
export function PayrollDailyListing({rows,salonId,canManage=false,today,history=[]}:{rows:PayrollStaffDailyTotal[];salonId?:string;canManage?:boolean;today?:string;history?:PayrollLiveChange[]}){
 if(!rows.length)return <p className="text-sm text-zinc-500"><WorkspaceText text="No daily rows for this staff member."/></p>;
 return <div><div className={styles.dayHeader}><span><WorkspaceText text="Work date"/></span><span><WorkspaceText text="Services"/></span><span><WorkspaceText text="Tips"/></span></div><div>{rows.map(day=>{
  const changes=financialHistoryForObject(history,{staffId:day.staff_id,businessDate:day.business_date,sourceKinds:["staff_day","staff_day_financial_inputs","pos_ticket_staff_earnings","ticket"]});
  return <details className={`${styles.object} ${changes.length?styles.edited:""}`} key={day.id}>
   <summary><span className={styles.dayCells}><span>{date(day.business_date)}</span><strong>{money(day.gross_sales)}</strong><strong>{money(day.tip_amount)}</strong></span>{changes.length>0&&<span className={styles.badge}><WorkspaceText text="Edited"/> · {changes.length}</span>}</summary>
   <div className={styles.dayBody}><InlineFinancialHistory changes={changes}/>{canManage&&salonId&&today&&day.business_date<=today&&<StaffDayFinancialEditor salonId={salonId} staffId={day.staff_id} businessDate={day.business_date} serviceTotal={day.gross_sales} tipAmount={day.tip_amount}/>}</div>
  </details>;
 })}</div></div>;
}
