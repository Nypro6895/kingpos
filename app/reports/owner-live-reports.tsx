"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { CompactFilters } from "@/components/compact-filters";
import styles from "./reports.module.css";
import { ReportDetails, ReportIcon } from "./report-ui";
import { ReportRangeFilter } from "./report-controls";
import {useState,useEffect,useLayoutEffect,useRef,useCallback,useMemo} from 'react';
import {useSearchParams,usePathname} from 'next/navigation';
import {usePosResourceRefresh} from '@/lib/pos-workspace-sync';
import {useExperienceScope} from '@/components/experience-scope';
import {experienceResourceCache} from '@/lib/experience-resource-cache';
import {fetchWorkspaceResource} from '@/lib/fetch-workspace-resource';
import {useExperienceResource} from '@/lib/use-experience-resource';
import {ClosingDateForm,ReportTabs} from './report-controls';
import {DailyClosingForm} from './daily-closing-form';
import {OperationalReportDashboard} from './operational-report-dashboard';
import type {OperationalReportData} from '@/lib/operational-report';
import type {DailyPosReport,DailyPosReportStaffRow} from '@/types/pos-daily-closing';
import Link from 'next/link';
function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function getReportHref(date: string, reportOverview?: OperationalReportData, reportPath = "/reports") {
  const params = new URLSearchParams({ date });

  if (reportOverview) {
    params.set("preset", reportOverview.range.preset);
    params.set("start", reportOverview.range.startDate);
    params.set("end", reportOverview.range.endDate);
  }

  return `${reportPath}?${params.toString()}#daily-closing`;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <section>
      <p><WorkspaceText text={label} /></p>
      <p>{value}</p>
    </section>
  );
}

function NoPermissionState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="bg-zinc-50 p-5 text-sm text-zinc-600">
        <WorkspaceText text="You do not have permission to view reports." />
      </p>
    </main>
  );
}

function DateSelector({
  reportOverview,
  selectedDate,
  today,
}: {
  reportOverview: OperationalReportData;
  selectedDate: string;
  today: string;
}) {
  const __vt = useWorkspaceTranslation();

  const reportPath = usePathname().startsWith("/pos/report") ? "/pos/report" : "/reports";
  return (
    <div className={styles.date}>
      <ReportIcon kind="calendar" /><span>{selectedDate}</span>
      <CompactFilters label={__vt("Closing date")} active={selectedDate !== today} icon={<ReportIcon kind="filter" />}>
    <ClosingDateForm>
      <input name="preset" type="hidden" value={reportOverview.range.preset} />
      <input
        name="start"
        type="hidden"
        value={reportOverview.range.startDate}
      />
      <input name="end" type="hidden" value={reportOverview.range.endDate} />
      <label className="block min-w-0">
        <span >
          <WorkspaceText text="Business Date" />
        </span>
        <input
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          key={selectedDate}
          defaultValue={selectedDate}
          name="date"
          type="date"
        />
      </label>
      <button
        className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        <WorkspaceText text="Load" />
      </button>
      <Link
        className="inline-flex h-11 items-center px-3 text-sm font-medium text-teal-700 hover:underline"
        href={getReportHref(today, reportOverview, reportPath)}
      >
        <WorkspaceText text="Today" />
      </Link>
    </ClosingDateForm>
      </CompactFilters>
    </div>
  );
}

