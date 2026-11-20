"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";
import { payrollPeriodHref, type PayrollRailChoice } from "@/lib/payroll-period-rail";
import type { PayrollPeriod } from "@/types/payroll";
import { usePayrollEdits } from "./payroll-edit-boundary";
import styles from "./payroll-mobile.module.css";

export function PayrollPeriodRail({ period, activeTab, months, periods, needsAnchor = false }: {
  period: PayrollPeriod; activeTab: string; months: PayrollRailChoice[]; periods: PayrollRailChoice[]; needsAnchor?: boolean;
}) {
  const router = useRouter();
  const { blocked } = usePayrollEdits();
  const [notice, setNotice] = useState(false);
  const [open, setOpen] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const choices = periods.length ? periods : months;
  const previous = [...choices].reverse().find(choice => choice.period.endDate < period.startDate);
  const next = choices.find(choice => choice.period.startDate > period.endDate);
  const go = (choice: PayrollRailChoice | undefined) => {
    if (blocked) { setNotice(true); return; }
    if (choice) { setOpen(false); router.push(payrollPeriodHref(choice.period, activeTab), { scroll: false }); }
  };
  return <section className={styles.periodRails} aria-label="Payroll period">
    <div className={styles.compactPeriod}
      onPointerDown={event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        moved.current = false; drag.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={event => {
        const start = drag.current; drag.current = null;
        if (!start) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        moved.current = Math.abs(dx) > 12;
        if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? previous : next);
      }}
      onPointerCancel={() => { drag.current = null; moved.current = true; }}
      onClickCapture={event => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; } }}>
      <button type="button" aria-label="Previous pay period" disabled={!previous} onClick={() => go(previous)}>‹</button>
      <button type="button" aria-expanded={open} aria-controls="payroll-period-options" onClick={() => setOpen(value => !value)}>{period.label} <span aria-hidden="true">⌄</span></button>
      <button type="button" aria-label="Next pay period" disabled={!next} onClick={() => go(next)}>›</button>
    </div>
    {open && <div id="payroll-period-options" className={styles.periodOptions} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
      {choices.map(choice => <Link key={choice.period.startDate} href={payrollPeriodHref(choice.period, activeTab)} scroll={false} prefetch={false} onClick={() => setOpen(false)} aria-current={choice.period.startDate === period.startDate && choice.period.endDate === period.endDate ? "date" : undefined}>{choice.title} · {choice.subtitle}</Link>)}
      {periods.length > 0 && <details><summary><WorkspaceText text="Whole month" /></summary>{months.map(choice => <Link key={choice.period.startDate} href={payrollPeriodHref(choice.period, activeTab)} scroll={false} prefetch={false} onClick={() => setOpen(false)}>{choice.title} {choice.subtitle}</Link>)}</details>}
    </div>}
    {notice && blocked && <p role="alert" className={styles.context}><WorkspaceText text="Finish saving your edits before leaving or saving a statement." /></p>}
    {needsAnchor && <p role="status" className={styles.context}><WorkspaceText text="Every-2-weeks payroll needs an anchor date. Update it in Settings." /></p>}
  </section>;
}
