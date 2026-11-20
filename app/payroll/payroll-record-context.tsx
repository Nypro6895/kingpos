"use client";

import Link from "next/link";
import { WorkspaceText as Text } from "@/components/workspace-language";
import { FinancialHistoryProvider, useFinancialHistoryContext } from "./inline-financial-history";
import { financialHistoryText } from "@/lib/financial-change-presentation";
import { payrollRecordContextHref } from "@/lib/payroll-history-navigation";
import { payrollPeriodHref } from "@/lib/payroll-period-rail";
import type { PayrollPeriod } from "@/types/payroll";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import styles from "./payroll-mobile.module.css";

function RecordContextLinks({period,canViewAllPayroll}:{period:PayrollPeriod;canViewAllPayroll:boolean}) {
  const context = useFinancialHistoryContext();
  const record = context.changes.find(row => row.id === context.focusedEventId) ?? context.record;
  const ticket = record && financialHistoryText(record.ticket_number ?? record.after_values.ticket_number);
  const staff = record && financialHistoryText(record.staff_snapshot?.displayName);
  const title = !record ? "Saved record" : record.source_table === "ticket" ? `Ticket${ticket ? ` ${ticket}` : ""}` : ["daily_report","pos_daily_closings"].includes(record.source_table) ? "Daily Report" : record.source_table.includes("setting") ? "Pay settings" : record.source_table === "staff_day" ? `${staff || "Staff"} · Daily inputs` : record.source_table === "payroll_period_staff_inputs" ? `${staff || "Staff"} · Period inputs` : "Saved record";
  // A record loaded outside this period may not have a row in the current view.
  // Its captured object remains here; only tickets have an independent day route.
  const href = record?.source_table === "ticket" && payrollRecordContextHref(record, period);
  return <header className="grid gap-2">
    <h2 className="text-base font-semibold"><Text text={title}/></h2>
    <div className="flex flex-wrap gap-3 text-sm">
      {href && <Link className={styles.action} href={href}><Text text="Open ticket in Today"/></Link>}
      <Link className={styles.action} href={payrollPeriodHref(period,canViewAllPayroll ? "overview" : "staff")}><Text text={canViewAllPayroll ? "Back to overview" : "Back to staff payroll"}/></Link>
    </div>
  </header>;
}

/** Compatibility for an exact old link: one authorized object, never a history list. */
export function PayrollRecordContext({salonId,period,history,query,scope,canViewAllPayroll}:{salonId:string;period:PayrollPeriod;history:readonly PayrollLiveChange[];query:string;scope:string;canViewAllPayroll:boolean}) {
  return <section id="input-history" className={styles.panel} aria-label="Saved record context">
    <FinancialHistoryProvider salonId={salonId} surface="payroll" start={period.startDate} end={period.endDate} initialChanges={history} query={query} scope={scope}>
      <RecordContextLinks period={period} canViewAllPayroll={canViewAllPayroll}/>
    </FinancialHistoryProvider>
  </section>;
}
