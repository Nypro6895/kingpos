"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { portableDeviceStorage } from "@/lib/portable-device-storage";
import type { ClosingFormValues } from "@/lib/daily-closing-input";
import { usePathname } from "next/navigation";
import { usePosResourceRefresh } from "@/lib/pos-workspace-sync";
import { listPortableOperations, PORTABLE_OPERATIONS_CHANGED } from "@/lib/portable-operations";

import {
  type PortableReportData,
} from "@/app/pos/portable/actions";
import { useEffect, useState } from "react";

import { usePortableWorkspaceState } from "@/app/pos/portable/portable-workspace-state";

import { useDailyClosingSave } from "@/lib/daily-closing-client";
import { parseClosingCents as parseInputCents } from "@/lib/daily-closing-input";
import { ClosingSaveNotice, ClosingSaveStatus } from "@/app/reports/closing-save-notice";

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

function fromCents(value: number) {
  return Math.round(value) / 100;
}

function toCents(value: number) {
  return Math.round(value * 100);
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

export function PortableReportClosingForm({data}: {data: PortableReportData}) {
  const workspace = usePortableWorkspaceState();
  return <PortableClosingInputs key={`${workspace?.scope}:${data.reportDate}`} data={data} />;
}

function PortableClosingInputs({
  data: initialData,
}: {
  data: PortableReportData;
}) {
  const __vt = useWorkspaceTranslation();

  const pathname=usePathname();
  const workspace = usePortableWorkspaceState();
  const [data,setData]=useState(initialData);
  const workspaceScope = workspace?.scope;
  const [pendingCount,setPendingCount]=useState(0);
  usePosResourceRefresh(workspace?.scope.split(':')[0],'report',async()=>{
    const response=await fetch('/api/pos/portable/workspace?resource=report&date='+encodeURIComponent(initialData.reportDate),{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(response.ok){const next=await response.json();if(next.reportDate===initialData.reportDate)setData(next);}
  },{enabled:pathname==="/pos/portable/report"});
  useEffect(()=>{
    if(!workspaceScope)return;let active=true;
    const refresh=()=>{void listPortableOperations(workspaceScope).then(rows=>{if(active)setPendingCount(rows.filter(row=>row.kind==='receipt'&&row.state!=='synced'&&row.state!=='cancelled').length);});};
    refresh();window.addEventListener(PORTABLE_OPERATIONS_CHANGED,refresh);return()=>{active=false;window.removeEventListener(PORTABLE_OPERATIONS_CHANGED,refresh);};
  },[workspaceScope]);
  const editor = useDailyClosingSave({mode: "portable", salonId: workspace?.scope.split(":")[0] ?? "", reportDate: data.reportDate, initial: data.closingInputs, canEdit: !data.lock.isLocked && !data.setupMessage,
    draftStorage: portableDeviceStorage,
    legacyDraft: () => {
      if (!workspaceScope) return null;
      try { const old = JSON.parse(portableDeviceStorage.getItem(`kingpos:report-inputs:${workspaceScope}:${data.reportDate}`) ?? "null"); const entries = old?.values ?? old;
        return entries && ["cashAmount", "creditCardAmount", "otherAmount", "note"].every(key => typeof entries[key] === "string") ? {values: entries as ClosingFormValues, baseline: old.baseline} : null;
      } catch { return null; }
    },
    clearLegacyDraft: () => { if (workspaceScope) portableDeviceStorage.removeItem(`kingpos:report-inputs:${workspaceScope}:${data.reportDate}`); }
  });
  const {values, updateValue, handleEnter} = editor;
  const isPending = editor.isPending;
  const isReadOnly = editor.locked;
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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      {pendingCount>0?<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 lg:col-span-2">{pendingCount} <WorkspaceText text="ticket(s) on this device are not uploaded yet. Report totals will update after they are uploaded. Check the sync icon for details." /></p>:null}
      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">
              <WorkspaceText text="Closing Inputs" />
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              <WorkspaceText text="Actual money collected for the selected business date." />
            </p>
          </div>
          <div className="min-h-6 text-sm" aria-live="polite">
            <ClosingSaveStatus status={editor.status} />
          </div>
        </div>

        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            editor.save(true);
          }}
        >
          <ClosingSaveNotice editor={editor} />
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium uppercase text-zinc-500">
                <WorkspaceText text="Cash" />
              </span>
              <input
                className="mt-1 h-11 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
                disabled={isReadOnly}
                inputMode="decimal"
                placeholder={__vt("0.00")}
                onFocus={event => editor.focusMoney("cashAmount", event)}
                onBlur={() => editor.blurMoney("cashAmount")}
                onChange={(event) => updateValue("cashAmount", event.target.value)}
                onKeyDown={handleEnter}
                data-amount="cashAmount"
                value={values.cashAmount}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase text-zinc-500">
                <WorkspaceText text="Credit Card" />
              </span>
              <input
                className="mt-1 h-11 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
                disabled={isReadOnly}
                inputMode="decimal"
                placeholder={__vt("0.00")}
                onFocus={event => editor.focusMoney("creditCardAmount", event)}
                onBlur={() => editor.blurMoney("creditCardAmount")}
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
                <WorkspaceText text="Other" />
              </span>
              <input
                className="mt-1 h-11 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
                disabled={isReadOnly}
                inputMode="decimal"
                placeholder={__vt("0.00")}
                onFocus={event => editor.focusMoney("otherAmount", event)}
                onBlur={() => editor.blurMoney("otherAmount")}
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
              <WorkspaceText text="Note" />
            </span>
            <textarea
              className="mt-1 min-h-24 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-500"
              disabled={isReadOnly}
              onBlur={() => editor.blurMoney()}
              onChange={(event) => updateValue("note", event.target.value)}
              value={values.note}
            />
          </label>

          {data.lock.isLocked ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <WorkspaceText text="This business date is locked. Update the main report correction flow instead." />
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500">
                <WorkspaceText text="Actual Total" />
              </p>
              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {hasInvalidAmount ? "-" : formatMoney(fromCents(actualTotalCents))}
              </p>
            </div>
            <button
              className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={isReadOnly || isPending || !editor.ready || editor.hasUnknown || editor.conflict}
              type="submit"
            >
              {isPending ? "Saving" : <WorkspaceText text="Save" />}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Reconciliation" /></h2>
        <dl className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-zinc-600"><WorkspaceText text="Expected total" /></dt>
            <dd className="text-sm font-semibold text-zinc-950">
              {formatMoney(data.totals.expectedTotal)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-zinc-600"><WorkspaceText text="Actual total" /></dt>
            <dd className="text-sm font-semibold text-zinc-950">
              {hasInvalidAmount ? "-" : formatMoney(fromCents(actualTotalCents))}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-zinc-600"><WorkspaceText text="Difference" /></dt>
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
            <WorkspaceText text={hasInvalidAmount
              ? "Invalid amount"
              : RECONCILIATION_LABELS[reconciliationStatus]} />
          </p>
          <p className="mt-2 text-sm">
            <WorkspaceText text={hasInvalidAmount ? "Check the amounts before saving." : missingOrOverText} />
          </p>
        </div>
      </section>
    </div>
  );
}
