"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { TaxPeriodOption } from "@/lib/tax-company-periods";
import styles from "./tax-company.module.css";

export function TaxPeriodPicker({ salonId, options, selected }: { salonId: string; options: TaxPeriodOption[]; selected: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = options.find(option => option.value === selected)!;
  const month = active.startDate.slice(0, 7);
  const months = [...new Set(options.map(option => option.startDate.slice(0, 7)))].sort().reverse();
  const periods = options.filter(option => option.startDate.startsWith(month));
  const navigate = (value: string) => startTransition(() => router.push(`/tax-company/${salonId}?period=${encodeURIComponent(value)}`, { scroll: false }));
  return <div className={styles.periodBar} aria-busy={pending}>
    <label className={styles.label}>Pay month<select className={styles.select} value={month} disabled={pending} onChange={event => {
      const candidates = options.filter(option => option.startDate.startsWith(event.target.value));
      const next = candidates.find(option => !option.historical && option.startDate.slice(8) === active.startDate.slice(8)) ?? candidates.find(option => !option.historical) ?? candidates[0];
      if (next) navigate(next.value);
    }}>{months.map(value => <option key={value} value={value}>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T12:00:00Z`))}</option>)}</select></label>
    {periods.length > 1 && <label className={styles.label}>Pay period<select className={styles.select} value={selected} disabled={pending} onChange={event => navigate(event.target.value)}>{periods.map(option => <option key={option.value} value={option.value}>{Number(option.startDate.slice(8))}–{Number(option.endDate.slice(8))}{option.startDate.slice(0, 7) !== option.endDate.slice(0, 7) ? ` (${option.endDate.slice(5)})` : ""}{option.historical ? " · Earlier schedule" : ""}</option>)}</select></label>}
    {pending && <span className={styles.muted} role="status">Loading payroll…</span>}
  </div>;
}
