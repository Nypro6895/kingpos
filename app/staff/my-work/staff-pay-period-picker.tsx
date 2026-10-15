"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { PayrollPeriodOption } from "@/types/payroll";
import styles from "./staff-pay-analysis.module.css";

export function StaffPayPeriodPicker({ options, selected, tab = "payroll" }: { options: PayrollPeriodOption[]; selected: string; tab?: "payroll" | "analysis" }) {
  const __vt = useWorkspaceTranslation();

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = options.find(option => option.value === selected);
  const month = active?.startDate.slice(0, 7) ?? "";
  const months = [...new Set(options.map(option => option.startDate.slice(0, 7)))].sort().reverse();
  const monthPeriods = options.filter(option => option.startDate.startsWith(month));
  const navigate = (value: string) => startTransition(() => router.push(`/staff/my-work?tab=${tab}&payPeriodStart=${encodeURIComponent(value)}`, { scroll: false }));
  return <div className={styles.payPicker} aria-busy={pending}>
    <label><span className={styles.srOnly}><WorkspaceText text="Month" /></span><select aria-label={__vt("Pay month")} value={month} disabled={pending} onChange={event => {
      const candidates = options.filter(option => option.startDate.startsWith(event.target.value));
      // Preserve first/second half when moving between months where possible.
      const next = candidates.find(option => option.startDate.slice(8) === active?.startDate.slice(8)) ?? candidates[0];
      if (next) navigate(next.value);
    }}>{months.map(value => <option key={value} value={value}><WorkspaceText text={new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T12:00:00Z`))} /></option>)}</select></label>
    {monthPeriods.length > 1 && <label><span className={styles.srOnly}><WorkspaceText text="Period" /></span><select aria-label={__vt("Pay period")} value={selected} disabled={pending} onChange={event => navigate(event.target.value)}>
      {monthPeriods.map(option => <option key={option.value} value={option.value}><WorkspaceText text={option.label} /></option>)}
    </select></label>}
    {pending && <span role="status"><WorkspaceText text="Loading…" /></span>}
  </div>;
}
