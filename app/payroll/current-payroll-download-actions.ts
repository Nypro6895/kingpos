"use server";
import { getCurrentStaffPayrollPortalData } from "@/lib/payroll";

export async function downloadMyCurrentPayroll(input:{periodStart:string;periodEnd:string;salonId:string;staffId:string}) {
  const data=await getCurrentStaffPayrollPortalData({payPeriodStart:`${input.periodStart}:${input.periodEnd}`});
  if(!data.staff||!data.period||!data.line)throw new Error("Current payroll is unavailable.");
  if(data.staff.id!==input.staffId||data.line.salon_id!==input.salonId||data.period.startDate!==input.periodStart||data.period.endDate!==input.periodEnd)throw new Error("The selected payroll changed. Reopen My Pay before downloading.");
  const line=data.line;
  const rows=[['Staff','Start','End','Service sales','Tips','Bonus','Cash payout','Check payout','Tax withheld','Take-home pay'],
    [line.staff_display_name_snapshot,data.period.startDate,data.period.endDate,line.gross_sales,line.tip_amount,line.bonus_amount,line.final_cash_amount,line.final_check_amount,line.tax_withheld,line.final_staff_income]];
  const csv="\uFEFF"+rows.map(row=>row.map(value=>{const text=String(value);return '"'+(typeof value==='string'&&/^\s*[=+@-]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';}).join(',')).join('\r\n');
  return {csv,name:`my-payroll-${data.period.startDate}-${data.period.endDate}.csv`};
}
