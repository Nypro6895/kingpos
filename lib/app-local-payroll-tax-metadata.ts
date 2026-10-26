import type { getPayrollTaxCompanyData } from "./payroll";
import type { taxCompanySettings } from "./tax-company";
type OriginalReport = Awaited<ReturnType<typeof getPayrollTaxCompanyData>>;
export type AppLocalPayrollTaxData = Omit<OriginalReport, "context" | "latestStatement"> & { latestStatement: { run: Pick<NonNullable<OriginalReport["latestStatement"]>["run"], "id" | "version" | "status"> } | null };
export type AppLocalPayrollTaxSettingsData = Awaited<ReturnType<typeof taxCompanySettings>>;
export const APP_LOCAL_PAYROLL_TAX_READS = {
  "owner.payroll-tax-report": { argumentKeys: ["end", "month", "payPeriodStart", "preset", "segment", "start"], access: "scoped", retention: "none" },
  "owner.payroll-tax-settings": { argumentKeys: [], access: "scoped", retention: "none" },
} as const;
export const APP_LOCAL_PAYROLL_TAX_ROUTES = ["/payroll/tax-company", "/payroll/tax-company/settings"] as const;
