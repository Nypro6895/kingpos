"use client";

import { ClosingSaveNotice } from "@/app/reports/closing-save-notice";
import { parseClosingCents } from "@/lib/daily-closing-input";
import { closingSessionStorage, useDailyClosingSave } from "@/lib/daily-closing-save";
import { WorkspaceText } from "@/components/workspace-language";
import {
  saveDailyPosClosing,
  submitDailyClosingCorrection,
} from "@/app/reports/actions";
import type {
  DailyClosingAdjustmentTotals,
  DailyClosingCorrectionField,
  DailyClosingCorrectionRequest,
  DailyClosingFinancialAdjustment,
  DailyClosingLockInfo,
  DailyClosingSnapshotTotals,
  DailyPosClosingInputs,
  DailyPosReconciliationStatus,
} from "@/types/pos-daily-closing";
import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ReportDetails } from "./report-ui";
import styles from "./reports.module.css";

type DailyClosingFormProps = {
  children?: ReactNode;
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

const CORRECTION_FIELDS: DailyClosingCorrectionField[] = [
  "cash_amount",
  "credit_card_amount",
  "other_amount",
  "note",
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatInputMoney(value: number) {
  return value.toFixed(2);
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

const parseInputCents = parseClosingCents;

function getReconciliationStatus(
  differenceCents: number,
): DailyPosReconciliationStatus {
  if (Math.abs(differenceCents) < 1) {
    return "balanced";
  }

  return differenceCents < 0 ? "short" : "over";
}

function getStatusClass(status: DailyPosReconciliationStatus) {
  if (status === "balanced") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "short") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

function getCurrentFieldValue(
  field: DailyClosingCorrectionField,
  closingInputs: DailyPosClosingInputs,
) {
  if (field === "cash_amount") {
    return closingInputs.cashAmount;
  }

  if (field === "credit_card_amount") {
    return closingInputs.creditCardAmount;
  }

  if (field === "other_amount") {
    return closingInputs.otherAmount;
  }

  return closingInputs.note ?? "";
}

function getInitialCorrectionValue(
  field: DailyClosingCorrectionField,
  closingInputs: DailyPosClosingInputs,
) {
  const value = getCurrentFieldValue(field, closingInputs);

  return typeof value === "number" ? formatInputMoney(value) : value;
}

function getLockLabel(lock: DailyClosingLockInfo) {
  if (lock.status === "payroll_locked") {
    return "Payroll Locked";
  }

  if (lock.status === "approved") {
    return "Approved";
  }

  if (lock.status === "locked") {
    return "Locked";
  }

  if (lock.status === "reopened") {
    return "Reopened";
  }

  if (lock.status === "auto_locked" || lock.isPastDate) {
    return "Auto Locked";
  }

  return "Draft";
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

function SnapshotSummary({
  adjustmentTotals,
  snapshotTotals,
}: {
  adjustmentTotals: DailyClosingAdjustmentTotals;
  snapshotTotals: DailyClosingSnapshotTotals | null;
}) {
  if (!snapshotTotals) {
    return null;
  }

  return (
    <div>
      <div className={styles.snapshot}>
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">
            <WorkspaceText text="Snapshot Actual" />
          </p>
          <p className="mt-1 font-semibold text-zinc-950">
            {formatMoney(snapshotTotals.actualTotal)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">
            <WorkspaceText text="Adjustments" />
          </p>
          <p className="mt-1 font-semibold text-zinc-950">
            {formatDelta(adjustmentTotals.actualTotalDelta)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">
            <WorkspaceText text="Snapshot Expected" />
          </p>
          <p className="mt-1 font-semibold text-zinc-950">
            {formatMoney(snapshotTotals.expectedTotal)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function DailyClosingForm({
  children,
  scope,
  adjustmentTotals,
  canApplyCorrection,
  canEdit,
  canRequestCorrection,
  closingInputs,
  corrections,
  expectedTotal,
  lock,
  reportDate,
  snapshotTotals,
}: DailyClosingFormProps) {
  const router = useRouter();
  const [isCorrectionPending, startCorrectionTransition] = useTransition();
  const closing = useDailyClosingSave({
    initial: closingInputs, readOnly: !canEdit,
    storageKey: 'kingpos:owner-closing:' + scope + ':' + reportDate,
    storage: closingSessionStorage,
    save: async (values, expectedClosing) => {
      const result = await saveDailyPosClosing({ ...values, expectedClosing, expectedScope: scope, reportDate });
      if (!result.ok) throw new Error(result.error);
      return result.closingInputs;
    },
    read: async () => {
      const response = await fetch('/api/pos/owner/reports?view=closing&date=' + encodeURIComponent(reportDate), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Could not load the saved report.');
      const result = await response.json();
      if (result.closingScope !== scope || result.report?.reportDate !== reportDate) throw new Error('The selected salon, account or date changed. Reopen this report.');
      return { closingInputs: result.report.closingInputs as DailyPosClosingInputs, readOnly: !result.canEdit || result.report.lock.isLocked };
    },
    onSaved: () => router.refresh(),
  });
  const { values, updateValue } = closing;
  const isSavePending = closing.phase === 'saving';
  const saveState = closing.phase;
  const [isCorrectionOpen, setIsCorrectionOpen] = useState(false);
  const [correctionField, setCorrectionField] =
    useState<DailyClosingCorrectionField>("cash_amount");
  const [requestedValue, setRequestedValue] = useState(() =>
    getInitialCorrectionValue("cash_amount", closingInputs),
  );
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const isReadOnly = !canEdit || closing.readOnly || closing.phase === "loading";
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
  const currentCorrectionValue = useMemo(
    () => getCurrentFieldValue(correctionField, closingInputs),
    [closingInputs, correctionField],
  );
  const correctionMoneyInvalid =
    correctionField !== "note" && parseInputCents(requestedValue) === null;

  function handleEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.blur();
    void closing.save();
  }

  function openCorrection() {
    const field: DailyClosingCorrectionField = "cash_amount";

    setCorrectionField(field);
    setRequestedValue(getInitialCorrectionValue(field, closingInputs));
    setCorrectionReason("");
    setCorrectionError(null);
    setIsCorrectionOpen(true);
  }

  function changeCorrectionField(field: DailyClosingCorrectionField) {
    setCorrectionField(field);
    setRequestedValue(getInitialCorrectionValue(field, closingInputs));
    setCorrectionError(null);
  }

  function submitCorrection(applyImmediately: boolean) {
    if (!canRequestCorrection || isCorrectionPending) {
      return;
    }

    if (!correctionReason.trim()) {
      setCorrectionError("Correction reason is required.");
      return;
    }

    if (correctionMoneyInvalid) {
      setCorrectionError("Requested value must be a valid non-negative amount.");
      return;
    }

    startCorrectionTransition(async () => {
      const result = await submitDailyClosingCorrection({
        applyImmediately,
        field: correctionField,
        reason: correctionReason,
        reportDate,
        requestedValue,
      });

      if (!result.ok) {
        setCorrectionError(result.error);
        return;
      }

      setIsCorrectionOpen(false);
      setCorrectionError(null);
      router.refresh();
    });
  }

  return (
    <>
      <form className={styles.closing} onSubmit={(event) => {
        event.preventDefault();
        void closing.save(true);
      }}>
        <div className={styles.closingHeader}>
          <h2><WorkspaceText text="Closing Inputs" /></h2>
          {lock.isLocked ? <span className={styles.lock}><WorkspaceText text={getLockLabel(lock)} /></span> : <span className={styles.draft}><WorkspaceText text={getLockLabel(lock)} /></span>}
        </div>
        <ClosingSaveNotice {...closing} />
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
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => closing.blurMoney("cashAmount")}
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
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => closing.blurMoney("creditCardAmount")}
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
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => closing.blurMoney("otherAmount")}
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
                onBlur={() => void closing.save()}
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
        {lock.isLocked ? <>
          <p className={styles.message}><WorkspaceText text="This business date is locked. Corrections are recorded separately." /></p>
          {canRequestCorrection ? <button className={styles.correction} onClick={openCorrection} type="button"><WorkspaceText text="Request Correction" /></button> : null}
          <ReportDetails title="Snapshot & adjustments">
            <SnapshotSummary adjustmentTotals={adjustmentTotals} snapshotTotals={snapshotTotals} />
          </ReportDetails>
          <ReportDetails title="Correction History" meta={corrections.requests.length || undefined}>
            <CorrectionHistory adjustments={corrections.adjustments} requests={corrections.requests} />
          </ReportDetails>
        </> : !canEdit ? <p className={styles.message}><WorkspaceText text="Payroll manage permission is required to edit closing amounts." /></p> : null}
        {children}
        <div className={styles.actions}>
          <div className={styles.saveState} aria-live="polite">{isSavePending ? (
                <span className="font-medium text-zinc-600"><WorkspaceText text="Saving" /></span>
              ) : saveState === "saved" ? (
                <span className="font-medium text-emerald-700"><WorkspaceText text="Saved" /></span>
              ) : saveState === "unknown" || saveState === "error" ? (
                <span className="font-medium text-red-700"><WorkspaceText text="Save not confirmed" /></span>
              ) : null}</div>
          {!lock.isLocked ? <button className={styles.save} disabled={!canEdit || isSavePending} type="submit">
            {isSavePending ? "Saving" : <WorkspaceText text="Save" />}
          </button> : null}
        </div>
      </form>

      {isCorrectionOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="closing-correction-title" className={`${styles.dialog} w-full max-w-lg rounded-lg bg-white p-5 shadow-xl`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="closing-correction-title" className="text-lg font-semibold text-zinc-950">
                  <WorkspaceText text="Request Correction" />
                </h2>
                <p className="mt-1 text-sm text-zinc-600">{reportDate}</p>
              </div>
              <button
                className="rounded border border-zinc-300 px-2 py-1 text-sm font-medium text-zinc-700"
                onClick={() => setIsCorrectionOpen(false)}
                type="button"
              >
                <WorkspaceText text="Close" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase text-zinc-500">
                  <WorkspaceText text="Field" />
                </span>
                <select
                  className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                  onChange={(event) =>
                    changeCorrectionField(
                      event.target.value as DailyClosingCorrectionField,
                    )
                  }
                  value={correctionField}
                >
                  {CORRECTION_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      <WorkspaceText text={CORRECTION_FIELD_LABELS[field]} />
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                <p className="text-xs font-medium uppercase text-zinc-500">
                  <WorkspaceText text="Current Effective Value" />
                </p>
                <p className="mt-1 font-semibold text-zinc-950">
                  <WorkspaceText text={typeof currentCorrectionValue === "number"
                    ? formatMoney(currentCorrectionValue)
                    : currentCorrectionValue || "Empty"} />
                </p>
              </div>

              {correctionField === "note" ? (
                <label className="block">
                  <span className="text-xs font-medium uppercase text-zinc-500">
                    <WorkspaceText text="Requested Note" />
                  </span>
                  <textarea
                    className="mt-1 min-h-24 w-full rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-950"
                    onChange={(event) => setRequestedValue(event.target.value)}
                    value={requestedValue}
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="text-xs font-medium uppercase text-zinc-500">
                    <WorkspaceText text="Requested Value" />
                  </span>
                  <input
                    className="mt-1 h-10 w-full rounded border border-zinc-300 px-3 text-sm text-zinc-950"
                    inputMode="decimal"
                    onChange={(event) => setRequestedValue(event.target.value)}
                    value={requestedValue}
                  />
                </label>
              )}

              <label className="block">
                <span className="text-xs font-medium uppercase text-zinc-500">
                  <WorkspaceText text="Reason" />
                </span>
                <textarea
                  className="mt-1 min-h-24 w-full rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-950"
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  required
                  value={correctionReason}
                />
              </label>

              {correctionError ? (
                <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <WorkspaceText text={correctionError} />
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 pt-4">
                <button
                  className="h-10 rounded border border-zinc-300 px-4 text-sm font-medium text-zinc-950"
                  disabled={isCorrectionPending}
                  onClick={() => setIsCorrectionOpen(false)}
                  type="button"
                >
                  <WorkspaceText text="Cancel" />
                </button>
                <button
                  className="h-10 rounded border border-zinc-300 px-4 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-100"
                  disabled={isCorrectionPending}
                  onClick={() => submitCorrection(false)}
                  type="button"
                >
                  <WorkspaceText text={isCorrectionPending ? "Submitting" : "Submit Request"} />
                </button>
                {canApplyCorrection ? (
                  <button
                    className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                    disabled={isCorrectionPending}
                    onClick={() => submitCorrection(true)}
                    type="button"
                  >
                    <WorkspaceText text={isCorrectionPending ? "Applying" : "Apply Correction"} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
