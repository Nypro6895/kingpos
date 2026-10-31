"use client";
import { ClosingBalanceSummary } from "@/app/reports/closing-balance-summary";
import { ClosingSaveNotice } from "@/app/reports/closing-save-notice";
import { parseClosingCents } from "@/lib/daily-closing-input";
import { useDailyClosingSave } from "@/lib/daily-closing-save";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { usePathname } from "next/navigation";
import { posUserMessage } from "@/lib/pos-user-messages";
import { usePosResourceRefresh } from "@/lib/pos-workspace-sync";
import { listPortableOperations, PORTABLE_OPERATIONS_CHANGED } from "@/lib/portable-operations";
import { portableDeviceStorage } from "@/lib/portable-device-storage";
import {FinancialHistoryProvider} from "@/app/payroll/inline-financial-history";
import {DailyInputInlineHistory} from "@/app/reports/daily-input-inline-history";

import {
  savePortableReportClosing,
  getPortableReportInputHistory,
  type PortableReportData,
} from "@/app/pos/portable/actions";
import type { KeyboardEvent } from "react";
import { useCallback,useEffect, useRef, useState } from "react";

import { usePortableWorkspaceState } from "@/app/pos/portable/portable-workspace-state";



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







function PortableClosingEditor({
  data: initialData,
}: {
  data: PortableReportData;
}) {
  const __vt = useWorkspaceTranslation();

  const pathname=usePathname();
  const workspace = usePortableWorkspaceState();
  const workspaceScope = workspace?.scope;
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
    if(!workspaceScope)return;let active=true;
    const refresh=()=>{void listPortableOperations(workspaceScope).then(rows=>{if(active)setPendingCount(rows.filter(row=>row.kind==='receipt'&&row.state!=='synced'&&row.state!=='cancelled').length);});};
    refresh();window.addEventListener(PORTABLE_OPERATIONS_CHANGED,refresh);return()=>{active=false;window.removeEventListener(PORTABLE_OPERATIONS_CHANGED,refresh);};
  },[workspaceScope]);
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
  useEffect(()=>{if(saveState==="saved")window.dispatchEvent(new Event("financial-input-saved"));},[saveState]);
  const isReadOnly = closing.readOnly || closing.phase === 'loading';
  const cashCents = parseInputCents(values.cashAmount);
  const creditCardCents = parseInputCents(values.creditCardAmount);
  const otherCents = parseInputCents(values.otherAmount);
  const hasInvalidAmount =
    cashCents === null || creditCardCents === null || otherCents === null;
  const actualTotalCents = hasInvalidAmount
    ? 0
    : cashCents + creditCardCents + otherCents;

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
          <div className="min-w-0 flex-1"><DailyInputInlineHistory businessDate={data.reportDate}/></div>
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          <label className="block"><span className="text-xs font-medium uppercase text-zinc-500"><WorkspaceText text="Tip input" /></span><input className="mt-1 h-11 w-full rounded border border-zinc-300 bg-white px-3 text-sm" disabled={isReadOnly} inputMode="decimal" placeholder="Not entered" onFocus={event => event.currentTarget.select()} onBlur={() => closing.blurMoney("tipInput")} onChange={event => updateValue("tipInput", event.target.value)} onKeyDown={handleEnter} value={values.tipInput ?? ""} /></label>
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
                <WorkspaceText text="Service entered" />
              </p>
              <p className="mt-1 text-2xl font-semibold text-zinc-950">
                {hasInvalidAmount ? "-" : [values.cashAmount, values.creditCardAmount, values.otherAmount].every(value => value.trim() === "") ? <WorkspaceText text="Not entered" /> : formatMoney(fromCents(actualTotalCents))}
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
        <ClosingBalanceSummary values={values} expectedService={data.totals.expectedTotal} expectedTip={data.totals.expectedTip ?? data.totals.tips} />
      </section>
    </div>
  );
}

export function PortableReportClosingForm({ data }: { data: PortableReportData }) {
  const workspace = usePortableWorkspaceState();
  const readChanges=useCallback(async(eventId?:string)=>{const result=await getPortableReportInputHistory(data.reportDate);return {rows:eventId?result.rows.filter(row=>row.id===eventId):result.rows};},[data.reportDate]);
  if (workspace?.businessDate && workspace.businessDate !== data.reportDate) {
    return <div role="alert" className="bg-amber-50 p-4 text-sm text-amber-900">
      <p><WorkspaceText text="The business date has changed. Reload Report to view today before entering closing amounts." /></p>
      <button type="button" className="mt-3 rounded bg-zinc-950 px-4 py-2 text-white" onClick={() => window.location.reload()}><WorkspaceText text="Reload" /></button>
    </div>;
  }
  const scope=workspace?.scope??data.closingScope??"";
  return <FinancialHistoryProvider salonId={scope.split(":")[0]} surface="reports" start={data.reportDate} end={data.reportDate} scope={scope} readChanges={readChanges}><PortableClosingEditor key={scope + ':' + data.reportDate} data={data}/></FinancialHistoryProvider>;
}
