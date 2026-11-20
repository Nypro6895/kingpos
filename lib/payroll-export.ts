import type { PayrollReportLine } from "@/lib/payroll-range";
import type { PayrollStaffLineWithDailyTotals,PayrollShopDailyRow } from "@/types/payroll";
import {payrollCents} from "@/lib/payroll-money";
type Cell=string|number|null;
export const PAYROLL_INCOME_COLUMNS=["Staff ID","Staff","Source period start","Source period end","Report status","Original income","Adjusted","Income adjustment","Final income","Final cash income","Final check income","Tax withheld","Reported gross","Cash reported","Adjustment reasons","Adjusted at (UTC)","Owner IDs"];
export function payrollIncomeExport(lines:PayrollStaffLineWithDailyTotals[],period:{start:string;end:string},state:string):Cell[][] {
  return lines.map(line=>{
    const report=line as Partial<PayrollReportLine>,source=report.sourcePeriod??period,ledger=line.ledger;
    const status=report.reportState??(ledger?(ledger.adjusted?'adjusted':'closed'):state==='open'?'open_estimate':'legacy_review');
    return [line.staff_id,line.staff_display_name_snapshot,source.start,source.end,status,ledger?.originalIncome??null,ledger?.adjusted?'Yes':'No',ledger?.delta??0,line.final_staff_income,line.final_cash_amount,line.final_check_amount,line.tax_withheld,line.tax_company_taxable_gross,line.tax_company_cash_amount,ledger?.adjustments.map(a=>a.reason).join(' | ')??'',ledger?.adjustments.map(a=>a.created_at).join(' | ')??'',ledger?.adjustments.map(a=>a.actor_id).join(' | ')??''];
  });
}
export const PAYROLL_ADJUSTMENT_COLUMNS=["Adjustment ID","Original period ID","Staff ID","Staff","Source period start","Source period end","Revision","Adjusted at (UTC)","Owner ID","Reason","Income delta","Previous cash income","Final cash income","Previous check income","Final check income","Previous tax","Final tax","Previous reported gross","Final reported gross","Previous cash reported","Final cash reported","Previous legal name","Final legal name","Previous check number","Final check number"];
export function payrollAdjustmentExport(lines:PayrollStaffLineWithDailyTotals[],period:{start:string;end:string}):Cell[][] {
  const seen=new Set<string>();return lines.flatMap(line=>{
    const source=(line as Partial<PayrollReportLine>).sourcePeriod??period;
    return (line.ledger?.adjustments??[]).flatMap(a=>{if(seen.has(a.id))return [];seen.add(a.id);const before=a.before_values,after=a.after_values;
      return [[a.id,a.base_id,line.staff_id,line.staff_display_name_snapshot,source.start,source.end,a.revision,a.created_at,a.actor_id,a.reason,a.delta_amount,before.final_cash_amount,after.final_cash_amount,before.final_check_amount,after.final_check_amount,before.tax_withheld,after.tax_withheld,before.tax_company_taxable_gross,after.tax_company_taxable_gross,before.tax_company_cash_amount,after.tax_company_cash_amount,before.staff_legal_name_snapshot,after.staff_legal_name_snapshot,before.check_number,after.check_number]];
    });
  });
}
// These are whole payment transactions associated with the source pay periods.
// A partial income range must never prorate an actual payment or imply it occurred
// inside that date range. Paid-at and source-period columns make both dates clear.
export const PAYROLL_PAYMENT_COLUMNS=["Payment ID","Staff ID","Staff","Source period start","Source period end","Payment scope","Cash paid","Check paid","Total paid","Paid at (UTC)","Recorded at (UTC)","Owner ID","Income revision at payment","Note"];
export function payrollPaymentExport(lines:PayrollStaffLineWithDailyTotals[],period:{start:string;end:string}):Cell[][]{
  const seen=new Set<string>();return lines.flatMap(line=>{
    const source=(line as Partial<PayrollReportLine>).sourcePeriod??period;
    return (line.ledger?.payments??[]).flatMap(payment=>{
      if(seen.has(payment.id))return [];seen.add(payment.id);
      return [[payment.id,line.staff_id,line.staff_display_name_snapshot,source.start,source.end,"Whole payment associated with source pay period; not filtered by payment date",payment.cash_amount,payment.check_amount,(payrollCents(payment.cash_amount)+payrollCents(payment.check_amount))/100,payment.paid_at,payment.recorded_at,payment.actor_id,payment.revision_at_payment,payment.note]];
    });
  });
}
export const PAYROLL_FINANCIAL_COLUMNS=["Date","Source period start","Source period end","Report status","POS income","Actual income","Cash","Card","Other","Over / short","Original staff net pay","Staff net adjustment","Final staff net pay","Original tax withheld","Tax adjustment","Final tax withheld","Original staff obligation","Obligation adjustment","Final staff obligation","Original shop net income","Shop net adjustment","Final shop net income"];
export function payrollFinancialExport(rows:PayrollShopDailyRow[]):Cell[][]{
  return rows.map(row=>{const record=row.payrollRecord;return [row.businessDate,record?.sourcePeriod.start??null,record?.sourcePeriod.end??null,record?.state??"open_estimate",row.posIncome,row.actualIncome,row.cashAmount,row.creditCardAmount,row.otherAmount,row.difference,record?.originalStaffNetPay??null,record?.netAdjustment??0,row.staffNetPay,record?.originalTaxWithheld??null,record?.taxAdjustment??0,row.taxWithheld,record?.originalStaffObligation??null,record?.obligationAdjustment??0,row.staffObligation,record?.originalShopNetIncome??null,record?.shopNetAdjustment??0,row.shopNetIncome];});
}
