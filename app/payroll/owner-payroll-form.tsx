"use client";
import {useRef} from "react";
import {usePayrollIntent} from "@/lib/payroll-intent-client";
import type {PayrollStaffLineWithDailyTotals} from "@/types/payroll";
import {saveOwnerAdjustment,saveRecordedPayment,verifyPayrollIntent} from "./ledger-actions";

const fieldStyle="mt-1 w-full rounded-md border border-zinc-300 bg-white p-2 text-zinc-950";
const buttonStyle="rounded border border-zinc-400 px-3 py-2 disabled:opacity-50";
const fields=[['final_cash_amount','Final cash income'],['final_check_amount','Final check income'],['tax_withheld','Tax withheld'],['tax_company_taxable_gross','Reported gross'],['tax_company_cash_amount','Cash reported']] as const;

export function OwnerPayrollForm({baseId,revision,line,kind,period,scope}:{baseId:string;revision:number;line:PayrollStaffLineWithDailyTotals;kind:"adjust"|"payment";period:{start:string;end:string};scope:string}){
 const formRef=useRef<HTMLFormElement>(null);
 const {state,pending,locked,submit,retry,verify}=usePayrollIntent({storageKey:`payroll-intent:${scope}:${period.start}:${period.end}:${baseId}:${line.staff_id}:${kind}`,formRef,send:data=>(kind==='adjust'?saveOwnerAdjustment:saveRecordedPayment)({status:'idle',message:''},data),verify:verifyPayrollIntent});
 return <form ref={formRef} className="mt-3 space-y-3" onSubmit={event=>{event.preventDefault();submit();}}>
  <fieldset disabled={locked} className="space-y-3 disabled:opacity-75">
   <input type="hidden" name="expected_scope" defaultValue={scope}/><input type="hidden" name="base_id" defaultValue={baseId}/><input type="hidden" name="staff_id" defaultValue={line.staff_id}/><input type="hidden" name="revision" defaultValue={revision}/>
   <input type="hidden" name="kind" defaultValue={kind}/><input type="hidden" name="period_start" defaultValue={period.start}/><input type="hidden" name="period_end" defaultValue={period.end}/>
   {kind==='adjust'?<>
    <p>Enter corrected final amounts. The original remains visible. A reason is required; the affected staff member can view this record.</p>
    <div className="grid gap-3 sm:grid-cols-2">{fields.map(([key,label])=><label key={key}>{label}<input name={key} type="number" step="0.01" required defaultValue={line[key]} className={fieldStyle}/></label>)}
     <label>Legal name<input name="staff_legal_name_snapshot" maxLength={200} defaultValue={line.staff_legal_name_snapshot??''} className={fieldStyle}/></label>
     <label>Check number<input name="check_number" maxLength={200} defaultValue={line.check_number??''} className={fieldStyle}/></label>
    </div>
    <label className="block">Reason<textarea name="reason" required minLength={3} maxLength={1000} className={fieldStyle}/></label>
   </>:<>
    <p>Record money already paid to this staff member for {period.start} – {period.end}, including a later supplemental payment. This does not transfer funds or change income.</p>
    <div className="grid gap-3 sm:grid-cols-2"><label>Cash paid<input name="cash_amount" type="number" min="0" step="0.01" required defaultValue="0" className={fieldStyle}/></label><label>Check paid<input name="check_amount" type="number" min="0" step="0.01" required defaultValue="0" className={fieldStyle}/></label></div>
    <label className="block">Payment date and time (your device timezone)<input name="paid_local" type="datetime-local" required onChange={event=>{const d=new Date(event.currentTarget.value);const target=formRef.current?.elements.namedItem('paid_at');if(target instanceof HTMLInputElement)target.value=Number.isNaN(d.getTime())?'':d.toISOString();}} className={fieldStyle}/></label>
    <input type="hidden" name="paid_at" defaultValue=""/>
    <label className="block">Payment note<textarea name="note" required minLength={3} maxLength={1000} className={fieldStyle}/></label>
   </>}
   <button disabled={locked} className="rounded bg-zinc-950 px-4 py-2 text-white disabled:opacity-50">{pending?'Recording...':kind==='adjust'?'Record adjustment':'Record actual payment'}</button>
  </fieldset>
  {state.message&&<p role="status" className={state.status==='error'?'text-red-700':state.status==='saved'?'text-green-800':'text-amber-900'}>{state.message}</p>}
  {state.status==='unknown'&&<div className="flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={verify} className={buttonStyle}>Check saved result</button><button type="button" disabled={pending} onClick={retry} className={buttonStyle}>Retry same request</button></div>}
  {state.status==='saved'&&<button type="button" onClick={()=>window.location.reload()} className={buttonStyle}>Refresh payroll</button>}
 </form>;
}
