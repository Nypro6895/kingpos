"use client";
import { ClosingSaveNotice } from "@/app/reports/closing-save-notice";
import { parseClosingCents } from "@/lib/daily-closing-input";
import { useDailyClosingSave } from "@/lib/daily-closing-save";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
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
import { useEffect, useRef, useState } from "react";

import { usePortableWorkspaceState } from "@/app/pos/portable/portable-workspace-state";

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

const parseInputCents = parseClosingCents;

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

function PortableClosingEditor({
  data: initialData,
}: {
  data: PortableReportData;
}) {
  const __vt = useWorkspaceTranslation();

  const pathname=usePathname();
  const workspace = usePortableWorkspaceState();
  const [data,setData]=useState(initialData);
  const scope = workspace?.scope ?? initialData.closingScope ?? "";
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [pendingCount,setPendingCount]=useState(0);
  usePosResourceRefresh(workspace?.scope.split(':')[0],'report',async()=>{
    const response=await fetch('/api/pos/portable/workspace?resource=report&date='+encodeURIComponent(initialData.reportDate),{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(response.ok){const next=await response.json();if(active.current && next.closingScope===scope && next.reportDate===initialData.reportDate && !next.setupMessage)setData(next);}
  },{enabled:pathname==="/pos/portable/report"});
  useEffect(()=>{
    if(!workspace)return;let active=true;
    const refresh=()=>{void listPortableOperations(workspace.scope).then(rows=>{if(active)setPendingCount(rows.filter(row=>row.kind==='receipt'&&row.state!=='synced'&&row.state!=='cancelled').length);});};
    refresh();window.addEventListener(PORTABLE_OPERATIONS_CHANGED,refresh);return()=>{active=false;window.removeEventListener(PORTABLE_OPERATIONS_CHANGED,refresh);};
  },[workspace?.scope]);
  const closing = useDailyClosingSave({
    initial: data.closingInputs, readOnly: !scope || data.lock.isLocked || Boolean(data.setupMessage),
    storageKey: 'kingpos:report-inputs:' + scope + ':' + data.reportDate,
    storage: portableDeviceStorage,
    save: async (values, expectedClosing) => {
      const result = await savePortableReportClosing({ ...values, expectedClosing, expectedScope: scope, reportDate: data.reportDate });
      if (!result.ok) throw new Error(posUserMessage(result.error));
      if (result.data.closingScope !== scope || result.data.reportDate !== data.reportDate || result.data.setupMessage) throw new Error('Could not confirm saved amounts for this salon session.');
      return result.data.closingInputs;
    },
    read: async () => {
      const response = await fetch('/api/pos/portable/workspace?resource=report&date=' + encodeURIComponent(data.reportDate), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Could not load the saved report.');
      const result = await response.json() as PortableReportData;
      if (result.closingScope !== scope || result.reportDate !== data.reportDate || result.setupMessage) throw new Error('Could not confirm saved amounts for this salon session.');
      return { closingInputs: result.closingInputs, readOnly: result.lock.isLocked };
    },
  });
  const { values, updateValue } = closing;
  const isPending = closing.phase === 'saving';
  const saveState = closing.phase;
  const isReadOnly = closing.readOnly || closing.phase === 'loading';
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

  function handleEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.blur();
    void closing.save();
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:gap-16">
      {pendingCount>0?<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 lg:col-span-2">{pendingCount} <WorkspaceText text="ticket(s) on this device are not uploaded yet. Report totals will update after they are uploaded. Check the sync icon for details." /></p>:null}
      <section className="min-w-0 py-2">
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
            {isPending ? (
              <span className="font-medium text-zinc-600"><WorkspaceText text="Saving" /></span>
            ) : saveState === "saved" ? (
              <span className="font-medium text-emerald-700"><WorkspaceText text="Saved" /></span>
            ) : saveState === "unknown" || saveState === "error" ? (
              <span className="font-medium text-red-700"><WorkspaceText text="Save not confirmed" /></span>
            ) : null}
          </div>
        </div>

        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void closing.save(true);
          }}
        >
          <ClosingSaveNotice {...closing} />
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
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => closing.blurMoney("cashAmount")}
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
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => closing.blurMoney("creditCardAmount")}
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
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => closing.blurMoney("otherAmount")}
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
              onBlur={() => void closing.save()}
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
              disabled={isReadOnly || closing.blocked || hasInvalidAmount}
              type="submit"
            >
              {isPending ? "Saving" : <WorkspaceText text="Save" />}
            </button>
          </div>
        </form>
      </section>

      <section className="min-w-0 py-2">
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

export function PortableReportClosingForm({ data }: { data: PortableReportData }) {
  const workspace = usePortableWorkspaceState();
  if (workspace?.businessDate && workspace.businessDate !== data.reportDate) {
    return <div role="alert" className="bg-amber-50 p-4 text-sm text-amber-900">
      <p><WorkspaceText text="The business date has changed. Reload Report to view today before entering closing amounts." /></p>
      <button type="button" className="mt-3 rounded bg-zinc-950 px-4 py-2 text-white" onClick={() => window.location.reload()}><WorkspaceText text="Reload" /></button>
    </div>;
  }
  return <PortableClosingEditor key={(workspace?.scope ?? data.closingScope ?? '') + ':' + data.reportDate} data={data}/>;
}
