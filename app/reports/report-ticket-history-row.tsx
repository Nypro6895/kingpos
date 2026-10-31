"use client";
import type {ReactNode} from "react";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {InlineFinancialHistory,inlineHistoryEditedClassName,useInlineFinancialHistory} from "@/app/payroll/inline-financial-history";
export function ReportTicketHistoryRow({ticketId,children}:{ticketId:string;children:ReactNode}){
 const history=useInlineFinancialHistory({ticketId,sourceKinds:["ticket"]});
 return <details className={history.hasChanges?inlineHistoryEditedClassName:undefined} data-report-ticket={ticketId}>
  <summary className="grid min-h-11 cursor-pointer list-none grid-cols-12 gap-2 px-4 py-3 text-sm">{children}{history.hasChanges&&<span className="col-span-12 text-xs"><Text text="Edited"/> · {history.changes.length}</span>}</summary>
  <div className="min-w-0 px-4 pb-3"><InlineFinancialHistory changes={history.changes}/>{history.loading&&<p className="text-xs" role="status"><Text text="Loading saved changes…"/></p>}{history.error&&<p className="text-xs" role="status"><Text text={history.error}/><button type="button" className="ml-2 min-h-11 underline" onClick={history.retry}><Text text="Retry"/></button></p>}{!history.loading&&!history.error&&!history.hasChanges&&<p className="text-xs"><Text text="No saved edits for this ticket."/></p>}</div>
 </details>;
}
