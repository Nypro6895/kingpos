import type { PayrollStaffLineWithDailyTotals, PayrollStatementSnapshot } from "@/types/payroll";

/** Tax reports and their paystubs must refer to one saved payroll version. */
export function savedTaxReportSource(statement: PayrollStatementSnapshot | null): {
  source: "statement" | "awaiting_statement";
  lines: PayrollStaffLineWithDailyTotals[];
} {
  if (!statement) return { source: "awaiting_statement", lines: [] };
  return { source: "statement", lines: statement.lines };
}
