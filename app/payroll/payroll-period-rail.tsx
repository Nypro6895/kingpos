"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";
import { payrollPeriodHref, type PayrollRailChoice } from "@/lib/payroll-period-rail";
import type { PayrollPeriod } from "@/types/payroll";
import styles from "./payroll-mobile.module.css";

function ScrollRail({ children, label, selectedKey }: { children: ReactNode; label: string; selectedKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, scroll: 0, active: false, moved: false });
  useEffect(() => {
    const rail = ref.current;
    const selected = rail?.querySelector<HTMLElement>('[aria-current="date"]') ?? rail?.querySelector<HTMLElement>('[data-center="true"]');
    const center = () => { if (rail && selected) rail.scrollLeft = selected.offsetLeft - rail.offsetLeft - (rail.clientWidth - selected.offsetWidth) / 2; };
    center();
    const observer = new ResizeObserver(center);
    if (rail) observer.observe(rail);
    return () => observer.disconnect();
  }, [selectedKey]);
  return <div ref={ref} className={styles.scrollRail} role="group" aria-label={label}
    onPointerDown={event => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, active: true, moved: false };
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current.active) return;
      const delta = event.clientX - current.x;
      if (Math.abs(delta) > 6) current.moved = true;
      if (current.moved) { event.preventDefault(); event.currentTarget.scrollLeft = current.scroll - delta; }
    }}
    onPointerUp={() => { drag.current.active = false; }}
    onPointerLeave={() => { drag.current.active = false; }}
    onPointerCancel={() => { drag.current.active = false; }}
    onDragStart={event => event.preventDefault()}
    onClickCapture={event => { if (drag.current.moved) { event.preventDefault(); event.stopPropagation(); drag.current.moved = false; } }}
  >{children}</div>;
}

export function PayrollPeriodRail({ period, activeTab, months, periods, needsAnchor = false }: {
  period: PayrollPeriod; activeTab: string; months: PayrollRailChoice[]; periods: PayrollRailChoice[]; needsAnchor?: boolean;
}) {
  const key = `${period.startDate}:${period.endDate}`;
  const rail = (choices: PayrollRailChoice[], label: string) => <ScrollRail label={label} selectedKey={key}>
    {choices.map(choice => <Link key={choice.period.startDate} href={payrollPeriodHref(choice.period, activeTab)} scroll={false} prefetch={false}
      className={styles.periodChip} aria-current={period.startDate === choice.period.startDate && period.endDate === choice.period.endDate ? "date" : undefined}
      data-center={label === "Payroll months" && choice.period.startDate.slice(0, 7) === period.startDate.slice(0, 7) || undefined}>
      <span><WorkspaceText text={choice.title} /></span><small>{choice.subtitle}</small>
    </Link>)}
  </ScrollRail>;
  return <section className={styles.periodRails} aria-label="Payroll period">
    {rail(months, "Payroll months")}
    {periods.length > 0 && rail(periods, "Scheduled pay periods")}
    <p className={styles.periodCaption}>{period.label}</p>
    {needsAnchor && <p role="status" className={styles.context}><WorkspaceText text="Every-2-weeks payroll needs an anchor date. Update it in Settings." /></p>}
  </section>;
}
