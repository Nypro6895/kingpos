import { completePayrollDailyIncome,PAYROLL_ADDITIVE_FIELDS,type PayrollLineLedger } from "@/lib/payroll-ledger";
import { payrollCents } from "@/lib/payroll-money";
import type { PayrollStaffLineWithDailyTotals } from "@/types/payroll";

export type PayrollReportLine=PayrollStaffLineWithDailyTotals & {
  sourcePeriod:{start:string;end:string};
  reportState:"closed"|"adjusted"|"open_estimate";
};

/** Period bonus and later adjustments belong to the original period's last day.
 * Daily fixed pay retains the original period divisor. No current settings are read. */
export function slicePayrollReportLine(full:PayrollStaffLineWithDailyTotals,source:{start:string;end:string},range:{start:string;end:string}):PayrollReportLine {
  if(!full.dailyIncome)throw new Error("Verified daily payroll allocation is unavailable for this period.");
  const originalDays=full.dailyIncome.filter(d=>d.businessDate>=range.start&&d.businessDate<=range.end);
  const line=structuredClone(full) as PayrollReportLine;
  completePayrollDailyIncome(line,source.end);
  line.dailyIncome=line.dailyIncome!.filter(d=>d.businessDate>=range.start&&d.businessDate<=range.end);
  line.dailyTotals=line.dailyTotals.filter(d=>d.business_date>=range.start&&d.business_date<=range.end);
  for(const key of PAYROLL_ADDITIVE_FIELDS)line[key]=line.dailyIncome.reduce((n,d)=>n+payrollCents(d[key]??0),0)/100;
  line.sourcePeriod=source;
  line.reportState=full.ledger?(full.ledger.adjusted?"adjusted":"closed"):"open_estimate";
  if(line.ledger){
    const originalIncome=originalDays.reduce((n,d)=>n+payrollCents(d.final_staff_income),0)/100;
    const original={...line.ledger.original};
    for(const key of ['final_cash_amount','final_check_amount','tax_withheld','tax_company_taxable_gross','tax_company_cash_amount'] as const)
      original[key]=originalDays.reduce((n,d)=>n+payrollCents(d[key]),0)/100;
    const includesSettlement=source.end>=range.start&&source.end<=range.end;
    const complete=range.start<=source.start&&range.end>=source.end;
    line.ledger={...line.ledger,original,originalIncome,delta:(payrollCents(line.final_staff_income)-payrollCents(originalIncome))/100,
      paid:complete?line.ledger.paid:null,balance:complete?line.ledger.balance:null,paymentScope:complete?"complete_periods":"partial_range",
      adjustments:includesSettlement?line.ledger.adjustments:[],adjusted:includesSettlement&&line.ledger.adjusted};
  }
  return line;
}

/** The screen has one staff row; exports retain separate source-period rows. */
export function groupPayrollReportLines(parts:PayrollReportLine[]):PayrollStaffLineWithDailyTotals[] {
  const grouped=new Map<string,PayrollStaffLineWithDailyTotals>();
  for(const part of parts){
    const existing=grouped.get(part.staff_id);
    if(!existing){grouped.set(part.staff_id,structuredClone(part));continue;}
    for(const key of PAYROLL_ADDITIVE_FIELDS)existing[key]=(payrollCents(existing[key]??0)+payrollCents(part[key]??0))/100;
    existing.dailyIncome=[...(existing.dailyIncome??[]),...(part.dailyIncome??[])];existing.dailyTotals.push(...part.dailyTotals);
    existing.staff_display_name_snapshot=part.staff_display_name_snapshot;existing.staff_legal_name_snapshot=part.staff_legal_name_snapshot;
    existing.is_mixed_rate=true;existing.paystub=null;existing.input=null;
    if(existing.ledger&&part.ledger){
      const a=existing.ledger,b=part.ledger;
      const original={...b.original};
      for(const key of ['final_cash_amount','final_check_amount','tax_withheld','tax_company_taxable_gross','tax_company_cash_amount'] as const)original[key]=(payrollCents(a.original[key])+payrollCents(b.original[key]))/100;
      const periods=[...new Map([...(a.paymentPeriods??[]),...(b.paymentPeriods??[])].map(p=>[p.baseId,p])).values()],partial=a.paymentScope==='partial_range'||b.paymentScope==='partial_range';
      const payments=[...new Map([...a.payments,...b.payments].map(p=>[p.id,p])).values()];
      existing.ledger={original,originalIncome:(payrollCents(a.originalIncome)+payrollCents(b.originalIncome))/100,delta:(payrollCents(a.delta)+payrollCents(b.delta))/100,adjusted:a.adjusted||b.adjusted,adjustments:[...new Map([...a.adjustments,...b.adjustments].map(x=>[x.id,x])).values()],payments,paid:partial?null:periods.reduce((n,p)=>n+payrollCents(p.paid),0)/100,balance:partial?null:periods.reduce((n,p)=>n+payrollCents(p.balance),0)/100,paymentScope:partial?'partial_range':'complete_periods',paymentPeriods:periods} satisfies PayrollLineLedger;
    }else existing.ledger=undefined; // Open estimates must never acquire an Original label.
  }
  return [...grouped.values()];
}