function StaffReportTable({ rows }: { rows: DailyPosReportStaffRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">
          <WorkspaceText text="No finalized staff rows for this date." />
        </h2>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-4"><WorkspaceText text="Staff" /></div>
        <div className="col-span-3 text-right"><WorkspaceText text="Total Earned" /></div>
        <div className="col-span-3 text-right"><WorkspaceText text="Tip" /></div>
        <div className="col-span-2 text-right"><WorkspaceText text="Turns" /></div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {rows.map((row) => (
          <li className="grid grid-cols-12 px-4 py-3 text-sm" key={row.staffId}>
            <div className="col-span-4 min-w-0 break-words font-medium text-zinc-950">
              {row.staffName}
            </div>
            <div className="col-span-3 text-right text-zinc-950">
              {formatMoney(row.totalEarned)}
            </div>
            <div className="col-span-3 text-right text-zinc-700">
              {formatMoney(row.tipAmount)}
            </div>
            <div className="col-span-2 text-right text-zinc-700">
              {row.totalTurns}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}


type Props={viewerId:string;snapshotAt?:number;query?:string;managedRead?:boolean;salonId:string;salonName:string;today:string;report:DailyPosReport;reportOverview:OperationalReportData;canEdit:boolean;canApplyCorrection:boolean;canRequestCorrection:boolean};
export function OwnerLiveReports(initial:Props){
  const __vt = useWorkspaceTranslation();

 const routeParams=useSearchParams();
 const params=useMemo(()=>initial.query===undefined?routeParams:new URLSearchParams(initial.query),[initial.query,routeParams]);
 const scope=useExperienceScope()?.context.scope;
 const snapshotKey='owner-reports?'+params.toString();
 const [mountedAt]=useState(()=>Date.now());
 const [oversize,setOversize]=useState<{base:Props;data:Props}|null>(null);
 const retained=useExperienceResource({scope:scope??'unavailable',key:snapshotKey,initialData:initial,
   initialUpdatedAt:initial.snapshotAt??mountedAt,tags:['report'],freshForMs:30000,retainForMs:30*60000,
   enabled:false,fetcher:async()=>({data:initial})});
 const data=oversize?.base===initial?oversize.data:retained.data??initial;
 const latest=useRef(data);
 useLayoutEffect(()=>{latest.current=data;},[data]);
 const generation=useRef(0);
 useEffect(()=>{generation.current++;},[initial]);
 const {salonId,salonName,today,report,reportOverview,canEdit,canApplyCorrection,canRequestCorrection}=data;
 const activeView=useRef<"overview"|"closing">("overview");
 const dirtyViews=useRef({overview:false,closing:false});
 const running=useRef(false);
 const queued=useRef(false);
 const runQueued=useRef<()=>Promise<void>>(async()=>{});
 const refreshView=useCallback(async()=>{
   if(running.current){queued.current=true;return;}
   running.current=true;
   const view=activeView.current;
   const snapshotGeneration=generation.current;
   const query=new URLSearchParams(params);query.set('date',initial.report.reportDate);
   query.set('preset',initial.reportOverview.range.preset);
   query.set('start',initial.reportOverview.range.startDate);
   query.set('end',initial.reportOverview.range.endDate);
   query.set('view',view);
   try {
     if(!scope)return;
     const url='/api/pos/owner/reports?'+query.toString();
     const policy={tags:['report'],freshForMs:30000,retainForMs:30*60000};
     const next=await experienceResourceCache.load({scope,key:url},fetchWorkspaceResource<Partial<Props>&{salonId:string;closingScope:string}>(url,scope),{...policy,force:true});
     if(next.salonId===salonId&&next.closingScope===`${salonId}:${initial.viewerId}`&&snapshotGeneration===generation.current&&experienceResourceCache.isAvailable({scope,key:snapshotKey})){
       const previous=experienceResourceCache.get<Props>({scope,key:snapshotKey})?.data??latest.current;
       const merged={...previous,...next};
       if(experienceResourceCache.seed({scope,key:snapshotKey},merged,policy))setOversize(null);
       else setOversize({base:initial,data:merged});
       dirtyViews.current[view]=false;
     }
   } finally {
     running.current=false;
     if(queued.current){queued.current=false;queueMicrotask(()=>{void runQueued.current().catch(()=>{});});}
   }
 },[params,initial,salonId,scope,snapshotKey]);
 const onViewChange=useCallback((view:"overview"|"closing")=>{
   activeView.current=view;
   if(dirtyViews.current[view])void refreshView().catch(()=>{});
 },[refreshView]);
 useLayoutEffect(()=>{runQueued.current=refreshView;},[refreshView]);
 usePosResourceRefresh(salonId,'report',async()=>{
   dirtyViews.current.overview=true;dirtyViews.current.closing=true;
   await refreshView();
 },{enabled:!initial.managedRead,initialReconcile:false,freshForMs:30000,snapshotAt:Math.max(initial.snapshotAt??0,scope?experienceResourceCache.get({scope,key:snapshotKey})?.updatedAt??0:0)||initial.snapshotAt});
 if(!retained.available)return null;
  return (
    <main className={styles.page}>
      <h1 className={styles.title}><WorkspaceText text="Reports" /></h1>
      <ReportTabs
        onViewChange={onViewChange}
        overviewTools={<ReportRangeFilter key={`${reportOverview.range.preset}:${reportOverview.range.startDate}:${reportOverview.range.endDate}`} report={reportOverview} selectedClosingDate={report.reportDate} />}
        closingTools={<DateSelector reportOverview={reportOverview} selectedDate={report.reportDate} today={today} />}
        overview={
          <OperationalReportDashboard
            report={reportOverview}
            salonName={salonName}
            selectedClosingDate={report.reportDate}
          />
        }
      >
        <section>
          <h2 className="sr-only"><WorkspaceText text="Daily Closing" /></h2>


          {report.lock.liveTotalsDifferFromSnapshot ? (
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <WorkspaceText text="Current POS data differs from the locked snapshot. Corrections are recorded through adjustment records." />
            </p>
          ) : null}

          <DailyClosingForm
            scope={`${salonId}:${data.viewerId}`}
            adjustmentTotals={report.adjustmentTotals}
            canApplyCorrection={canApplyCorrection}
            canEdit={canEdit}
            canRequestCorrection={canRequestCorrection}
            closingInputs={report.closingInputs}
            corrections={report.corrections}
            expectedTotal={report.totals.expectedTotal}
            key={`${salonId}:${data.viewerId}:${report.reportDate}`}
            lock={report.lock}
            reportDate={report.reportDate}
            snapshotTotals={report.snapshotTotals}
          >
            <ReportDetails title="Closing breakdown">
          <div className={styles.closingBreakdown}>
            <SummaryCard
              label={__vt("Total Staff Earned")}
              value={formatMoney(report.totals.totalStaffEarned)}
            />
            <SummaryCard
              label={__vt("Total Tip")}
              value={formatMoney(report.totals.totalTip)}
            />
            <SummaryCard
              label={__vt("Total Discount")}
              value={formatMoney(report.totals.totalDiscount)}
            />
            <SummaryCard
              label={__vt("Gift Card")}
              value={formatMoney(report.totals.totalGiftCard)}
            />
          </div>

            </ReportDetails>
<ReportDetails title="Staff Daily Report" meta={report.staffRows.length}>
<StaffReportTable rows={report.staffRows} />
</ReportDetails>

          <ReportDetails title="Verification" meta={report.metadata.ticketCount}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt>
                  <WorkspaceText text="Tickets" />
                </dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">
                  {report.metadata.ticketCount}
                </dd>
              </div>
              <div>
                <dt>
                  <WorkspaceText text="Finalized" />
                </dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">
                  {report.metadata.finalizedTicketCount}
                </dd>
              </div>
              <div>
                <dt>
                  <WorkspaceText text="Open Excluded" />
                </dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">
                  {report.metadata.excludedOpenTicketCount}
                </dd>
              </div>
              <div>
                <dt>
                  Void/Cancel Excluded
                </dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">
                  {report.metadata.excludedVoidedTicketCount}
                </dd>
              </div>
              <div>
                <dt>
                  <WorkspaceText text="Gift Card Payments" />
                </dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">
                  {formatMoney(report.totals.giftCardPaymentTotal)}
                </dd>
              </div>
            </dl>
          </ReportDetails>
          </DailyClosingForm>


        </section>
      </ReportTabs>
    </main>
  );
}
