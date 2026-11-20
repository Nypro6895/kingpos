import type { ReactNode } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { staffPayrollRowDisplay, staffTakeHomeDisplay } from "@/lib/staff-payroll-display";
import type { PayrollStaffLineWithDailyTotals } from "@/types/payroll";
import { StaffPayrollDetails } from "./staff-payroll-details";
import { StaffPaymentTable } from "./staff-payment-table";
import styles from "./payroll-mobile.module.css";

const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
function RuleText({ parts }: { parts: string[] }) {
  return <>{parts.map((part, i) => <span key={`${i}:${part}`}>{i > 0 && " "}<WorkspaceText text={part} /></span>)}</>;
}

export function StaffIncomeCard({ line, adjustments, history, breakdown }: {
  line: PayrollStaffLineWithDailyTotals; adjustments?: ReactNode; history?: ReactNode; breakdown?: ReactNode;
}) {
  const payout = staffTakeHomeDisplay(line), row = staffPayrollRowDisplay(line);
  return <StaffPayrollDetails name={line.staff_display_name_snapshot} header={<div className={styles.compactStaffSummary}>
    <div className={styles.compactPayoutRow}>
      <strong className={styles.compactStaffName}>{line.staff_display_name_snapshot}</strong>
      {([['Check', payout.check], ['Cash', payout.cash]] as const).map(([label, value]) => <div key={label} className={styles.compactPayout}>
        <span className={styles.compactPayoutValue}><WorkspaceText text={label} />: <strong className={value < 0 ? styles.negativePayout : undefined}>{money(value)}</strong></span>
      </div>)}
    </div>
    {(!line.staff_legal_name_snapshot || line.final_check_amount < 0) && <div className={styles.compactWarnings}>
      {!line.staff_legal_name_snapshot && <small className="text-amber-700"><WorkspaceText text="Missing legal name" /></small>}
      {line.final_check_amount < 0 && <small className="text-rose-700"><WorkspaceText text="Check amount negative" /></small>}
    </div>}
  </div>}>
    <div className={styles.takeHomeBody}>
      <div className={styles.compactRules}>{row.settings.map((parts, i) => <span key={i}><RuleText parts={parts} /></span>)}</div>
      <div className={styles.paymentTotals}><span><WorkspaceText text="Services" /> <strong>{money(line.gross_sales)}</strong></span><span><WorkspaceText text="Take-home" /> <strong>{money(payout.net)}</strong></span></div>
      <p className={styles.commissionTotal}>{row.settings.filter(parts => parts[0] === "Commission" || parts[0] === "Fixed pay").map((parts, i) => <span key={i}>{i > 0 && " / "}<RuleText parts={parts} /></span>)} → <strong>{money(line.staff_commission_gross)}</strong></p>
      {adjustments ?? <StaffPaymentTable line={line} />}
      {breakdown}
      <p className={styles.compactIncludedNote}><WorkspaceText text="Check and Cash total the net amounts paid via each method. Tip and Bonus are already included." /></p>
      {history}
    </div>
  </StaffPayrollDetails>;
}
