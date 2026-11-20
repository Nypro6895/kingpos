"use server";
import { revalidatePath } from "next/cache";
import { createOwnerPayrollAdjustment,recordOwnerPayrollPayment,verifyOwnerPayrollRequest } from "@/lib/payroll-records";
import { parsePayrollMoney } from "@/lib/payroll-money";
import { PayrollWriteError } from "@/lib/payroll-write-result";

export type LedgerActionState={status:"idle"|"saved"|"error"|"unknown";message:string};
const text=(form:FormData,key:string)=>String(form.get(key)??"").trim();
function common(form:FormData) {
  const revision=Number(text(form,"revision"));
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error("Reload payroll before saving.");
  return {baseId:text(form,"base_id"),staffId:text(form,"staff_id"),revision,requestId:text(form,"request_id"),expectedScope:text(form,"expected_scope")};
}
function adjustmentValues(form:FormData){return {final_cash_amount:parsePayrollMoney(text(form,"final_cash_amount")),final_check_amount:parsePayrollMoney(text(form,"final_check_amount")),tax_withheld:parsePayrollMoney(text(form,"tax_withheld")),tax_company_taxable_gross:parsePayrollMoney(text(form,"tax_company_taxable_gross")),tax_company_cash_amount:parsePayrollMoney(text(form,"tax_company_cash_amount")),staff_legal_name_snapshot:text(form,"staff_legal_name_snapshot")||null,check_number:text(form,"check_number")||null};}
function refresh(){try { revalidatePath("/payroll");revalidatePath("/payroll/tax-company");revalidatePath("/staff/my-work"); } catch { /* An invalidation failure cannot undo a committed transaction. */ }}
export async function saveOwnerAdjustment(_state:LedgerActionState,form:FormData):Promise<LedgerActionState>{
  try{
    await createOwnerPayrollAdjustment({...common(form),reason:text(form,"reason"),values:adjustmentValues(form)});refresh();return {status:"saved",message:"Adjustment recorded. The original and adjustment history are preserved."};
  }catch(error){return {status:error instanceof PayrollWriteError&&error.outcomeUnknown?"unknown":"error",message:error instanceof Error?error.message:"Adjustment could not be recorded."};}
}
export async function saveRecordedPayment(_state:LedgerActionState,form:FormData):Promise<LedgerActionState>{
  try{
    const date=text(form,"paid_at");
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date))throw new Error("Choose the actual payment date and time.");
    await recordOwnerPayrollPayment({...common(form),period:{start:text(form,"period_start"),end:text(form,"period_end")},cash:parsePayrollMoney(text(form,"cash_amount")),check:parsePayrollMoney(text(form,"check_amount")),paidAt:date,note:text(form,"note")});
    refresh();return {status:"saved",message:"Actual payment recorded. No money was transferred."};
  }catch(error){return {status:error instanceof PayrollWriteError&&error.outcomeUnknown?"unknown":"error",message:error instanceof Error?error.message:"Payment could not be recorded."};}
}
export async function verifyPayrollIntent(form:FormData):Promise<LedgerActionState>{
  try {
    const input=common(form),kind=text(form,'kind');
    if(kind!=='adjust'&&kind!=='payment')throw new Error('Invalid payroll request.');
    const expected=kind==='adjust'?{values:adjustmentValues(form),reason:text(form,'reason')}:{cash:parsePayrollMoney(text(form,'cash_amount')),check:parsePayrollMoney(text(form,'check_amount')),paidAt:text(form,'paid_at'),note:text(form,'note')};
    const result=await verifyOwnerPayrollRequest({...input,kind,start:text(form,'period_start'),end:text(form,'period_end'),expected});
    if(result.found)return {status:'saved',message:'The saved payroll record is confirmed. Refresh payroll to view the latest amounts.'};
    return result.revision!==input.revision?{status:'error',message:'Payroll changed and this request was not recorded. Refresh and review the current period.'}:{status:'unknown',message:'No completed record is confirmed yet. Retry this same request safely or check again.'};
  } catch { return {status:'unknown',message:'Unable to check the saved payroll result. Keep this request and check again when connected.'}; }
}
