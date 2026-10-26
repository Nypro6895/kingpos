import { moneyCents } from "./payroll-live-money";
import type { PayrollStaffLineWithDailyTotals } from "@/types/payroll";

export const incomeFields = ["gross_sales","staff_commission_gross","shop_share","base_check_amount","base_cash_amount","cash_amount","check_gross","check_net","tip_amount","tip_check_amount","tip_cash_amount","bonus_amount","bonus_check_amount","bonus_cash_amount","earned_amount","final_check_amount","final_cash_amount","final_staff_income","fixed_pay_amount_used","tax_withheld","tax_company_reported_wage_gross","tax_company_taxable_gross","tax_company_check_amount","tax_company_cash_amount"] as const;
export type LiveIncomeDay = { businessDate: string; amounts: Partial<Record<typeof incomeFields[number],number>> };

/** Period extras settle on their source period's end date, never the end of an
 * arbitrary download range. A sliced range therefore cannot duplicate a bonus. */
export function completeLiveIncomeDays(line:PayrollStaffLineWithDailyTotals, days:LiveIncomeDay[], end:string):LiveIncomeDay[] {
  const result=days.map(day=>({...day,amounts:{...day.amounts}}));
  let settlement=result.find(day=>day.businessDate===end);
  if(!settlement){settlement={businessDate:end,amounts:{}};result.push(settlement);}
  for(const field of incomeFields){
    const difference=moneyCents(line[field])-result.reduce((sum,day)=>sum+moneyCents(day.amounts[field]??0),0);
    settlement.amounts[field]=(moneyCents(settlement.amounts[field]??0)+difference)/100;
  }
  return result.sort((a,b)=>a.businessDate.localeCompare(b.businessDate));
}
