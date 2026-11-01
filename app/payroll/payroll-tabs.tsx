import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";
import { payrollPeriodHref } from "@/lib/payroll-period-rail";
import type { PayrollPeriod } from "@/types/payroll";
import styles from "./payroll-mobile.module.css";

export function PayrollTabs({ activeTab, canViewAllPayroll, period, canReconcile = false }: { canReconcile?: boolean; activeTab: string; canViewAllPayroll: boolean; period: PayrollPeriod }) {
  const tabs = canViewAllPayroll ? ["overview", "analytics", "staff", "shop", ...(canReconcile ? ["gifts", "rewards", "discounts"] : []), "tools"] : ["staff"];
  return <nav className={styles.mobileNav} aria-label="Payroll sections">{tabs.map(tab => <Link key={tab} href={payrollPeriodHref(period, tab)} scroll={false} aria-current={activeTab === tab || tab === "overview" && activeTab === "differences" || tab === "tools" && ["settings", "tax", "download"].includes(activeTab) ? "page" : undefined}><WorkspaceText text={tab === "gifts" ? "Gift Cards" : tab[0].toUpperCase() + tab.slice(1)} /></Link>)}</nav>;
}
