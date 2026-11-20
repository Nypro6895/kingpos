"use client";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {comparePayrollPayments} from "@/lib/payroll-payment-comparison";
import type {PayrollRecordedFacts} from "@/types/payroll-records";
import type {PayrollPeriod,PayrollStaffLineWithDailyTotals} from "@/types/payroll";
import {OwnerPayrollForm} from "./owner-payroll-form";

const money=(amount:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(amount);
export function PayrollPaymentComparison({facts,line,period,scope,canRecord=false,showPayments=false}:{facts:PayrollRecordedFacts;line:PayrollStaffLineWithDailyTotals;period:Pick<PayrollPeriod,"startDate"|"endDate">;scope?:string;canRecord?:boolean;showPayments?:boolean}){
 const comparison=comparePayrollPayments({facts,staffId:line.staff_id,currentIncome:line.final_staff_income,period});
 const exact=facts.status==="available"?facts.periods.find(row=>(row.sourcePeriod?.start??row.base?.periodStart)===period.startDate&&(row.sourcePeriod?.end??row.base?.periodEnd)===period.endDate):undefined;
 const payments=exact?.payments.filter(row=>row.staff_id===line.staff_id)??[];
 return <section className="min-w-0 border-t border-zinc-200 py-3 text-sm" aria-label="Current obligation and recorded payments">
  <h3 className="font-medium"><Text text="Pay and recorded payments"/></h3>
  <p className="mt-1 text-xs text-zinc-500">{period.startDate} – {period.endDate}</p>
  <dl className="mt-2 grid gap-2">
   <div className="flex justify-between gap-3"><dt><Text text="Current calculated pay"/></dt><dd>{money(line.final_staff_income)}</dd></div>
   <div className="flex justify-between gap-3"><dt><Text text="Actual recorded payments"/></dt><dd>{comparison.state==="known"?money(comparison.recordedPaid):"—"}</dd></div>
   <div className="flex justify-between gap-3 font-medium"><dt><Text text={comparison.state==="known"&&comparison.balance<0?"Recorded overpayment":"Amount still owed"}/></dt><dd>{comparison.state==="known"?money(Math.abs(comparison.balance)):"—"}</dd></div>
  </dl>
  <p className="mt-2 text-xs text-zinc-600"><Text text={comparison.state==="unknown"?comparison.reason:comparison.balance<0?"Recorded payments exceed current calculated pay. No refund or future deduction is created automatically.":comparison.balance>0?"This is the current calculated pay minus actual recorded payments. Record any later payment against this original period.":"Current calculated pay equals actual recorded payments. Earlier paid flags are not counted as payments."}/></p>
  {showPayments&&payments.length>0&&<details className="mt-2"><summary className="min-h-11 cursor-pointer py-3"><Text text="Recorded payments"/> · {payments.length}</summary><ul className="grid gap-3">{payments.map(payment=><li key={payment.id} className="border-t pt-2"><p>{new Date(payment.paid_at).toLocaleString("en-US",{timeZone:"UTC"})} UTC</p><p><Text text="Cash"/> {money(payment.cash_amount)} · <Text text="Check"/> {money(payment.check_amount)}</p><p className="whitespace-pre-wrap break-words">{payment.note}</p></li>)}</ul></details>}
  {canRecord&&scope&&comparison.state==="known"&&<details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 font-medium"><Text text="Record actual payment"/></summary><OwnerPayrollForm key={`${scope}:${line.staff_id}:${period.startDate}:${period.endDate}:${comparison.revision}`} scope={scope} baseId={exact?.base?.id??""} revision={comparison.revision} line={line} kind="payment" period={comparison.sourcePeriod}/></details>}
 </section>;
}
