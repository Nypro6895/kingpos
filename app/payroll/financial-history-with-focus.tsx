"use client";
import {useSearchParams} from "next/navigation";
import type {ComponentProps} from "react";
import {PayrollChangeHistory} from "./payroll-change-history";
import {FinancialInputHistoryPanel} from "./financial-input-history-panel";

// Notification dates can predate available periods or refer to a future setting.
// Show that authorized event separately; never change the selected payroll totals.
export function FinancialHistoryWithFocus({salonId,scope,historyQuery,...props}:ComponentProps<typeof PayrollChangeHistory>&{salonId:string;scope?:string;historyQuery?:string}){
 const nextQuery=useSearchParams(),query=historyQuery!==undefined?new URLSearchParams(historyQuery):nextQuery,eventId=query?.get("inputEvent")?.toLowerCase();
 const outsidePeriod=Boolean(eventId&&!props.changes.some(change=>change.id===eventId));
 return <div id="input-history">
  {outsidePeriod&&<FinancialInputHistoryPanel salonId={salonId} scope={scope} historyQuery={historyQuery} surface="payroll" focusOnly anchorId="notification-history"/>}
  <PayrollChangeHistory {...props} focusedEventId={eventId}/>
 </div>;
}
