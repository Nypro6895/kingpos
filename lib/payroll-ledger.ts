import { payrollCents } from "@/lib/payroll-money";
import type { PayrollStaffLineWithDailyTotals, PayrollShopDailyRow } from "@/types/payroll";

export type PayrollAdjustmentValues=Pick<PayrollStaffLineWithDailyTotals,
  "final_cash_amount"|"final_check_amount"|"tax_withheld"|"tax_company_taxable_gross"|"tax_company_cash_amount"|"staff_legal_name_snapshot"|"check_number">;
export type PayrollAdjustment = {
  id:string;base_id:string;staff_id:string;revision:number;request_id:string;actor_id:string;reason:string;
  before_values:PayrollAdjustmentValues;after_values:PayrollAdjustmentValues;delta_amount:number;created_at:string;
};
export type PayrollRecordedPayment={id:string;staff_id:string;request_id:string;cash_amount:number;check_amount:number;paid_at:string;recorded_at:string;note:string;actor_id:string;revision_at_payment:number};
export type PayrollLedger={
  state:"open"|"closed"|"processing"|"legacy_review"|"schedule_review"|"range";
  canAdjust:boolean;revision:number;configurationIssue?:string|null;
  base:{id:string;periodStart:string;periodEnd:string;cycleType:string;createdAt:string;engineVersion:string}|null;
  lines:PayrollStaffLineWithDailyTotals[];adjustments:PayrollAdjustment[];payments:PayrollRecordedPayment[];
  legacyPaidHistory?:Array<{runId:string;version:number;paidAt:string|null}>;
  shopDailyRows?:PayrollShopDailyRow[];
};
export type PayrollPaymentPeriod={baseId:string;start:string;end:string;finalIncome:number;paid:number;balance:number};
export type PayrollLineLedger={original:PayrollAdjustmentValues;originalIncome:number;delta:number;adjusted:boolean;adjustments:PayrollAdjustment[];payments:PayrollRecordedPayment[];paid:number|null;balance:number|null;paymentScope?:"complete_periods"|"partial_range";paymentPeriods?:PayrollPaymentPeriod[]};
export const PAYROLL_ADDITIVE_FIELDS=["gross_sales","staff_commission_gross","shop_share","base_check_amount","base_cash_amount","cash_amount","check_gross","tax_withheld","check_net","tip_amount","tip_check_amount","tip_cash_amount","bonus_amount","bonus_check_amount","bonus_cash_amount","earned_amount","final_check_amount","final_cash_amount","final_staff_income","tax_company_reported_wage_gross","tax_company_taxable_gross","tax_company_check_amount","tax_company_cash_amount","fixed_pay_amount_used"] as const;
export type PayrollDailyIncome={businessDate:string}&Record<(typeof PAYROLL_ADDITIVE_FIELDS)[number],number>;
export function completePayrollDailyIncome(line:PayrollStaffLineWithDailyTotals,endDate:string) {
  const daily=line.dailyIncome??[];
  let last=daily.find(d=>d.businessDate===endDate);
  if(!last){last=Object.fromEntries([['businessDate',endDate],...PAYROLL_ADDITIVE_FIELDS.map(k=>[k,0])]) as PayrollDailyIncome;daily.push(last);}
  for(const key of PAYROLL_ADDITIVE_FIELDS)last[key]=(payrollCents(last[key])+payrollCents(line[key]??0)-daily.reduce((n,d)=>n+payrollCents(d[key]??0),0))/100;
  line.dailyIncome=daily.sort((a,b)=>a.businessDate.localeCompare(b.businessDate));
}
export function payrollAdjustmentValues(line:PayrollStaffLineWithDailyTotals):PayrollAdjustmentValues {
  return {final_cash_amount:line.final_cash_amount,final_check_amount:line.final_check_amount,tax_withheld:line.tax_withheld,tax_company_taxable_gross:line.tax_company_taxable_gross,tax_company_cash_amount:line.tax_company_cash_amount,staff_legal_name_snapshot:line.staff_legal_name_snapshot,check_number:line.check_number};
}
export function projectPayrollLedger(ledger:PayrollLedger):Array<PayrollStaffLineWithDailyTotals & {ledger:PayrollLineLedger}> {
  return ledger.lines.map(base=>{
    const adjustments=ledger.adjustments.filter(a=>a.staff_id===base.staff_id).sort((a,b)=>a.revision-b.revision);
    const payments=ledger.payments.filter(p=>p.staff_id===base.staff_id);
    const values=adjustments.at(-1)?.after_values??payrollAdjustmentValues(base);
    const finalIncome=(payrollCents(values.final_cash_amount)+payrollCents(values.final_check_amount))/100;
    const originalIncome=(payrollCents(base.final_cash_amount)+payrollCents(base.final_check_amount))/100;
    const paid=payments.reduce((sum,p)=>sum+payrollCents(p.cash_amount)+payrollCents(p.check_amount),0)/100;
    const taxDelta=(payrollCents(values.tax_withheld)-payrollCents(base.tax_withheld))/100;
    return {...base,...values,input:base.input??null,inputHistory:base.inputHistory??[],paystub:base.paystub??null,
      final_staff_income:finalIncome,cash_amount:values.final_cash_amount,
      tax_company_check_amount:values.final_check_amount,
      earned_amount:(payrollCents(base.earned_amount)+payrollCents(finalIncome)-payrollCents(originalIncome)+payrollCents(taxDelta))/100,
      ledger:{original:payrollAdjustmentValues(base),originalIncome,delta:(payrollCents(finalIncome)-payrollCents(originalIncome))/100,adjusted:adjustments.length>0,adjustments,payments,paid,balance:(payrollCents(finalIncome)-payrollCents(paid))/100,paymentScope:"complete_periods",paymentPeriods:ledger.base?[{baseId:ledger.base.id,start:ledger.base.periodStart,end:ledger.base.periodEnd,finalIncome,paid,balance:(payrollCents(finalIncome)-payrollCents(paid))/100}]:[]},
    };
  });
}

