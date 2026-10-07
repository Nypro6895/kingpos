"use client";
import { usePathname } from "next/navigation";
import { posUserMessage } from "@/lib/pos-user-messages";
import { usePosResourceRefresh } from "@/lib/pos-workspace-sync";
import { listPortableOperations, PORTABLE_OPERATIONS_CHANGED } from "@/lib/portable-operations";
import { portableDeviceStorage } from "@/lib/portable-device-storage";

import {
  savePortableReportClosing,
  type PortableReportData,
} from "@/app/pos/portable/actions";
import type { KeyboardEvent } from "react";
import { useEffect, useState, useTransition } from "react";

import { usePortableWorkspaceState } from "@/app/pos/portable/portable-workspace-state";

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
  return value === 0 ? "" : value.toFixed(2);
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
  data: initialData,
}: {
  data: PortableReportData;
}) {
  const pathname=usePathname();
  const workspace = usePortableWorkspaceState();
  const [data,setData]=useState(initialData);
  const [baseline,setBaseline]=useState(initialData.closingInputs);
  const [pendingCount,setPendingCount]=useState(0);
  const closingChanged=JSON.stringify(baseline)!==JSON.stringify(data.closingInputs);
  usePosResourceRefresh(workspace?.scope.split(':')[0],'report',async()=>{
    const response=await fetch('/api/pos/portable/workspace?resource=report&date='+encodeURIComponent(initialData.reportDate),{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(response.ok){const next=await response.json();if(next.reportDate===initialData.reportDate)setData(next);}
  },{enabled:pathname==="/pos/portable/report"});
  useEffect(()=>{
    if(!workspace)return;let active=true;
    const refresh=()=>{void listPortableOperations(workspace.scope).then(rows=>{if(active)setPendingCount(rows.filter(row=>row.kind==='receipt'&&row.state!=='synced'&&row.state!=='cancelled').length);});};
    refresh();window.addEventListener(PORTABLE_OPERATIONS_CHANGED,refresh);return()=>{active=false;window.removeEventListener(PORTABLE_OPERATIONS_CHANGED,refresh);};
  },[workspace?.scope]);
  const storageKey = workspace ? `kingpos:report-inputs:${workspace.scope}:${data.reportDate}` : null;
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

  useEffect(() => {
    if (!storageKey || isReadOnly) return;
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(portableDeviceStorage.getItem(storageKey) ?? "null");
        const entries=saved?.values??saved;
        if (entries && ["cashAmount", "creditCardAmount", "otherAmount", "note"].every(key => typeof entries[key] === "string")) {setValues(entries);if(saved.baseline)setBaseline(saved.baseline);}
      } catch { /* Keep server values if the device draft is unavailable. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [storageKey, isReadOnly]);

  function updateValue(key: keyof ClosingValues, value: string) {
    const next = { ...values, [key]: value };
    if (storageKey) {
      try { portableDeviceStorage.setItem(storageKey, JSON.stringify({values:next,baseline})); }
      catch { setErrorMessage("Unable to save on this device. Keep this window open.");setValues(next);return; }
    }
    setValues(next);
    setSaveState("idle");
    setErrorMessage(null);
  }

  function save(force = false) {
    if(closingChanged){setErrorMessage('Closing amounts changed on another screen. Choose which amounts to keep below.');return;}
    if (!navigator.onLine) {
      setSaveState("error");
      setErrorMessage("Entries saved on this device. Connect to finalize the report.");
      return;
    }
    if (isReadOnly || isPending) {
      return;
    }

    const snapshot = getSnapshot(values);

    if (!force && snapshot === savedSnapshot) {
      return;
    }

    if (hasInvalidAmount) {
      setSaveState("error");
      setErrorMessage("Enter an amount of 0 or more, with up to 2 decimal places.");
      return;
    }

    startTransition(async () => {
      const result = await savePortableReportClosing({
        expectedClosing: baseline,
        cashAmount: values.cashAmount,
        creditCardAmount: values.creditCardAmount,
        note: values.note,
        otherAmount: values.otherAmount,
        reportDate: data.reportDate,
      });

      if (!result.ok) {
        setSaveState("error");
        setErrorMessage(posUserMessage(result.error));
        return;
      }

      if (storageKey) portableDeviceStorage.removeItem(storageKey);
      setData(result.data);setBaseline(result.data.closingInputs);
      const savedValues = getInitialValues(result.data);

      setValues(savedValues);
      setSavedSnapshot(getSnapshot(savedValues));
      setSaveState("saved");
      setErrorMessage(null);
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
      {pendingCount>0?<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 lg:col-span-2">{pendingCount} ticket(s) on this device are not uploaded yet. Report totals will update after they are uploaded. Check the sync icon for details.</p>:null}
      {closingChanged?<div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm lg:col-span-2"><p className="font-semibold">Closing amounts changed on another screen.</p><p className="mt-1">Your entries have been kept. Latest saved total: {formatMoney(data.closingInputs.cashAmount+data.closingInputs.creditCardAmount+data.closingInputs.otherAmount)}.</p><div className="mt-3 flex flex-wrap gap-2"><button className="min-h-11 rounded-lg border bg-white px-4" onClick={()=>{setValues(getInitialValues(data));setSavedSnapshot(getSnapshot(getInitialValues(data)));setBaseline(data.closingInputs);}}>Use saved amounts</button><button className="min-h-11 rounded-lg border bg-white px-4" onClick={()=>{setBaseline(data.closingInputs);setErrorMessage(null);}}>Keep my entries for review</button></div></div>:null}
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
                placeholder="0.00"
                onFocus={(event) => {
                  if (Number(event.currentTarget.value) === 0) {
                    const key = event.currentTarget.dataset.amount as keyof ClosingValues;
                    updateValue(key, "");
                  } else event.currentTarget.select();
                }}
                onBlur={() => save()}
                onChange={(event) => updateValue("cashAmount", event.target.value)}
                onKeyDown={handleEnter}
                data-amount="cashAmount"
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
                placeholder="0.00"
                onFocus={(event) => {
                  if (Number(event.currentTarget.value) === 0) {
                    const key = event.currentTarget.dataset.amount as keyof ClosingValues;
                    updateValue(key, "");
                  } else event.currentTarget.select();
                }}
                onBlur={() => save()}
                onChange={(event) =>
                  updateValue("creditCardAmount", event.target.value)
                }
                onKeyDown={handleEnter}
                data-amount="creditCardAmount"
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
                placeholder="0.00"
                onFocus={(event) => {
                  if (Number(event.currentTarget.value) === 0) {
                    const key = event.currentTarget.dataset.amount as keyof ClosingValues;
                    updateValue(key, "");
                  } else event.currentTarget.select();
                }}
                onBlur={() => save()}
                onChange={(event) =>
                  updateValue("otherAmount", event.target.value)
                }
                onKeyDown={handleEnter}
                data-amount="otherAmount"
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
            {hasInvalidAmount ? "Check the amounts before saving." : missingOrOverText}
          </p>
        </div>
      </section>
    </div>
  );
}
