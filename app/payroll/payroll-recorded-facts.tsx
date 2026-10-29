"use client";
import type {PayrollRecordedFacts} from "@/types/payroll-records";
import {PayrollExportButton} from "./payroll-export-button";
import {recordedPayrollRows,RECORDED_PAYMENT_COLUMNS,RECORDED_ADJUSTMENT_COLUMNS} from "@/lib/payroll-recorded-export";
import {WorkspaceText as Text} from "@/components/workspace-language";
export function PayrollRecordedFactsPanel({facts,staffNames={},showExports=true}:{facts:PayrollRecordedFacts;staffNames?:Record<string,string>;showExports?:boolean}){
 const rows=recordedPayrollRows(facts);
 return <section className="border-y border-zinc-200 py-3 text-sm" aria-label="Live calculation and recorded payments">
  <p><Text text="Payroll amounts update from current source data. Change history records updates; calculated cash and check amounts are not confirmation of payment."/></p>
  {facts.status==="unavailable"?<p role="status" className="mt-2"><Text text={facts.message}/></p>:rows&&<details className="mt-2"><summary className="min-h-11 cursor-pointer py-3"><Text text="Recorded payments and adjustment evidence"/></summary>
   <p><Text text="These original records remain separate from live calculations. Whole payments retain their original source period and payment date."/></p>
   {showExports&&<div className="my-3 flex flex-wrap gap-3"><PayrollExportButton filename="payroll-recorded-payments.csv" columns={RECORDED_PAYMENT_COLUMNS} rows={rows.payments}/><PayrollExportButton filename="payroll-recorded-adjustments.csv" columns={RECORDED_ADJUSTMENT_COLUMNS} rows={rows.adjustments}/></div>}
   <p><Text text={`${rows.payments.length} recorded payments; ${rows.adjustments.length} recorded adjustments`}/></p>
   <ul className="mt-3 space-y-3">{rows.payments.map(row=><li key={String(row[0])} className="border-t border-zinc-200 pt-3">
    <strong>{staffNames[String(row[1])]??String(row[1])}</strong><p>{new Date(String(row[7])).toLocaleString("en-US",{timeZone:"UTC"})} UTC</p>
    <p><Text text="Recorded cash"/> ${Number(row[5]).toFixed(2)} · <Text text="Recorded check"/> ${Number(row[6]).toFixed(2)}</p>
    <p className="whitespace-pre-wrap">{String(row[10]??"")}</p>
   </li>)}</ul>
   {facts.periods.some(p=>p.legacyPaidHistory?.length)&&<p><Text text="Earlier statements were marked paid. Those flags remain evidence and are not imported as cash payments."/></p>}
  </details>}
 </section>;
}