// Adjust the obligation in its original period. Never classify it as POS revenue
// or rewrite actual cash collected/paid. A tax change is part of gross obligation.
export function projectPayrollShopRows(rows:PayrollShopDailyRow[],ledger:PayrollLedger):PayrollShopDailyRow[] {
  if (!ledger.base) return rows;
  const lines=projectPayrollLedger(ledger);
  const net=lines.reduce((n,l)=>n+payrollCents(l.ledger.delta),0)/100;
  const tax=lines.reduce((n,l)=>n+payrollCents(l.tax_withheld)-payrollCents(l.ledger.original.tax_withheld),0)/100;
  return rows.map(row=>{const settles=row.businessDate===ledger.base!.periodEnd,n=settles?net:0,t=settles?tax:0,obligation=(payrollCents(n)+payrollCents(t))/100;return {...row,
    staffNetPay:(payrollCents(row.staffNetPay)+payrollCents(n))/100,
    staffObligation:(payrollCents(row.staffObligation)+payrollCents(obligation))/100,
    taxWithheld:(payrollCents(row.taxWithheld)+payrollCents(t))/100,
    shopShare:(payrollCents(row.shopShare)-payrollCents(obligation))/100,
    shopNetIncome:row.shopNetIncome===null?null:(payrollCents(row.shopNetIncome)-payrollCents(obligation))/100,
    payrollRecord:{state:settles&&lines.some(line=>line.ledger.adjusted)?"adjusted":"closed",sourcePeriod:{start:ledger.base!.periodStart,end:ledger.base!.periodEnd},originalStaffNetPay:row.staffNetPay,netAdjustment:n,originalTaxWithheld:row.taxWithheld,taxAdjustment:t,originalStaffObligation:row.staffObligation,obligationAdjustment:obligation,originalShopNetIncome:row.shopNetIncome,shopNetAdjustment:-obligation},
  };});
}
