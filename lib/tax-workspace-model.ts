import type {
  TaxDocument,
  TaxLine,
  TaxRun,
  TaxWorkspaceData,
  TaxReportAmounts,
  TaxReportBreakdown,
  TaxReportComponent,
} from "@/types/tax-workspace";
export const TAX_REPORT_COMPONENT_KEYS = ["check_wage", "cash_wage", "tip", "bonus"] as const;

const reportAmountKeys = ["gross", "tax", "net", "check_gross", "check_tax", "check_net", "cash_gross", "cash_tax", "cash_net"] as const;
function unknownTaxAmounts(): TaxReportAmounts {
  return Object.fromEntries(reportAmountKeys.map((key) => [key, null])) as TaxReportAmounts;
}
function unavailableTaxBreakdown(): TaxReportBreakdown {
  return {
    version: 1,
    state: "historical_unavailable",
    components: Object.fromEntries(TAX_REPORT_COMPONENT_KEYS.map((key) => [key, {
      ...unknownTaxAmounts(), shown: false, tax_applied: null, tax_rate: null, payout_method: null,
    }])) as TaxReportBreakdown["components"],
    totals: unknownTaxAmounts(),
  };
}
export function getTaxLineComponents(line: TaxLine) {
  return (line.breakdown ?? unavailableTaxBreakdown()).components;
}
export function getTaxLineCashNet(line: TaxLine): number | null {
  return line.breakdown?.state === "published" ? line.breakdown.totals.cash_net : null;
}
export function totalTaxFigures<T>(rows: readonly T[], key: keyof T): number | null {
  if (rows.some((row) => row[key] === null || row[key] === undefined || !Number.isFinite(Number(row[key])))) return null;
  return rows.reduce((sum, row) => sum + Math.round(Number(row[key]) * 100), 0) / 100;
}
function aggregateTaxBreakdowns(lines: TaxLine[]): TaxReportBreakdown {
  if (lines.some((line) => line.breakdown?.state !== "published")) return unavailableTaxBreakdown();
  const breakdowns = lines.map((line) => line.breakdown!);
  const sumAmounts = (rows: TaxReportAmounts[]) => Object.fromEntries(reportAmountKeys.map((key) => [key, totalTaxFigures(rows, key)])) as TaxReportAmounts;
  return {
    version: 1, state: "published",
    components: Object.fromEntries(TAX_REPORT_COMPONENT_KEYS.map((key) => {
      const rows = breakdowns.map((item) => item.components[key]);
      const first = rows[0];
      const shown = rows.every((row) => row.shown);
      return [key, {
        ...sumAmounts(rows), shown,
        tax_applied: shown && rows.every((row) => row.tax_applied === first.tax_applied) ? first.tax_applied : null,
        tax_rate: shown && rows.every((row) => row.tax_rate === first.tax_rate) ? first.tax_rate : null,
        payout_method: shown ? rows.every((row) => row.payout_method === first.payout_method) ? first.payout_method : "mixed" : null,
      } satisfies TaxReportComponent];
    })) as TaxReportBreakdown["components"],
    totals: sumAmounts(breakdowns.map((item) => item.totals)),
  };
}

