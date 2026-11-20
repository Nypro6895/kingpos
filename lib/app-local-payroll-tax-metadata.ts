import type { getPayrollTaxCompanyData } from "./payroll";
import type { taxCompanySettings } from "./tax-company";
import type { OwnerTaxReportData } from "./owner-tax-report";
type OriginalReport = Awaited<ReturnType<typeof getPayrollTaxCompanyData>>;
export type AppLocalPayrollTaxData = Omit<OriginalReport, "context" | "latestStatement"> & { latestStatement: { run: Pick<NonNullable<OriginalReport["latestStatement"]>["run"], "id" | "version" | "status"> } | null };
export type AppLocalOwnerTaxReportData = { source: "published-tax"; report: OwnerTaxReportData };
export type AppLocalTaxReportData = AppLocalPayrollTaxData | AppLocalOwnerTaxReportData;
export type AppLocalPayrollTaxSettingsData = Awaited<ReturnType<typeof taxCompanySettings>>;
export const APP_LOCAL_PAYROLL_TAX_READS = {
  "owner.tax-report": { argumentKeys: ["end", "month", "payPeriodStart", "preset", "segment", "start"], access: "scoped", retention: "none" },
  // Preserve the original DTO for installed app bundles that still request this name.
  "owner.payroll-tax-report": { argumentKeys: ["end", "month", "payPeriodStart", "preset", "segment", "start"], access: "scoped", retention: "none" },
  "owner.payroll-tax-settings": { argumentKeys: [], access: "scoped", retention: "none" },
} as const;
export const APP_LOCAL_PAYROLL_TAX_ROUTES = ["/payroll/tax-company", "/payroll/tax-company/settings"] as const;
