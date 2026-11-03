"use client";
import { Fragment } from "react";
import type { StaffPayrollView } from "@/lib/staff-my-work-experience";
import { WorkspaceText as Text } from "@/components/workspace-language";
import { InlineFinancialHistory } from "@/app/payroll/inline-financial-history";
import { financialHistoryForObject } from "@/lib/inline-financial-history";
import styles from "./staff-pay-analysis.module.css";
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00Z`));
export function StaffPayrollDailyRows({ data }: { data: StaffPayrollView }) {
  const rows = [...data.dailyRows].sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  if (!rows.length) return <p className={styles.note}><Text text="No daily payroll entries yet." /></p>;
  return <table className={styles.table}><thead><tr><th scope="col"><Text text="Date" /></th><th scope="col"><Text text="Services" /></th><th scope="col"><Text text="Tip" /></th></tr></thead><tbody>{rows.map(row => {
    const changes = financialHistoryForObject(data.history ?? [], { staffId: data.line?.staff_id, businessDate: row.businessDate, sourceKinds: ["staff_day", "staff_day_financial_inputs"] });
    return <Fragment key={row.id}><tr><td>{date(row.businessDate)}</td><td><strong>{money(row.shopGross)}</strong></td><td>{money(row.tipAmount)}</td></tr>{changes.length > 0 && <tr><td colSpan={3}><InlineFinancialHistory changes={changes} /></td></tr>}</Fragment>;
  })}</tbody><tfoot><tr><td><strong><Text text="Total" /></strong></td><td><strong>{money(rows.reduce((sum, row) => sum + row.shopGross, 0))}</strong></td><td><strong>{money(rows.reduce((sum, row) => sum + row.tipAmount, 0))}</strong></td></tr></tfoot></table>;
}