export function latestTaxRuns(runs: TaxRun[]) {
  const latest = new Map<string, TaxRun>();
  for (const run of runs) {
    if (!["printed", "paid"].includes(run.status)) continue;
    const key = `${run.period_start}:${run.period_end}`;
    if (!latest.has(key) || latest.get(key)!.version < run.version)
      latest.set(key, run);
  }
  return [...latest.values()].sort((a, b) =>
    b.period_start.localeCompare(a.period_start),
  );
}
export function refreshTaxRunSelection(runs: TaxRun[], selected: string) {
  if (!selected || selected === "summary") return selected;
  const previous = runs.find((r) => r.id === selected);
  if (!previous) return latestTaxRuns(runs)[0]?.id ?? "";
  return (
    latestTaxRuns(runs).find(
      (r) =>
        r.period_start === previous.period_start &&
        r.period_end === previous.period_end,
    )?.id ?? selected
  );
}
export function taxPeriodRuns(runs: TaxRun[], range: string, today: string) {
  const [year, month] = today.split("-").map(Number);
  let start: string, end: string;
  if (range === "previous_year") {
    start = `${year - 1}-01-01`;
    end = `${year - 1}-12-31`;
  } else if (range === "all") return latestTaxRuns(runs);
  else {
    const date = new Date(
      Date.UTC(year, month - 1 - (range === "previous_month" ? 1 : 0), 1),
    );
    const prefix = date.toISOString().slice(0, 7);
    start = `${prefix}-01`;
    end = `${prefix}-31`;
  }
  return latestTaxRuns(runs).filter(
    (run) => run.period_start <= end && run.period_end >= start,
  );
}
export function taxCurrentPaystub(
  documents: TaxDocument[],
  staffId: string,
  runId: string,
) {
  return (
    documents
      .filter(
        (d) =>
          d.kind === "paystub" &&
          d.staff_id === staffId &&
          d.payroll_run_id === runId &&
          !d.archived_at &&
          !d.owner_deleted_at,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}
export function taxPreviousRun(runs: TaxRun[], run: TaxRun) {
  return (
    runs
      .filter(
        (r) =>
          r.period_start === run.period_start &&
          r.period_end === run.period_end &&
          r.version < run.version,
      )
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}
export function taxLineChangedFields(before: TaxLine, line: TaxLine): string[] {
  const fields: (keyof TaxLine)[] = ["reported_wage", "reported_gross", "tax", "actual_check", "wage_check_net", "cash_reported", "tip", "bonus", "tax_rate", "legal_name", "tip_method", "bonus_method"];
  const changed: string[] = fields.filter((key) => before[key] !== line[key]);
  if (JSON.stringify(before.breakdown) !== JSON.stringify(line.breakdown)) changed.push("breakdown");
  return changed;
}
export function taxChangedLine(data: TaxWorkspaceData, line: TaxLine) {
  const run = data.runs.find((r) => r.id === line.run_id);
  const previous = run ? taxPreviousRun(data.runs, run) : null;
  const before = previous
    ? data.lines.find(
        (l) => l.run_id === previous.id && l.staff_id === line.staff_id,
      )
    : null;
  return before && taxLineChangedFields(before, line).length ? before : null;
}
export function summarizeTaxLines(lines: TaxLine[]) {
  const grouped = new Map<string, TaxLine[]>();
  for (const line of lines) {
    const current = grouped.get(line.staff_id);
    if (!current) grouped.set(line.staff_id, [line]);
    else current.push(line);
  }
  return [...grouped.values()].map((rows) => {
    const first = rows[0];
    const result = { ...first, run_id: "summary", breakdown: aggregateTaxBreakdowns(rows) };
    for (const key of ["reported_wage", "reported_gross", "tax", "actual_check", "wage_check_net", "cash_reported", "tip", "bonus"] as const) result[key] = totalTaxFigures(rows, key);
    result.tax_rate = rows.every((row) => row.tax_rate === first.tax_rate) ? first.tax_rate : null;
    result.tip_method = rows.every((row) => row.tip_method === first.tip_method) ? first.tip_method : "mixed";
    result.bonus_method = rows.every((row) => row.bonus_method === first.bonus_method) ? first.bonus_method : "mixed";
    return result;
  });
}
export function taxReceiptCents(value: string) {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value))
    throw new Error("Enter a valid USD amount with at most two decimals.");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function validateTaxFile(file: {
  size: number;
  type: string;
  name: string;
}) {
  if (
    file.size < 1 ||
    file.size > 10 * 1024 * 1024 ||
    !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
      file.type,
    ) ||
    file.name.length > 240
  )
    throw new Error("Use a PDF, PNG, JPEG or WebP file up to 10 MB.");
}
