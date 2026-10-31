"use client";
import type {ReactNode} from "react";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {InlineFinancialHistory,InlineFinancialRecord,inlineHistoryEditedClassName,useInlineFinancialHistory} from "@/app/payroll/inline-financial-history";

/** The disclosure belongs to the closing-input object, not to a separate log. */
export function DailyInputInlineHistory({businessDate,children}:{businessDate:string;children?:ReactNode}){
 const history=useInlineFinancialHistory({businessDate,sourceKinds:["daily_report","pos_daily_closings"]});
 return <details className={history.hasChanges?inlineHistoryEditedClassName:undefined} data-closing-input-date={businessDate}>
  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 py-2">
   <h2 className="text-lg font-semibold"><Text text="Closing Inputs"/></h2>
   {history.hasChanges?<span className="text-xs"><Text text="Edited"/> · {history.changes.length}</span>:<span aria-hidden="true">⌄</span>}
  </summary>
  <InlineFinancialHistory changes={history.changes}/>
  {history.record&&<InlineFinancialRecord record={history.record}/>}
  {history.loading&&<p role="status" className="py-2 text-xs"><Text text="Loading saved changes…"/></p>}
  {history.error&&<p role="status" className="py-2 text-xs"><Text text={history.error}/><button type="button" className="ml-2 min-h-11 underline" onClick={history.retry}><Text text="Retry"/></button></p>}
  {!history.loading&&!history.error&&!history.hasChanges&&!history.record&&!children&&<p className="py-2 text-xs"><Text text="No saved edits for this date."/></p>}
  {children}
 </details>;
}
