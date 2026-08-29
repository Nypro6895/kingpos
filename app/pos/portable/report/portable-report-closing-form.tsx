"use client";

import {
  savePortableReportClosing,
  type PortableReportData,
} from "@/app/pos/portable/actions";
import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
import { useState, useTransition } from "react";

type ClosingValues = {
  cashAmount: string;
  creditCardAmount: string;
  note: string;
  otherAmount: string;
};

const RECONCILIATION_LABELS = {
  balanced: "Du / Balanced",
  over: "Du / Over",
  short: "Short",
} as const;

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatInputMoney(value: number) {
  return value.toFixed(2);
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

function fromCents(value: number) {
  return Math.round(value) / 100;
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function getInitialValues(data: PortableReportData): ClosingValues {
  return {
    cashAmount: formatInputMoney(data.closingInputs.cashAmount),
    creditCardAmount: formatInputMoney(data.closingInputs.creditCardAmount),
    note: data.closingInputs.note ?? "",
    otherAmount: formatInputMoney(data.closingInputs.otherAmount),
  };
}

function getSnapshot(values: ClosingValues) {
  return JSON.stringify({
    cashAmount: values.cashAmount.trim(),
    creditCardAmount: values.creditCardAmount.trim(),
    note: values.note.trim(),
    otherAmount: values.otherAmount.trim(),
  });
}

function getReconciliationStatus(differenceCents: number) {
  if (Math.abs(differenceCents) < 1) {
    return "balanced" as const;
  }

  return differenceCents < 0 ? ("short" as const) : ("over" as const);
}

function statusClass(status: keyof typeof RECONCILIATION_LABELS) {
  if (status === "balanced") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "short") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

export function PortableReportClosingForm({
  data,
}: {
  data: PortableReportData;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState(() => getInitialValues(data));
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    getSnapshot(getInitialValues(data)),
  );
  const [saveState, setSaveState] = useState<"error" | "idle" | "saved">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isReadOnly = data.lock.isLocked || Boolean(data.setupMessage);
  const cashCents = parseInputCents(values.cashAmount);
  const creditCardCents = parseInputCents(values.creditCardAmount);
  const otherCents = parseInputCents(values.otherAmount);
  const hasInvalidAmount =
    cashCents === null || creditCardCents === null || otherCents === null;
  const actualTotalCents = hasInvalidAmount
    ? 0
    : cashCents + creditCardCents + otherCents;
  const expectedTotalCents = toCents(data.totals.expectedTotal);
  const differenceCents = actualTotalCents - expectedTotalCents;
  const reconciliationStatus = hasInvalidAmount
    ? "short"
    : getReconciliationStatus(differenceCents);
  const missingOrOverText =
    reconciliationStatus === "balanced"
      ? "Actual total matches expected total."
      : reconciliationStatus === "short"
        ? `Missing ${formatMoney(Math.abs(fromCents(differenceCents)))}`
        : `Over ${formatMoney(fromCents(differenceCents))}`;

  function updateValue(key: keyof ClosingValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
    setErrorMessage(null);
  }

  function save(force = false) {
    if (isReadOnly || isPending) {
      return;
    }

    const snapshot = getSnapshot(values);

    if (!force && snapshot === savedSnapshot) {
      return;
    }

    if (hasInvalidAmount) {
      setSaveState("error");
      setErrorMessage("Amounts must be valid non-negative currency values.");
      return;
    }

    startTransition(async () => {
      const result = await savePortableReportClosing({
        cashAmount: values.cashAmount,
        creditCardAmount: values.creditCardAmount,
        note: values.note,
        otherAmount: values.otherAmount,
        reportDate: data.reportDate,
      });

      if (!result.ok) {
        setSaveState("error");
        setErrorMessage(result.error);
        return;
      }

      const savedValues = getInitialValues(result.data);

      setValues(savedValues);
      setSavedSnapshot(getSnapshot(savedValues));
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
    save();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">
              Closing Inputs
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Actual money collected for the selected business date.
            </p>
          </div>
          <div className="min-h-6 text-sm" aria-live="polite">
            {isPending ? (
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
            save(true);
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
                onBlur={() => save()}
                onChange={(event) => updateValue("cashAmount", event.target.value)}
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
                onBlur={() => save()}
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
                onBlur={() => save()}
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
              className="mt-1 min-h-24 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
              disabled={isReadOnly}
              onBlur={() => save()}
              onChange={(event) => updateValue("note", event.target.value)}
              value={values.note}
            />
          </label>

          {errorMessage ? (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {errorMessage}
            </p>
          ) : null}

          {data.lock.isLocked ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This business date is locked. Update the main report correction flow
              instead.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500">
                Actual Total
              </p>
              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {hasInvalidAmount ? "-" : formatMoney(fromCents(actualTotalCents))}
              </p>
            </div>
            <button
              className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={isReadOnly || isPending}
              type="submit"
            >
              {isPending ? "Saving" : "Save"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-950">Reconciliation</h2>
        <dl className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-zinc-600">Expected total</dt>
            <dd className="text-sm font-semibold text-zinc-950">
              {formatMoney(data.totals.expectedTotal)}
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
          className={[
            "mt-5 rounded border px-4 py-3",
            hasInvalidAmount
              ? "border-zinc-200 bg-zinc-50 text-zinc-700"
              : statusClass(reconciliationStatus),
          ].join(" ")}
        >
          <p className="font-semibold">
            {hasInvalidAmount
              ? "Invalid amount"
              : RECONCILIATION_LABELS[reconciliationStatus]}
          </p>
          <p className="mt-2 text-sm">
            {hasInvalidAmount ? "Fix amount fields before saving." : missingOrOverText}
          </p>
        </div>
      </section>
    </div>
  );
}
