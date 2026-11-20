"use client";
import {FinancialInputHistoryPanel} from "@/app/payroll/financial-input-history-panel";
export function DailyReportChangeHistory({salonId,reportDate,savedAt}:{salonId:string;reportDate:string;savedAt:unknown}){
 return <FinancialInputHistoryPanel salonId={salonId} surface="reports" start={reportDate} end={reportDate} refreshKey={savedAt} title="Daily input history"/>;
}
