"use client";
import { useEffect, useState } from "react";
import { WorkspaceText as Text } from "@/components/workspace-language";
import type { DailyInputReconciliation } from "@/lib/daily-input-reconciliation";
import {DailyReconciliationPreviousChecks,useDailyReconciliationHistory} from "@/app/payroll/daily-reconciliation-history";

export function DailyReconciliationHistory({salonId,businessDate}:{salonId:string;businessDate:string;refreshKey?:unknown;timeZone?:string}){
 const history=useDailyReconciliationHistory({salonId,start:businessDate,end:businessDate,enabled:true});
 return <>{history.error?<p role="status" className="text-xs"><Text text={history.error}/><button type="button" className="ml-2 min-h-11 underline" onClick={history.retry}><Text text="Retry"/></button></p>:<DailyReconciliationPreviousChecks value={history.rows.find(row=>row.business_date===businessDate)} timezone={history.timezone}/>}</>;
}

type Case = {id: string; business_date: string; revision: number; status: string; latest_values: DailyInputReconciliation; revisions: Array<{revision: number; values: DailyInputReconciliation; created_at: string}>};
const money = (value: number | null) => value === null ? "Not entered" : new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"}).format(value);
function Balance({values}: {values: DailyInputReconciliation}) {
  return <dl className="mt-2 grid gap-1 text-sm"><div className="flex justify-between gap-3"><dt><Text text="Service difference" /></dt><dd><Text text={money(values.serviceDifference)} /></dd></div><div className="flex justify-between gap-3"><dt><Text text="Tip difference" /></dt><dd><Text text={money(values.tipDifference)} /></dd></div></dl>;
}
export function DailyReconciliationCases({salonId, startDate, endDate, refreshKey}: {salonId: string; startDate: string; endDate: string; refreshKey?: unknown}) {
  const scope = JSON.stringify([salonId, startDate, endDate]);
  const [result, setResult] = useState<{scope: string; rows: Case[]; failed: boolean}>({scope, rows: [], failed: false});
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/reports/reconciliation-cases?" + new URLSearchParams({salonId, start: startDate, end: endDate}), {credentials: "same-origin", cache: "no-store", signal: controller.signal}).then(async response => {const body = await response.json(); if (!response.ok || !Array.isArray(body.rows)) throw new Error(); if (!controller.signal.aborted) setResult({scope, rows: body.rows, failed: false});}).catch(() => {if (!controller.signal.aborted) setResult({scope, rows: [], failed: true});});
    return () => controller.abort();
  }, [salonId, startDate, endDate, refreshKey, scope]);
  if (result.scope !== scope) return null;
  if (result.failed) return <p role="status"><Text text="Daily reconciliation reports could not be loaded. Please retry." /></p>;
  if (!result.rows.length) return null;
  return <section className="mt-4 grid gap-2 rounded-xl border border-zinc-200 p-4"><h2 className="font-semibold"><Text text="Daily reconciliation reports" /></h2><p className="text-xs text-zinc-500"><Text text="Service and tips are checked separately. These reports do not change staff pay." /></p>{result.rows.map(row => <details key={row.id} className="rounded-lg border border-zinc-200 p-3"><summary className="cursor-pointer text-sm">{row.business_date} · <Text text={row.status === "resolved" ? "Resolved" : "Review required"} /></summary><Balance values={row.latest_values} /><details className="mt-2 text-xs text-zinc-600"><summary><Text text="Earlier checks" /></summary>{[...row.revisions].sort((a,b) => b.revision-a.revision).map(revision => <div key={revision.revision} className="mt-2 border-t border-zinc-100 pt-2"><time dateTime={revision.created_at}>{new Intl.DateTimeFormat("en-US", {dateStyle: "medium", timeStyle: "short"}).format(new Date(revision.created_at))}</time><Balance values={revision.values} /></div>)}</details></details>)}</section>;
}
