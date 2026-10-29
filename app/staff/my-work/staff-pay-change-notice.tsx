"use client";

import { useEffect, useId, useRef } from "react";
import { WorkspaceText as Text, useWorkspaceTranslation } from "@/components/workspace-language";
import { STAFF_PAY_CHANGE_LABELS, staffPayChangedFields, staffPayChanges, staffPayChangeValue } from "@/lib/staff-pay-changes";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import styles from "./staff-pay-change-notice.module.css";

export function StaffPayChangeNotice({ changes, staffId }: { changes: PayrollLiveChange[]; staffId?: string }) {
  const rows = staffPayChanges(changes, staffId);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const t = useWorkspaceTranslation();
  const hasChanges = rows.length > 0;
  useEffect(() => {
    const openFromNotification = () => {
      if (window.location.hash === "#payroll-changes" && !dialog.current?.open) dialog.current?.showModal();
    };
    if (hasChanges) openFromNotification();
    window.addEventListener("hashchange", openFromNotification);
    return () => window.removeEventListener("hashchange", openFromNotification);
  }, [hasChanges]);
  if (!hasChanges) return null;
  return <>
    <button ref={trigger} type="button" className={styles.notice} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <span aria-hidden="true">ⓘ</span><span className={styles.label}><Text text="Payroll updated" /> · {rows.length} <Text text={rows.length === 1 ? "change" : "changes"} /></span>
      <time dateTime={rows[0].created_at}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }).format(new Date(rows[0].created_at))}</time><span aria-hidden="true">›</span>
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={() => {
      if (window.location.hash === "#payroll-changes") window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      trigger.current?.focus();
    }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close();
    }}>
      <header className={styles.heading}><h2 id={titleId}><Text text="Payroll update" /></h2><button type="button" aria-label={t("Close")} onClick={() => dialog.current?.close()}>×</button></header>
      <div className={styles.entries}>{rows.map((change, index) => <details key={change.id} className={styles.entry} open={index === 0}>
        <summary><span><Text text="Updated by" /> <Text text={change.actor_id ? "Owner" : "System"} /></span><time dateTime={change.created_at}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(change.created_at))}</time></summary>
        <p className={styles.period}>{change.period_start}{change.period_end !== change.period_start && change.period_end !== "9999-12-31" ? ` – ${change.period_end}` : ""}</p>
        <dl>{staffPayChangedFields(change).filter(field => field !== "note").map(field => <div className={styles.field} key={field}><dt><Text text={STAFF_PAY_CHANGE_LABELS[field]} /></dt><dd><Text text={staffPayChangeValue(field, change.before_values[field])} /><span aria-hidden="true"> → </span><span className={styles.srOnly}><Text text="changed to" /> </span><strong><Text text={staffPayChangeValue(field, change.after_values[field])} /></strong></dd></div>)}</dl>
        {(change.before_values.note || change.after_values.note) ? <div className={styles.ownerNote}><h3><Text text="Owner’s note" /></h3>
          {change.before_values.note && change.before_values.note !== change.after_values.note ? <p className={styles.previousNote}><Text text="Previous note" />: {String(change.before_values.note)}</p> : null}
          <p>{change.after_values.note ? String(change.after_values.note) : <Text text="Note removed" />}</p>
        </div> : null}
      </details>)}</div>
      <p className={styles.footnote}><Text text="Already included in your current pay." /></p>
    </dialog>
  </>;
}
