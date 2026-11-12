import type {
  TaxDocument,
  TaxLine,
  TaxRun,
  TaxWorkspaceData,
} from "@/types/tax-workspace";

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
export function taxChangedLine(data: TaxWorkspaceData, line: TaxLine) {
  const run = data.runs.find((r) => r.id === line.run_id);
  const previous = run ? taxPreviousRun(data.runs, run) : null;
  const before = previous
    ? data.lines.find(
        (l) => l.run_id === previous.id && l.staff_id === line.staff_id,
      )
    : null;
  return before &&
    [
      "reported_wage",
      "reported_gross",
      "tax",
      "actual_check",
      "wage_check_net",
      "cash_reported",
      "tip",
      "bonus",
      "tax_rate",
      "legal_name",
      "tip_method",
      "bonus_method",
    ].some((key) => before[key as keyof TaxLine] !== line[key as keyof TaxLine])
    ? before
    : null;
}
export function summarizeTaxLines(lines: TaxLine[]) {
  const grouped = new Map<string, TaxLine>();
  for (const line of lines) {
    const current = grouped.get(line.staff_id);
    if (!current) grouped.set(line.staff_id, { ...line, run_id: "summary" });
    else {
      for (const field of [
        "reported_wage",
        "reported_gross",
        "tax",
        "actual_check",
        "wage_check_net",
      ] as const)
        current[field] =
          (Math.round(Number(current[field]) * 100) +
            Math.round(Number(line[field]) * 100)) /
          100;
      for (const field of ["cash_reported", "tip", "bonus"] as const)
        current[field] =
          current[field] === null && line[field] === null
            ? null
            : (Math.round(Number(current[field] ?? 0) * 100) +
                Math.round(Number(line[field] ?? 0) * 100)) /
              100;
      if (current.tax_rate !== line.tax_rate) current.tax_rate = Number.NaN;
      if (current.tip_method !== line.tip_method) current.tip_method = "mixed";
      if (current.bonus_method !== line.bonus_method)
        current.bonus_method = "mixed";
    }
  }
  return [...grouped.values()];
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
