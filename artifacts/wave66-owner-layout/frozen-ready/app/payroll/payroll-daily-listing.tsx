import { WorkspaceText } from "@/components/workspace-language";
import type { PayrollStaffDailyTotal } from "@/types/payroll";
import styles from "./payroll-mobile.module.css";
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
export function PayrollDailyListing({ rows }: { rows: PayrollStaffDailyTotal[] }) {
  return rows.length ? <table className={styles.dailyListing}><thead><tr><th><WorkspaceText text="Date" /></th><th><WorkspaceText text="Gross" /></th><th><WorkspaceText text="Tip" /></th></tr></thead><tbody>{rows.map(day => <tr key={day.id}><td>{date(day.business_date)}</td><td>{money(day.gross_sales)}</td><td>{money(day.tip_amount)}</td></tr>)}</tbody></table> : <p className="text-sm text-zinc-500"><WorkspaceText text="No daily rows for this staff member." /></p>;
}
