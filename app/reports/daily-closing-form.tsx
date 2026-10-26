"use client";
import { WorkspaceText } from "@/components/workspace-language";
import type { DailyClosingAdjustmentTotals, DailyClosingCorrectionField, DailyClosingCorrectionRequest, DailyClosingFinancialAdjustment, DailyClosingLockInfo, DailyClosingSnapshotTotals, DailyPosClosingInputs, DailyPosReconciliationStatus } from "@/types/pos-daily-closing";
import { type ReactNode } from "react";
import { ReportDetails } from "./report-ui";
import styles from "./reports.module.css";
import { useDailyClosingSave } from "@/lib/daily-closing-client";
import { parseClosingCents as parseInputCents } from "@/lib/daily-closing-input";
import { ClosingSaveNotice, ClosingSaveStatus } from "./owner-closing-save-notice";
import { DailyReportChangeHistory } from "./daily-report-history";

type DailyClosingFormProps = {
  children?: ReactNode;
  salonId: string;
  scope: string;
  adjustmentTotals: DailyClosingAdjustmentTotals;
  canApplyCorrection: boolean;
  canEdit: boolean;
  canRequestCorrection: boolean;
  closingInputs: DailyPosClosingInputs;
  corrections: {
    adjustments: DailyClosingFinancialAdjustment[];
    requests: DailyClosingCorrectionRequest[];
  };
  expectedTotal: number;
  lock: DailyClosingLockInfo;
  reportDate: string;
  snapshotTotals: DailyClosingSnapshotTotals | null;
};

const RECONCILIATION_LABELS: Record<DailyPosReconciliationStatus, string> = {
  balanced: "Balanced",
  over: "Over",
  short: "Short",
};

const CORRECTION_FIELD_LABELS: Record<DailyClosingCorrectionField, string> = {
  cash_amount: "Cash",
  credit_card_amount: "Credit Card",
  note: "Note",
  other_amount: "Other",
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function fromCents(value: number) {
  return Math.round(value) / 100;
}

function getReconciliationStatus(
  differenceCents: number,
): DailyPosReconciliationStatus {
  if (Math.abs(differenceCents) < 1) {
    return "balanced";
  }

  return differenceCents < 0 ? "short" : "over";
}

function readCorrectionValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return (value as { value?: unknown }).value;
}

function getCorrectionFieldLabel(field: string) {
  if (field === "ticket_correction") {
    return "Ticket correction";
  }

  return CORRECTION_FIELD_LABELS[field as DailyClosingCorrectionField] ?? field;
}

function formatCorrectionValue(field: string, value: unknown) {
  if (field === "ticket_correction") {
    return "Ticket changes recorded";
  }

  const rawValue = readCorrectionValue(value);

  if (field === "note") {
    return typeof rawValue === "string" && rawValue ? rawValue : "Empty";
  }

  const amount = Number(rawValue ?? 0);

  return Number.isFinite(amount) ? formatMoney(amount) : "Invalid";
}

function formatDelta(value: number) {
  if (Math.abs(value) < 0.005) {
    return formatMoney(0);
  }

  return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}

function CorrectionHistory({
  adjustments,
  requests,
}: {
  adjustments: DailyClosingFinancialAdjustment[];
  requests: DailyClosingCorrectionRequest[];
}) {
  if (requests.length === 0 && adjustments.length === 0) {
    return (
      <section className={styles.message}>
        <h2 className="text-lg font-semibold text-zinc-950">
          <WorkspaceText text="Correction History" />
        </h2>
        <p className="mt-3 text-sm text-zinc-500"><WorkspaceText text="No corrections for this date." /></p>
      </section>
    );
  }

  return <>
    <ul className={styles.history}>
      {requests.map((request) => <li key={request.id}>
        <div className={styles.historyHeading}><strong><WorkspaceText text={getCorrectionFieldLabel(request.correctionType)} /></strong><span><WorkspaceText text={request.status} /></span></div>
        <div className={styles.historyHeading}><span>{formatCorrectionValue(request.correctionType, request.requestedValue)}</span><strong>{formatDelta(request.moneyDelta)}</strong></div>
        <p>{request.reason}</p>
        <p><WorkspaceText text="By" /> <WorkspaceText text={request.requestedByName ?? "Unknown"} /> · <WorkspaceText text={formatDateTime(request.requestedAt)} /></p>
        {request.approvedByName ? <p><WorkspaceText text="Approved by" /> {request.approvedByName}</p> : null}
      </li>)}
    </ul>
    {adjustments.length > 0 ? <p className={styles.message}><WorkspaceText text="Applied adjustment rows:" /> {adjustments.length}</p> : null}
  </>;
}

