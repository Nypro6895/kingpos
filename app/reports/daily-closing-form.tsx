"use client";

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
import { useMemo, useState, useTransition } from "react";

type DailyClosingFormProps = {
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

type ClosingFormValues = {
  cashAmount: string;
  creditCardAmount: string;
  note: string;
  otherAmount: string;
};

const RECONCILIATION_LABELS: Record<DailyPosReconciliationStatus, string> = {
  balanced: "\u0110\u1ee7 / Balanced",
  over: "D\u01b0 / Over",
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

function parseInputCents(value: string) {
  const normalized = value.trim().replaceAll(",", "").replace(/^\$/, "");

  if (!normalized) {
    return 0;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100);
}

function getSnapshot(values: ClosingFormValues) {
  return JSON.stringify({
    cashAmount: values.cashAmount.trim(),
    creditCardAmount: values.creditCardAmount.trim(),
    note: values.note.trim(),
    otherAmount: values.otherAmount.trim(),
  });
}

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

function getInitialValues(
  closingInputs: DailyPosClosingInputs,
): ClosingFormValues {
  return {
    cashAmount: formatInputMoney(closingInputs.cashAmount),
    creditCardAmount: formatInputMoney(closingInputs.creditCardAmount),
    note: closingInputs.note ?? "",
    otherAmount: formatInputMoney(closingInputs.otherAmount),
  };
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
      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-950">
          Correction History
        </h2>
        <p className="mt-3 text-sm text-zinc-500">No corrections for this date.</p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-zinc-950">
        Correction History
      </h2>
      <div className="mt-4 overflow-hidden rounded border border-zinc-200">
        <div className="grid grid-cols-12 bg-zinc-50 px-3 py-2 text-xs font-medium uppercase text-zinc-500">
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Field</div>
          <div className="col-span-3">Requested</div>
          <div className="col-span-2">Delta</div>
          <div className="col-span-3">Reason</div>
        </div>
        <ul className="divide-y divide-zinc-200">
          {requests.map((request) => (
            <li className="grid grid-cols-12 gap-2 px-3 py-3 text-sm" key={request.id}>
              <div className="col-span-2">
                <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium capitalize text-zinc-700">
                  {request.status}
                </span>
                <p className="mt-1 text-xs text-zinc-500">
                  {formatDateTime(request.requestedAt)}
                </p>
              </div>
              <div className="col-span-2 font-medium text-zinc-950">
                {getCorrectionFieldLabel(request.correctionType)}
              </div>
              <div className="col-span-3 text-zinc-700">
                {formatCorrectionValue(
                  request.correctionType,
                  request.requestedValue,
                )}
                <p className="mt-1 text-xs text-zinc-500">
                  By {request.requestedByName ?? "Unknown"}
                </p>
              </div>
              <div className="col-span-2 font-medium text-zinc-950">
                {formatDelta(request.moneyDelta)}
              </div>
              <div className="col-span-3 text-zinc-700">
                {request.reason}
                {request.approvedByName ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Approved by {request.approvedByName}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {adjustments.length > 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          Applied adjustment rows: {adjustments.length}
        </p>
      ) : null}
    </section>
  );
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
    <div className="mt-5 rounded border border-zinc-200 bg-zinc-50 p-4">
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">
            Snapshot Actual
          </p>
          <p className="mt-1 font-semibold text-zinc-950">
            {formatMoney(snapshotTotals.actualTotal)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">
            Adjustments
          </p>
          <p className="mt-1 font-semibold text-zinc-950">
            {formatDelta(adjustmentTotals.actualTotalDelta)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">
            Snapshot Expected
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
  const [isSavePending, startSaveTransition] = useTransition();
  const [isCorrectionPending, startCorrectionTransition] = useTransition();
  const [values, setValues] = useState(() => getInitialValues(closingInputs));
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() =>
    getSnapshot(getInitialValues(closingInputs)),
  );
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCorrectionOpen, setIsCorrectionOpen] = useState(false);
  const [correctionField, setCorrectionField] =
    useState<DailyClosingCorrectionField>("cash_amount");
  const [requestedValue, setRequestedValue] = useState(() =>
    getInitialCorrectionValue("cash_amount", closingInputs),
  );
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const isReadOnly = !canEdit;
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

  function updateValue(key: keyof ClosingFormValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
    setErrorMessage(null);
  }

  function saveIfNeeded(force = false) {
    if (!canEdit || isSavePending) {
      return;
    }

    const snapshot = getSnapshot(values);

    if (!force && snapshot === lastSavedSnapshot) {
      return;
    }

    if (hasInvalidAmount) {
      setSaveState("error");
      setErrorMessage("Amounts must be valid non-negative currency values.");
      return;
    }

    startSaveTransition(async () => {
      const result = await saveDailyPosClosing({
        cashAmount: values.cashAmount,
        creditCardAmount: values.creditCardAmount,
        note: values.note,
        otherAmount: values.otherAmount,
        reportDate,
      });

      if (!result.ok) {
        setSaveState("error");
        setErrorMessage(result.error);
        return;
      }

      const savedValues = getInitialValues(result.closingInputs);

      setValues(savedValues);
      setLastSavedSnapshot(getSnapshot(savedValues));
      setSaveState("saved");
      setErrorMessage(null);
      router.refresh();
    });
  }

  function handleEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    event.currentTarget.blur();
    saveIfNeeded();
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
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-zinc-950">
                  Closing Inputs
                </h2>
                {lock.isLocked ? (
                  <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                    {getLockLabel(lock)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-zinc-600">
                Actual money collected for the selected business date.
              </p>
            </div>
            <div className="min-h-6 text-sm" aria-live="polite">
              {isSavePending ? (
                <span className="font-medium text-zinc-600">Saving</span>
              ) : saveState === "saved" ? (
                <span className="font-medium text-emerald-700">Saved</span>
              ) : saveState === "error" ? (
                <span className="font-medium text-red-700">Error</span>
              ) : null}
            </div>
          </div>

          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveIfNeeded(true);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-medium uppercase text-zinc-500">
                  Cash
                </span>
                <input
                  className="mt-1 h-11 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
                  disabled={isReadOnly}
                  inputMode="decimal"
                  name="cash_amount"
                  onBlur={() => saveIfNeeded()}
                  onChange={(event) =>
                    updateValue("cashAmount", event.target.value)
                  }
                  onKeyDown={handleEnter}
                  value={values.cashAmount}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase text-zinc-500">
                  Credit Card
                </span>
                <input
                  className="mt-1 h-11 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
                  disabled={isReadOnly}
                  inputMode="decimal"
                  name="credit_card_amount"
                  onBlur={() => saveIfNeeded()}
                  onChange={(event) =>
                    updateValue("creditCardAmount", event.target.value)
                  }
                  onKeyDown={handleEnter}
                  value={values.creditCardAmount}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase text-zinc-500">
                  Other
                </span>
                <input
                  className="mt-1 h-11 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
                  disabled={isReadOnly}
                  inputMode="decimal"
                  name="other_amount"
                  onBlur={() => saveIfNeeded()}
                  onChange={(event) =>
                    updateValue("otherAmount", event.target.value)
                  }
                  onKeyDown={handleEnter}
                  value={values.otherAmount}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs font-medium uppercase text-zinc-500">
                Note
              </span>
              <textarea
                className="mt-1 min-h-20 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
                disabled={isReadOnly}
                name="note"
                onBlur={() => saveIfNeeded()}
                onChange={(event) => updateValue("note", event.target.value)}
                value={values.note}
              />
            </label>

            {errorMessage ? (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {errorMessage}
              </p>
            ) : null}

            {lock.isLocked ? (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This business date is locked. Corrections are recorded separately.
              </p>
            ) : !canEdit ? (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Payroll manage permission is required to edit closing amounts.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Actual Total
                </p>
                <p className="mt-1 text-2xl font-semibold text-zinc-950">
                  {hasInvalidAmount
                    ? "-"
                    : formatMoney(fromCents(actualTotalCents))}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {lock.isLocked && canRequestCorrection ? (
                  <button
                    className="h-10 rounded border border-zinc-300 px-4 text-sm font-medium text-zinc-950"
                    onClick={openCorrection}
                    type="button"
                  >
                    Request Correction
                  </button>
                ) : null}
                {!lock.isLocked ? (
                  <button
                    className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                    disabled={!canEdit || isSavePending}
                    type="submit"
                  >
                    {isSavePending ? "Saving" : "Save"}
                  </button>
                ) : null}
              </div>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-zinc-950">
            Reconciliation
          </h2>
          <dl className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-600">Expected total</dt>
              <dd className="text-sm font-semibold text-zinc-950">
                {formatMoney(expectedTotal)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-600">Actual total</dt>
              <dd className="text-sm font-semibold text-zinc-950">
                {hasInvalidAmount ? "-" : formatMoney(fromCents(actualTotalCents))}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-600">Difference</dt>
              <dd className="text-sm font-semibold text-zinc-950">
                {hasInvalidAmount ? "-" : formatMoney(fromCents(differenceCents))}
              </dd>
            </div>
          </dl>

          <div
            className={`mt-5 rounded border px-4 py-3 ${
              hasInvalidAmount
                ? "border-zinc-200 bg-zinc-50 text-zinc-700"
                : getStatusClass(reconciliationStatus)
            }`}
          >
            <p className="text-sm font-semibold">
              {hasInvalidAmount
                ? "Invalid amount"
                : RECONCILIATION_LABELS[reconciliationStatus]}
            </p>
            {!hasInvalidAmount && reconciliationStatus === "short" ? (
              <p className="mt-1 text-sm">
                Missing {formatMoney(Math.abs(fromCents(differenceCents)))}
              </p>
            ) : null}
            {!hasInvalidAmount && reconciliationStatus === "over" ? (
              <p className="mt-1 text-sm">
                Extra {formatMoney(Math.abs(fromCents(differenceCents)))}
              </p>
            ) : null}
          </div>

          {lock.isLocked ? (
            <SnapshotSummary
              adjustmentTotals={adjustmentTotals}
              snapshotTotals={snapshotTotals}
            />
          ) : null}
        </section>
      </div>

      {lock.isLocked ? (
        <CorrectionHistory
          adjustments={corrections.adjustments}
          requests={corrections.requests}
        />
      ) : null}

      {isCorrectionOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">
                  Request Correction
                </h2>
                <p className="mt-1 text-sm text-zinc-600">{reportDate}</p>
              </div>
              <button
                className="rounded border border-zinc-300 px-2 py-1 text-sm font-medium text-zinc-700"
                onClick={() => setIsCorrectionOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase text-zinc-500">
                  Field
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
                      {CORRECTION_FIELD_LABELS[field]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Current Effective Value
                </p>
                <p className="mt-1 font-semibold text-zinc-950">
                  {typeof currentCorrectionValue === "number"
                    ? formatMoney(currentCorrectionValue)
                    : currentCorrectionValue || "Empty"}
                </p>
              </div>

              {correctionField === "note" ? (
                <label className="block">
                  <span className="text-xs font-medium uppercase text-zinc-500">
                    Requested Note
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
                    Requested Value
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
                  Reason
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
                  {correctionError}
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 pt-4">
                <button
                  className="h-10 rounded border border-zinc-300 px-4 text-sm font-medium text-zinc-950"
                  disabled={isCorrectionPending}
                  onClick={() => setIsCorrectionOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 rounded border border-zinc-300 px-4 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-100"
                  disabled={isCorrectionPending}
                  onClick={() => submitCorrection(false)}
                  type="button"
                >
                  {isCorrectionPending ? "Submitting" : "Submit Request"}
                </button>
                {canApplyCorrection ? (
                  <button
                    className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                    disabled={isCorrectionPending}
                    onClick={() => submitCorrection(true)}
                    type="button"
                  >
                    {isCorrectionPending ? "Applying" : "Apply Correction"}
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
