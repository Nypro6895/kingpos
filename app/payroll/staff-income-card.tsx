import type { ReactNode } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { staffCompactSettings, staffTakeHomeDisplay } from "@/lib/staff-payroll-display";
import type { PayrollStaffLineWithDailyTotals } from "@/types/payroll";
import { PayrollDisclosure } from "./payroll-disclosure";
import styles from "./payroll-mobile.module.css";

const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
export function StaffIncomeCard({ line, adjustments, history, breakdown }: {
  line: PayrollStaffLineWithDailyTotals; adjustments?: ReactNode; history?: ReactNode; breakdown?: ReactNode;
}) {
  const payout = staffTakeHomeDisplay(line), settings = staffCompactSettings(line);
  return <PayrollDisclosure expandOnDesktop={false} className={`${styles.staffCard} ${styles.takeHomeCard}`} summary={<div className={styles.staffSummary}>
    <div className={styles.staffIdentity}><strong>{line.staff_display_name_snapshot}</strong>{!line.staff_legal_name_snapshot && <small className="!text-amber-700"><WorkspaceText text="Missing legal name" /></small>}{line.final_check_amount < 0 && <small className="!text-rose-700"><WorkspaceText text="Check amount negative" /></small>}</div>
    <div className={`${styles.takeHomeMoney} ${[payout.check, payout.cash, payout.tip].some(value => money(value).length > 9) ? styles.longPayout : ""}`}>{([['Check', payout.check], ['Cash', payout.cash], ['Tip', payout.tip]] as const).map(([label, value]) => <div key={label}><small><WorkspaceText text={label} /></small><strong className={value < 0 ? "text-rose-700" : undefined}>{money(value)}</strong></div>)}</div>
  </div>}>
    <div className={styles.takeHomeBody}>
      <dl className={styles.earningsTotals}><div><dt><WorkspaceText text="Gross" /></dt><dd>{money(line.gross_sales)}</dd><small><WorkspaceText text="Service sales" /></small></div><div><dt><WorkspaceText text="Net" /></dt><dd>{money(payout.net)}</dd><small><WorkspaceText text="Total take-home" /></small></div></dl>
      <dl className={styles.ledger}><div><dt><WorkspaceText text="Total tip · before tax" /></dt><dd>{money(line.tip_amount)}</dd></div>{!adjustments && <div><dt><WorkspaceText text="Bonus" /></dt><dd>{money(line.bonus_amount)}</dd></div>}</dl>
      {adjustments}
      <div className={styles.staffSettings} aria-label="Settings applied to this period">
        <span><WorkspaceText text={settings.fixed ? "Fixed pay" : "Commission"} /> <b>{settings.pay.join(" / ")}</b></span>
        <span><WorkspaceText text="Cash" /> <b>{settings.cash.join(" / ")}</b></span>
        <span><WorkspaceText text="Tax" /> <b>{settings.tax.join(" / ")}</b></span>
        <span><WorkspaceText text="Tip" /> <b>{settings.tip.map(t => <WorkspaceText key={t} text={t} />).reduce<ReactNode[]>((out, node, i) => [...out, ...(i ? [" / "] : []), node], [])}</b></span>
      </div>
      {history}
      {breakdown}
    </div>
  </PayrollDisclosure>;
}
