import {moneyCents} from "./payroll-live-money";
import type {PayrollRecordedFacts} from "@/types/payroll-records";

type Input={facts:PayrollRecordedFacts;staffId:string;currentIncome:number;period:{startDate:string;endDate:string}};
export function comparePayrollPayments({facts,staffId,currentIncome,period}:Input){
 const unknown=(reason:string)=>({state:"unknown" as const,currentIncome,reason});
 if(facts.status!=="available")return unknown("Recorded payment history is unavailable.");
 if(!facts.selection?.exact||facts.selection.start!==period.startDate||facts.selection.end!==period.endDate)return unknown("Choose the complete original pay period to compare recorded payments.");
 if(facts.periods.some(row=>{
  const start=row.sourcePeriod?.start??row.base?.periodStart,end=row.sourcePeriod?.end??row.base?.periodEnd;
  return start&&end&&(start!==period.startDate||end!==period.endDate)&&start<=period.endDate&&end>=period.startDate&&row.payments.some(payment=>payment.staff_id===staffId);
 }))return unknown("Recorded payments belong to a different overlapping source period. Review that original pay period; payments are not prorated.");
 const exact=facts.periods.filter(row=>(row.sourcePeriod?.start??row.base?.periodStart)===period.startDate&&(row.sourcePeriod?.end??row.base?.periodEnd)===period.endDate);
 if(exact.length!==1)return unknown("The original pay period is not fully covered by payment records.");
 const source=exact[0],seen=new Map<string,string>();let cash=0,check=0;
 try{
  for(const payment of source.payments){
   if(payment.staff_id!==staffId)continue;
   const signature=JSON.stringify([payment.staff_id,payment.cash_amount,payment.check_amount,payment.paid_at]);
   if(seen.has(payment.id)){if(seen.get(payment.id)!==signature)return unknown("Recorded payment history needs review.");continue;}
   seen.set(payment.id,signature);cash+=moneyCents(payment.cash_amount);check+=moneyCents(payment.check_amount);
  }
  if(!Number.isSafeInteger(cash)||!Number.isSafeInteger(check))return unknown("Recorded payment history needs review.");
  return {state:"known" as const,currentIncome:moneyCents(currentIncome)/100,recordedPaid:(cash+check)/100,cashPaid:cash/100,checkPaid:check/100,balance:(moneyCents(currentIncome)-cash-check)/100,revision:source.revision,sourcePeriod:{start:period.startDate,end:period.endDate}};
 }catch{return unknown("Recorded payment history needs review.");}
}
