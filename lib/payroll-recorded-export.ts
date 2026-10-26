import type { PayrollRecordedFacts } from "@/types/payroll-records";
type Cell=string|number|null;
export const RECORDED_PAYMENT_COLUMNS=["Payment ID","Staff ID","Source period start","Source period end","Payment scope","Cash paid","Check paid","Paid at (UTC)","Recorded at (UTC)","Owner ID","Note"];
export const RECORDED_ADJUSTMENT_COLUMNS=["Adjustment ID","Staff ID","Source period start","Source period end","Revision","Adjusted at (UTC)","Owner ID","Reason","Income delta","Original values","Adjusted values"];
export function recordedPayrollRows(facts:PayrollRecordedFacts):{payments:Cell[][];adjustments:Cell[][]}|null {
  if(facts.status!=="available")return null;
  const payments:Cell[][]=[],adjustments:Cell[][]=[],seenPayments=new Set<string>(),seenAdjustments=new Set<string>();
  for(const period of facts.periods){
    for(const p of period.payments){if(seenPayments.has(p.id))continue;seenPayments.add(p.id);payments.push([p.id,p.staff_id,period.base?.periodStart??null,period.base?.periodEnd??null,"Whole recorded payment; not prorated or filtered by paid-at date",p.cash_amount,p.check_amount,p.paid_at,p.recorded_at,p.actor_id,p.note]);}
    for(const a of period.adjustments){if(seenAdjustments.has(a.id))continue;seenAdjustments.add(a.id);adjustments.push([a.id,a.staff_id,period.base?.periodStart??null,period.base?.periodEnd??null,a.revision,a.created_at,a.actor_id,a.reason,a.delta_amount,JSON.stringify(a.before_values),JSON.stringify(a.after_values)]);}
  }
  return{payments,adjustments};
}
