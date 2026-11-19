import type { TaxRun } from "@/types/tax-workspace";

export type OwnerTaxReportPeriod = {
  start?: string;
  end?: string;
  month?: string;
  segment?: string;
  payPeriodStart?: string;
  preset?: string;
};

export function ownerTaxRunsInRange(runs: TaxRun[], year: string, start = "", end = "") {
  if (start && end && start > end) return [];
  return runs.filter((run) =>
    (!year || (run.period_start <= `${year}-12-31` && run.period_end >= `${year}-01-01`)) &&
    (!start || run.period_end >= start) && (!end || run.period_start <= end),
  );
}

export function ownerTaxInitialFilter(runs: TaxRun[], query?: OwnerTaxReportPeriod) {
  const requestedStart = query?.start ?? query?.payPeriodStart;
  let start = requestedStart ?? "", end = query?.end ?? "";
  if (!requestedStart && query?.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)) {
    const [year, month] = query.month.split("-").map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    start = `${query.month}-${query.segment === "second" ? "16" : "01"}`;
    end = `${query.month}-${query.segment === "first" ? "15" : last}`;
  }
  if (!start && !end && !query?.month) return { start, end, selection: runs[0]?.id ?? "summary" };
  if ((!start && query?.month) || (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end))) {
    return { start: "9999-12-31", end: "0000-01-01", selection: "summary" };
  }
  const exact = runs.find((run) => run.period_start === start && (!end || run.period_end === end));
  // A missing anchored period stays empty; never silently jump to the newest one.
  if (query?.payPeriodStart && !query.end && !exact) return { start: "9999-12-31", end: "0000-01-01", selection: "summary" };
  return { start, end, selection: exact?.id ?? "summary" };
}

export function ownerTaxReportYears(runs: TaxRun[]) {
  const years = new Set<string>();
  for (const run of runs) {
    for (let year = Number(run.period_start.slice(0, 4)); year <= Number(run.period_end.slice(0, 4)); year++) years.add(String(year));
  }
  return [...years].sort().reverse();
}
