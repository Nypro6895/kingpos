import "server-only";
import {getCurrentBusinessContext,isSalonManageContext,isOwnerMembership} from "@/lib/current-context";
import {hasPermission} from "@/lib/permissions";
import {createAuthenticatedSupabaseServerClient} from "@/lib/supabase/server";
import {PayrollWriteError,payrollWriteFailure} from "@/lib/payroll-write-result";
import type {PayrollLedger,PayrollAdjustmentValues} from "@/lib/payroll-ledger";
import type {PayrollRecordedFacts} from "@/types/payroll-records";
async function requirePayrollManageContext(){
 const context=await getCurrentBusinessContext();
 if(!context.user||!isSalonManageContext(context)||!context.currentAccount||!context.currentSalon||!isOwnerMembership(context.currentMembership)||!await hasPermission("payroll.manage",context))throw new Error("You do not have permission to manage payroll.");
 const supabase=await createAuthenticatedSupabaseServerClient();if(!supabase)throw new Error("Please sign in again.");
 return{context,user:context.user,salon:context.currentSalon,supabase};
}
// Select-only audit sidecar: never replaces or freezes the live calculation.
export async function loadPayrollRecordedFacts(supabase:NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>,salonId:string,start:string,end:string):Promise<PayrollRecordedFacts>{
 try {
  const {data,error}=await supabase.rpc("read_payroll_range_ledgers",{p_salon:salonId,p_start:start,p_end:end}).abortSignal(AbortSignal.timeout(8000));
  if(error||!data||!Array.isArray(data.periods))throw new Error("Records unavailable");
  const periods=data.periods.map((p:PayrollLedger)=>({base:p.base,revision:p.revision,adjustments:p.adjustments,payments:p.payments,legacyPaidHistory:p.legacyPaidHistory??[]}));
  return{status:"available",periods};
 }catch{return{status:"unavailable",message:"Recorded payment and adjustment history is unavailable. Live amounts are current calculations, not confirmation of payment."};}
}
export async function createOwnerPayrollAdjustment(input:{baseId:string;staffId:string;revision:number;requestId:string;expectedScope:string;values:PayrollAdjustmentValues;reason:string}) {
  const auth=await requirePayrollManageContext();
  if(input.expectedScope!==`${auth.salon.id}:${auth.user.id}`)throw new Error("The salon or account changed. Reopen payroll before recording this request.");
  try {
    const {data,error}=await auth.supabase.rpc("create_payroll_owner_adjustment",{p_base:input.baseId,p_staff:input.staffId,p_expected_revision:input.revision,p_request:input.requestId,p_values:input.values,p_reason:input.reason}).abortSignal(AbortSignal.timeout(12000));
    if(error)throw payrollWriteFailure(error);return data;
  } catch(error) { if(error instanceof PayrollWriteError)throw error;throw new PayrollWriteError("The adjustment result is not confirmed. Check the saved record before retrying.",true); }
}
export async function recordOwnerPayrollPayment(input:{baseId:string;staffId:string;revision:number;requestId:string;expectedScope:string;cash:number;check:number;paidAt:string;note:string}) {
  const auth=await requirePayrollManageContext();
  if(input.expectedScope!==`${auth.salon.id}:${auth.user.id}`)throw new Error("The salon or account changed. Reopen payroll before recording this request.");
  try {
    const {data,error}=await auth.supabase.rpc("record_payroll_payment",{p_base:input.baseId,p_staff:input.staffId,p_expected_revision:input.revision,p_request:input.requestId,p_cash:input.cash,p_check:input.check,p_paid_at:input.paidAt,p_note:input.note}).abortSignal(AbortSignal.timeout(12000));
    if(error)throw payrollWriteFailure(error);return data;
  } catch(error) { if(error instanceof PayrollWriteError)throw error;throw new PayrollWriteError("The payment result is not confirmed. Check the saved record before retrying.",true); }
}
export async function verifyOwnerPayrollRequest(input:{baseId:string;staffId:string;requestId:string;expectedScope:string;kind:"adjust"|"payment";start:string;end:string;expected:{values:PayrollAdjustmentValues;reason:string}|{cash:number;check:number;paidAt:string;note:string}}) {
  const auth=await requirePayrollManageContext();
  if(input.expectedScope!==`${auth.salon.id}:${auth.user.id}`)throw new Error("The salon or account changed. Reopen payroll before checking this request.");
  const {data,error}=await auth.supabase.rpc("read_payroll_period_ledger",{p_salon:auth.salon.id,p_start:input.start,p_end:input.end}).abortSignal(AbortSignal.timeout(8000));
  if(error)throw new Error("Unable to check the saved payroll result.");
  const ledger=data as PayrollLedger;
  if(ledger.base?.id!==input.baseId)throw new Error("Select the original payroll period before checking the result.");
  const expected=input.expected;
  const found='values' in expected
    ? ledger.adjustments.some(entry=>entry.request_id===input.requestId&&entry.staff_id===input.staffId&&entry.actor_id===auth.user.id&&entry.reason===expected.reason&&Object.entries(expected.values).every(([key,value])=>entry.after_values[key as keyof PayrollAdjustmentValues]===value))
    : ledger.payments.some(entry=>entry.request_id===input.requestId&&entry.staff_id===input.staffId&&entry.actor_id===auth.user.id&&entry.cash_amount===expected.cash&&entry.check_amount===expected.check&&Date.parse(entry.paid_at)===Date.parse(expected.paidAt)&&entry.note===expected.note);
  return {found,revision:ledger.revision};
}