"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import styles from "./reports.module.css";
import { ReportIcon } from "./report-ui";
import { CompactFilters } from "@/components/compact-filters";
import { ContextualSupport } from "@/components/contextual-support";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import {useFinancialHistoryContext} from "@/app/payroll/inline-financial-history";
import type { OperationalReportData } from "@/lib/operational-report";
import { inputClass, primaryButton } from "@/app/my-place/place-ui";

export function ClosingDateForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const reportPath=usePathname().startsWith('/pos/report')?'/pos/report':'/reports';
  const [busy, start] = useTransition();
  return (
    <form
      className="min-w-0"
      onSubmit={(event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(event.currentTarget).forEach((value, key) =>
          params.set(key, String(value)),
        );
        start(() =>
          router.push(`${reportPath}?${params}#daily-closing`, { scroll: false }),
        );
      }}
    >
      <fieldset
        disabled={busy}
        className="grid min-w-0 gap-3"
      >
        {children}
      </fieldset>
      {busy ? (
        <p role="status" className="mt-2 text-xs text-zinc-500">
          <WorkspaceText text="Updating closing date…" />
        </p>
      ) : null}
    </form>
  );
}

export function ReportRangeFilter({
  report,
  selectedClosingDate,
}: {
  report: OperationalReportData;
  selectedClosingDate: string;
}) {
  const __vt = useWorkspaceTranslation();

  const [busy, start] = useTransition();
  const [preset, setPreset] = useState(report.range.preset);
  const router = useRouter();
  const reportPath=usePathname().startsWith('/pos/report')?'/pos/report':'/reports';
  return (
    <div className="min-w-0 text-sm">
      <div className={styles.date}>
        <ReportIcon kind="calendar" /><span title={__vt(report.range.label)}><WorkspaceText text={report.range.label} /></span>
        <CompactFilters label={__vt("Report filters")} active={report.range.preset === "custom"} icon={<ReportIcon kind="filter" />}>
          <p className="mb-3 text-xs text-zinc-500"><WorkspaceText text="Dates use" /> {report.range.timeZone}</p>
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const params = new URLSearchParams({
                preset,
                date: selectedClosingDate,
              });
              if (preset === "custom") {
                params.set("start", String(form.get("start")));
                params.set("end", String(form.get("end")));
              }
              start(() => {
                router.push(`${reportPath}?${params}`, { scroll: false });
              });
            }}
          >
            <fieldset className="grid gap-1">
              <legend className="mb-3 text-sm font-semibold"><WorkspaceText text="Date range" /></legend>
              {(
                [
                  { value: "today", label: "Today" },
                  { value: "this_week", label: "This week" },
                  { value: "this_month", label: "This month" },
                  { value: "custom", label: "Custom dates" },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-12 cursor-pointer items-center justify-between border-b border-zinc-100 text-sm ${preset === option.value ? "font-semibold text-teal-700" : "text-zinc-600"}`}
                >
                  <WorkspaceText text={option.label} />
                  <input
                    className="h-4 w-4 accent-teal-700"
                    name="preset"
                    type="radio"
                    value={option.value}
                    checked={preset === option.value}
                    onChange={() => setPreset(option.value)}
                  />
                </label>
              ))}
            </fieldset>
            {preset === "custom" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <WorkspaceText text="Start" />
                  <input
                    className={inputClass}
                    name="start"
                    type="date"
                    required
                    defaultValue={report.range.startDate}
                    max={report.range.businessDate}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <WorkspaceText text="End" />
                  <input
                    className={inputClass}
                    name="end"
                    type="date"
                    required
                    defaultValue={report.range.endDate}
                    max={report.range.businessDate}
                  />
                </label>
              </div>
            ) : null}
            <button className={primaryButton} type="submit" disabled={busy}>
              <WorkspaceText text="Apply filters" />
            </button>
          </form>
        </CompactFilters>
      </div>
      {busy && <p role="status" className="text-xs text-zinc-500"><WorkspaceText text="Updating report…" /></p>}
    </div>
  );
}

export function ReportTabs({
  overview,
  children,
  onViewChange,
  overviewTools,
  closingTools,
}: {
  overview: ReactNode;
  overviewTools?: ReactNode;
  closingTools?: ReactNode;
  children: ReactNode;
  onViewChange?: (view:"overview"|"closing")=>void;
}) {
  const __vt = useWorkspaceTranslation();

  const workspace=usePathname().startsWith('/pos/report');
  const history=useFinancialHistoryContext();
  const target=history.changes.find(row=>row.id===history.focusedEventId)??history.record;
  const focusView=history.focusedEventId?(target?.source_table==="ticket"?"overview":"closing"):undefined;
  const [closing, setClosing] = useState(workspace);
  useEffect(() => {
    const sync = () => setClosing(window.location.hash === "#daily-closing" || (window.location.hash!=="#overview"&&(focusView?focusView==="closing":workspace&&!window.location.hash)));
    sync();
    window.addEventListener("hashchange", sync);
  return () => window.removeEventListener("hashchange", sync);
  }, [workspace,focusView]);
  useEffect(()=>{onViewChange?.(closing ? "closing" : "overview");},[closing,onViewChange]);
  return (
    <>
      <div className={styles.toolbar}>
      <nav
        aria-label={__vt("Report views")}
        className={styles.tabs}
      >
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={closing === value}
            onClick={() => {
              setClosing(value);
              window.history.replaceState(
                null,
                "",
                `${window.location.pathname}${window.location.search}${value ? "#daily-closing" : "#overview"}`,
              );
            }}
          >
            <WorkspaceText text={value ? "Daily Closing" : "Overview"} />
          </button>
        ))}
      </nav>
        <ContextualSupport />
        <div className={styles.tools}>{closing ? closingTools : overviewTools}</div>
      </div>
      <div className="min-w-0" hidden={closing}>
        {overview}
      </div>
      <div className="min-w-0" hidden={!closing}>
        {children}
      </div>
    </>
  );
}
