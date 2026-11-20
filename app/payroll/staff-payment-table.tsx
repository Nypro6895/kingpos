import type { ReactNode } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { staffPayrollPaymentRows } from "@/lib/staff-payroll-display";
import type { PayrollStaffLineWithDailyTotals } from "@/types/payroll";
import styles from "./payroll-mobile.module.css";
import { moneyCents } from "@/lib/payroll-live-money";

const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
export function StaffPaymentTable({ line, bonusInput, showTotal = false }: { line: PayrollStaffLineWithDailyTotals; bonusInput?: ReactNode; showTotal?: boolean }) {
  const rows = staffPayrollPaymentRows(line);
  return <table className={styles.paymentTable} aria-label="Staff payment calculation">
    <thead><tr>{["Item", "Gross", "Tax", "Net", "Paid via"].map(label => <th scope="col" key={label}><WorkspaceText text={label} /></th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.label}>
      <th scope="row"><WorkspaceText text={row.label} />{row.rate && <small>{row.rate}</small>}</th>
      <td>{row.label === "Bonus" && bonusInput ? bonusInput : money(row.gross)}</td>
      <td>{money(row.tax)}<small>{(row.taxRule[0] === "Tax" && row.taxRule.length > 1 ? row.taxRule.slice(1) : row.taxRule).map((part, i) => <span key={i}>{i > 0 && " "}<WorkspaceText text={part} /></span>)}</small></td>
      <td>{money(row.net)}</td>
      <td>{row.methods.map((method, i) => <span key={method}>{i > 0 && " / "}<WorkspaceText text={method} /></span>)}</td>
    </tr>)}</tbody>
    {showTotal && <tfoot><tr><th scope="row"><WorkspaceText text="Total" /></th><td>{money(rows.reduce((sum, row) => sum + moneyCents(row.gross), 0) / 100)}</td><td>{money(line.tax_withheld)}</td><td>{money(line.final_staff_income)}</td><td /></tr></tfoot>}
  </table>;
}
