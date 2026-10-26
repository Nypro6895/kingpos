"use client";
import { useState } from "react";
import Link from "next/link";
import { WorkspaceText as Text } from "@/components/workspace-language";
import { payrollHistoryStaffLabel } from "@/lib/payroll-live-history-presentation";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import styles from "./payroll-dashboard.module.css";

const labels: Record<string, string> = {
  cash_amount: "Cash", credit_card_amount: "Card", other_amount: "Other", note: "Note", bonus_amount: "Bonus", check_number: "Check number",
  pay_type: "Pay type", commission_rate: "Commission %", fixed_pay_amount: "Fixed pay", check_rate: "Check %", tax_rate: "Tax %",
  apply_tax_to_fixed_pay: "Tax fixed pay", tax_tips: "Tax tips", tax_bonus: "Tax bonus", tip_payout_method: "Tip payout", bonus_payout_method: "Bonus payout",
  cash_to_tax_company: "Cash reported", tax_company_enabled: "Tax company", legal_name: "Legal name", effective_from: "Effective from", effective_to: "Effective to",
  service_total: "Service sales", tip_amount: "Tips", work_date: "Business date",
  cycle_type: "Pay cycle", biweekly_anchor_date: "Anchor date",
  live_report_entered_at: "Report entered",
};
function value(field: string, input: unknown) {
  if (input === null || input === undefined) return "—";
  if (typeof input === "boolean") return input ? "Yes" : "No";
  if (typeof input === "number" && !field.endsWith("rate")) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(input);
  return String(input);
}

export function PayrollChangeHistory({ changes, staffNames = {}, title = "Change history", compact = false }: {
  changes: PayrollLiveChange[]; staffNames?: Record<string, string>; title?: string; compact?: boolean;
}) {
  const [visible, setVisible] = useState(20);
  const contents = <>
    <p className={styles.note}><Text text="Current amounts already include these changes. History does not add another charge." /></p>
    {!changes.length && <p className={styles.note}><Text text="No recorded changes in this period." /></p>}
    {changes.slice(0, visible).map(change => <details className={styles.day} key={change.id} id={`change-${change.id}`}>
      <summary><Text text="Updated" /> · {new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }).format(new Date(change.created_at))}{payrollHistoryStaffLabel(change, staffNames) ? ` · ${payrollHistoryStaffLabel(change, staffNames)}` : ""}</summary>
      <p className={styles.note}>{change.period_start}{change.period_end !== change.period_start && change.period_end !== "9999-12-31" ? ` – ${change.period_end}` : ""} · <Text text={change.source_table === "pos_daily_closings" ? "Daily Report" : change.source_table === "staff_payroll_settings" ? "Pay settings" : change.source_table === "pos_ticket_staff_earnings" ? "Service / tip" : "Payroll input"} /></p>
      <dl>{[...new Set([...Object.keys(change.before_values), ...Object.keys(change.after_values)])].filter(field => JSON.stringify(change.before_values[field]) !== JSON.stringify(change.after_values[field])).map(field => <div className={styles.row} key={field}><dt><Text text={labels[field] ?? field} /></dt><dd><Text text={value(field, change.before_values[field])} /> → <Text text={value(field, change.after_values[field])} /></dd></div>)}</dl>
      <p className={styles.note}><Text text="Changed by" />: <Text text={change.actor_id ? "Owner" : "System"} /></p>
      {change.source_table === "pos_daily_closings" && !compact && <Link className={styles.textLink} href={`/reports?date=${change.period_start}#daily-closing`}><Text text="Open Daily Report" /> ›</Link>}
    </details>)}
    {visible < changes.length && <button className={styles.textLink} onClick={() => setVisible(count => count + 20)}><Text text="Show more changes" /> ›</button>}
  </>;
  return compact ? <details className={`${styles.card} ${styles.history}`}><summary><Text text="Updated" /> · {changes.length} · <Text text={title} /></summary>{contents}</details> : <section className={`${styles.card} ${styles.history}`}><h2><Text text={title} /></h2><div className={styles.dayList}>{contents}</div></section>;
}
