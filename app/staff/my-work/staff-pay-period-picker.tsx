"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import type { PayrollPeriodOption } from "@/types/payroll";
import styles from "./staff-pay-analysis.module.css";

export function StaffPayPeriodPicker({ options, selected, tab = "payroll" }: { options: PayrollPeriodOption[]; selected: string; tab?: "payroll" | "analysis" }) {
  const translate = useWorkspaceTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const dialogId = useId();
  const active = options.find(option => option.value === selected);
  const formatRange = (start: string, end: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).formatRange(new Date(`${start}T12:00:00Z`), new Date(`${end}T12:00:00Z`));
  const [chosenMonth, setChosenMonth] = useState(active?.startDate.slice(0, 7) ?? "");
  const months = [...new Set(options.map(option => option.startDate.slice(0, 7)))].sort().reverse();
  const periods = [...options].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const currentIndex = periods.findIndex(option => option.value === selected);
  const navigate = (value: string) => {
    if (pending || value === selected) return;
    dialog.current?.close();
    startTransition(() => router.push(`/staff/my-work?tab=${tab}&payPeriodStart=${encodeURIComponent(value)}`, { scroll: false }));
  };
  const step = (direction: number) => {
    if (currentIndex < 0) return;
    const next = periods[currentIndex + direction];
    if (next) navigate(next.value);
  };
  const open = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setChosenMonth(active?.startDate.slice(0, 7) ?? months[0] ?? "");
    dialog.current?.showModal();
  };
  return <div className={styles.payPicker} aria-busy={pending}>
    <button type="button" className={styles.periodTrigger} disabled={pending || !options.length} aria-haspopup="dialog" aria-controls={dialogId} aria-describedby={`${dialogId}-hint`} onClick={open}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        gesture.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { gesture.current = null; }}
      onPointerUp={event => {
        const start = gesture.current; gesture.current = null;
        if (!start) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          suppressClick.current = true;
          step(dx < 0 ? 1 : -1);
        } else if (Math.abs(dy) > 16) suppressClick.current = true;
      }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}>
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></svg>
      <span><strong><WorkspaceText text={active ? formatRange(active.startDate, active.endDate) : selected} /></strong><small><WorkspaceText text={pending ? "Loading…" : "Pay period"} /></small></span>
      <span aria-hidden="true">⌄</span>
    </button>
    <span id={`${dialogId}-hint`} className={styles.srOnly}><WorkspaceText text="Swipe left for the next period, right for the previous period. Tap to choose a month or pay period." /></span>
    <dialog ref={dialog} id={dialogId} className={styles.periodDialog} aria-labelledby={`${dialogId}-title`}>
      <div className={styles.dialogHeading}><h2 id={`${dialogId}-title`}><WorkspaceText text="Select pay period" /></h2><button type="button" onClick={() => dialog.current?.close()} aria-label={translate("Close")}>×</button></div>
      <label className={styles.monthChoice}><span className={styles.srOnly}><WorkspaceText text="Pay month" /></span><select value={chosenMonth} disabled={pending} onChange={event => setChosenMonth(event.target.value)}>
        {months.map(value => <option key={value} value={value}><WorkspaceText text={new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T12:00:00Z`))} /></option>)}
      </select></label>
      <div className={styles.periodChoices}>{periods.filter(option => option.startDate.startsWith(chosenMonth)).map(option => <button type="button" key={option.value} disabled={pending} aria-current={option.value === selected ? "date" : undefined} onClick={() => option.value === selected ? dialog.current?.close() : navigate(option.value)}><WorkspaceText text={option.label} /><span aria-hidden="true">{option.value === selected ? "✓" : "○"}</span></button>)}</div>
    </dialog>
  </div>;
}
