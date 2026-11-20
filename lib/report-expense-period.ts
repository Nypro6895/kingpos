import type { PayrollPeriod } from "@/types/payroll";
import type { PayrollRailChoice } from "@/lib/payroll-period-rail";

export type ReportExpensePeriod = {
  period: PayrollPeriod;
  months: PayrollRailChoice[];
  periods: PayrollRailChoice[];
  needsAnchor: boolean;
} | { error: string };

/** Expenses owns its period filter; Closing's date/range and the caller's route survive. */
export function reportExpensePeriodHref(period: PayrollPeriod, pathname: string, query: string) {
  const params = new URLSearchParams(query);
  params.set("expensePeriodStart", period.startDate);
  return `${pathname.startsWith("/pos/report") ? "/pos/report" : "/reports"}?${params}#expenses`;
}
