"use client";

import { useMemo, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { latestTaxRuns, refreshTaxRunSelection, summarizeTaxLines } from "@/lib/tax-workspace-model";
import { ownerTaxInitialFilter, ownerTaxReportYears, ownerTaxRunsInRange, type OwnerTaxReportPeriod } from "@/lib/owner-tax-report-model";
import type { OwnerTaxReportData } from "@/lib/owner-tax-report";
import type { TaxRun } from "@/types/tax-workspace";
import { TaxFiguresSheet, formatTaxFigure, taxSheetTotal } from "./tax-figures-sheet";
import styles from "./owner-tax-report.module.css";

function periodLabel(run: TaxRun) {
  const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${date(run.period_start)} – ${date(run.period_end)}`;
}

export function OwnerTaxReport({ data, initialPeriod, sample = false }: {
  data: OwnerTaxReportData;
  initialPeriod?: OwnerTaxReportPeriod;
  sample?: boolean;
}) {
  const translate = useWorkspaceTranslation();
  const published = useMemo(() => latestTaxRuns(data.runs), [data.runs]);
  const [initial] = useState(() => ownerTaxInitialFilter(published, initialPeriod));
  const [year, setYear] = useState("");
  const [range, setRange] = useState({ start: initial.start, end: initial.end });
  const [selection, setSelection] = useState(initial.selection);
  const [search, setSearch] = useState("");
  const years = useMemo(() => ownerTaxReportYears(published), [published]);
  const runs = useMemo(() => ownerTaxRunsInRange(published, year, range.start, range.end), [published, year, range.start, range.end]);
  const selectedRun = useMemo(() => refreshTaxRunSelection(data.runs, selection), [data.runs, selection]);
  const summary = selectedRun === "summary";
  const currentRun = runs.find((run) => run.id === selectedRun);
  const runIds = useMemo(() => new Set((summary ? runs : currentRun ? [currentRun] : []).map((run) => run.id)), [summary, runs, currentRun]);
  const periodLines = useMemo(() => data.lines.filter((line) => runIds.has(line.run_id)), [data.lines, runIds]);
  const lines = useMemo(() => (summary ? summarizeTaxLines(periodLines) : periodLines)
    .filter((line) => `${line.name} ${line.legal_name ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [periodLines, search, summary]);

  return (
    <main className={styles.page} data-owner-tax-report>
      {sample && <p className={styles.sample}>Local preview · sample data · no production connection · no active Tax plugin required</p>}
      <header className={styles.header}>
        <div><h1><WorkspaceText text="Tax" /></h1><p>{data.salon.name} <span>·</span> <WorkspaceText text="Tax reporting figures" /></p></div>
        <span className={styles.readOnly}><WorkspaceText text="Read only" /></span>
      </header>
      <p className={styles.description}><WorkspaceText text="The same published figures shown in your tax company's view. Available without an active Tax Company plugin." /></p>

      <section className={styles.filters} aria-label={translate("Tax report filters")}>
        <label><span><WorkspaceText text="Year" /></span><select aria-label={translate("Tax report year")} value={year} onChange={(event) => {
          const next = event.target.value;
          setYear(next);
          setRange({ start: "", end: "" });
          if (!summary) setSelection(ownerTaxRunsInRange(published, next)[0]?.id ?? "summary");
        }}><option value="">{translate("All years")}</option>{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className={styles.period}><span><WorkspaceText text="Period" /></span><select aria-label={translate("Tax reporting period")} value={selectedRun} onChange={(event) => setSelection(event.target.value)}>
          <option value="summary">{translate("All periods · summary")}</option>
          {runs.map((run) => <option key={run.id} value={run.id}>{periodLabel(run)} · v{run.version}</option>)}
        </select></label>
        <label className={styles.search}><span><WorkspaceText text="Employee" /></span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translate("Find name or legal name")} aria-label={translate("Find tax report employee")} /></label>
      </section>

      <section className={styles.summary} aria-label={translate("Tax report totals")}>
        {([["gross", "Total reported"], ["tax", "Withheld by salon"], ["check_net", "Check after withholding"]] as const).map(([key, label]) => <div key={key}><span><WorkspaceText text={label} /></span><strong>{formatTaxFigure(taxSheetTotal(lines, key))}</strong></div>)}
      </section>
      {!lines.length && <div className={styles.periodNote}><span><WorkspaceText text="No published reporting data" /></span></div>}
      {(range.start || range.end) && <button type="button" className={styles.clearRange} onClick={() => { setRange({ start: "", end: "" }); setSelection("summary"); }}><WorkspaceText text="Clear date range" /></button>}

      {lines.length ? <TaxFiguresSheet lines={lines} label={`${summary ? `${runs.length} ${translate("periods · latest published version per period")}` : currentRun ? `${periodLabel(currentRun)} · v${currentRun.version}` : ""} · ${lines.length} ${translate("employees")}`} /> : <div role="status" className={styles.empty}><h2><WorkspaceText text={search ? "No matching employees" : "No reporting figures for this period"} /></h2><p><WorkspaceText text={search ? "Try another name or select a different period." : "Published tax reporting figures will appear here. This view remains available without an active Tax Company plugin."} /></p></div>}

      <footer className={styles.note}>
        <p><WorkspaceText text="These figures do not confirm that a tax return has been filed." /></p>
      </footer>
    </main>
  );
}