export function DailyClosingForm({
  children,
  salonId,
  scope,
  canEdit,
  closingInputs,
  corrections,
  expectedTotal,
  lock,
  reportDate,
}: DailyClosingFormProps) {
  const editor = useDailyClosingSave({mode: "owner", salonId, scope, reportDate, initial: closingInputs, canEdit});
  const {values, updateValue, handleEnter} = editor;
  const isSavePending = editor.isPending;
  const isReadOnly = editor.locked;
  const cashCents = parseInputCents(values.cashAmount);
  const creditCardCents = parseInputCents(values.creditCardAmount);
  const otherCents = parseInputCents(values.otherAmount);
  const hasInvalidAmount =
    cashCents === null || creditCardCents === null || otherCents === null;
  const actualTotalCents = hasInvalidAmount
    ? 0
    : cashCents + creditCardCents + otherCents;
  const expectedTotalCents = toCents(expectedTotal);
  const differenceCents = actualTotalCents - expectedTotalCents;
  const reconciliationStatus = hasInvalidAmount
    ? "short"
    : getReconciliationStatus(differenceCents);
  return (
    <>
      <form className={styles.closing} onSubmit={(event) => {
        event.preventDefault();
        editor.save(true);
      }}>
        <div className={styles.closingHeader}>
          <h2><WorkspaceText text="Closing Inputs" /></h2>
          <span className={styles.draft}><WorkspaceText text="Live" /></span>
        </div>
        <ClosingSaveNotice editor={editor} />
            <div className={styles.moneyInputs}>
              <label className={styles.moneyRow}>
                <span>
                  <WorkspaceText text="Cash" />
                </span>
                <span className={styles.moneyInput} data-locked={lock.isLocked}><span aria-hidden="true">$</span><input
                  disabled={isReadOnly}
                  inputMode="decimal"
                  name="cash_amount"
                  placeholder="0.00"
                  onFocus={event => editor.focusMoney("cashAmount", event)}
                  onBlur={() => editor.blurMoney("cashAmount")}
                  onChange={(event) =>
                    updateValue("cashAmount", event.target.value)
                  }
                  onKeyDown={handleEnter}
                  value={values.cashAmount}
                />{lock.isLocked ? <output>{formatMoney(fromCents(cashCents ?? 0))}</output> : null}</span>
              </label>
              <label className={styles.moneyRow}>
                <span>
                  <WorkspaceText text="Credit Card" />
                </span>
                <span className={styles.moneyInput} data-locked={lock.isLocked}><span aria-hidden="true">$</span><input
                  disabled={isReadOnly}
                  inputMode="decimal"
                  name="credit_card_amount"
                  placeholder="0.00"
                  onFocus={event => editor.focusMoney("creditCardAmount", event)}
                  onBlur={() => editor.blurMoney("creditCardAmount")}
                  onChange={(event) =>
                    updateValue("creditCardAmount", event.target.value)
                  }
                  onKeyDown={handleEnter}
                  value={values.creditCardAmount}
                />{lock.isLocked ? <output>{formatMoney(fromCents(creditCardCents ?? 0))}</output> : null}</span>
              </label>
              <label className={styles.moneyRow}>
                <span>
                  <WorkspaceText text="Other" />
                </span>
                <span className={styles.moneyInput} data-locked={lock.isLocked}><span aria-hidden="true">$</span><input
                  disabled={isReadOnly}
                  inputMode="decimal"
                  name="other_amount"
                  placeholder="0.00"
                  onFocus={event => editor.focusMoney("otherAmount", event)}
                  onBlur={() => editor.blurMoney("otherAmount")}
                  onChange={(event) =>
                    updateValue("otherAmount", event.target.value)
                  }
                  onKeyDown={handleEnter}
                  value={values.otherAmount}
                />{lock.isLocked ? <output>{formatMoney(fromCents(otherCents ?? 0))}</output> : null}</span>
              </label>
            </div>

            <label className={styles.note}>
              <span>
                <WorkspaceText text="Note" />
              </span>
              <textarea
                rows={1}
                disabled={isReadOnly}
                name="note"
                onBlur={() => editor.blurMoney()}
                onChange={(event) => updateValue("note", event.target.value)}
                value={values.note}
              />
            </label>


        <section className={styles.reconciliation}>
          <h2><WorkspaceText text="Reconciliation" /></h2>
          <dl>
            <div><dt><WorkspaceText text="Expected total" /></dt><dd>{formatMoney(expectedTotal)}</dd></div>
            <div><dt><WorkspaceText text="Actual total" /></dt><dd>{hasInvalidAmount ? "-" : formatMoney(fromCents(actualTotalCents))}</dd></div>
            <div className={styles.difference}>
              <dt><WorkspaceText text="Difference" /></dt>
              <dd className={hasInvalidAmount ? styles.neutral : reconciliationStatus === "short" ? styles.down : reconciliationStatus === "over" ? styles.over : styles.up}>
                {hasInvalidAmount ? "-" : formatMoney(fromCents(differenceCents))}
                <small><WorkspaceText text={hasInvalidAmount ? "Invalid amount" : RECONCILIATION_LABELS[reconciliationStatus]} /></small>
              </dd>
            </div>
          </dl>
        </section>
        {!canEdit&&<p className={styles.message}><WorkspaceText text="Only the Owner can edit Daily Report amounts."/></p>}
        {(corrections.requests.length>0||corrections.adjustments.length>0)&&<ReportDetails title="Earlier change history"><CorrectionHistory adjustments={corrections.adjustments} requests={corrections.requests}/></ReportDetails>}
        {children}
        <div className={styles.actions}>
          <div className={styles.saveState} aria-live="polite"><ClosingSaveStatus status={editor.status} /></div>
          {!lock.isLocked ? <button className={styles.save} disabled={!canEdit || isSavePending} type="submit">
            {isSavePending ? "Saving" : <WorkspaceText text="Save" />}
          </button> : null}
        </div>
      </form>
      <DailyReportChangeHistory salonId={salonId} reportDate={reportDate} savedAt={editor.status}/>

    </>
  );
}


