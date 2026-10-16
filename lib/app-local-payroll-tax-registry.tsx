"use client";

import { AppLocalPayrollTax } from "@/components/app-local-payroll-tax";
import { AppLocalPayrollTaxSettings } from "@/components/app-local-payroll-tax-settings";
import { useAppLocalResource } from "./app-local-resource";
import { getAppLocalHost } from "./app-local-host";
import type { AppLocalPage, AppLocalPageProps } from "./app-local-page-registry";
import type { AppLocalPayrollTaxData, AppLocalPayrollTaxSettingsData } from "./app-local-payroll-tax-metadata";

const filters = ["end", "month", "payPeriodStart", "preset", "segment", "start"];
function PayrollTaxPage(props: AppLocalPageProps) {
  const url = new URL(props.path, "https://reylumi.com"), settings = url.pathname.endsWith("/settings"), name = settings ? "owner.payroll-tax-settings" : "owner.payroll-tax-report";
  const scope = props.context?.context.authenticated ? props.context.context.scope : undefined;
  const args = settings ? {} : Object.fromEntries([...url.searchParams].filter(([key]) => filters.includes(key)));
  const resource = useAppLocalResource<AppLocalPayrollTaxData | AppLocalPayrollTaxSettingsData>(scope, name, args, { enabled: Boolean(scope) });
  const title = settings ? "Tax Company settings" : "Tax payroll report";
  if (!scope) return <main className="p-6"><h1 className="text-xl font-semibold">{title}</h1><button className="mt-4 rounded border px-4 py-2" onClick={() => void (props.host ?? getAppLocalHost()).openOnline(`/login?next=${encodeURIComponent(props.path)}`)}>Sign in</button></main>;
  if (resource.data) return settings ? <AppLocalPayrollTaxSettings key={scope} state={resource.data as AppLocalPayrollTaxSettingsData} query={{ message: url.searchParams.get("message") ?? undefined }} /> : <AppLocalPayrollTax key={scope} data={resource.data as AppLocalPayrollTaxData} params={{ payroll_error: url.searchParams.get("payroll_error") ?? undefined }} />;
  return <main className="p-6" aria-busy={resource.loading || resource.refreshing}><h1 className="text-xl font-semibold">{title}</h1>{resource.error ? <><p className="mt-4" role="alert">{resource.error}</p><button className="mt-4 rounded border px-4 py-2" onClick={() => void resource.refresh()}>Try again</button></> : <p className="mt-4" role="status">Opening…</p>}</main>;
}
export function getAppLocalPayrollTaxPage(path: string): AppLocalPage | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || /\\|%2f|%5c|%00/i.test(path) || path.length > 4096) return null;
    const url = new URL(path, "https://reylumi.com"), settings = url.pathname === "/payroll/tax-company/settings";
    if (!settings && url.pathname !== "/payroll/tax-company") return null;
    const allowed = settings ? ["message"] : [...filters, "report", "payroll_error"];
    if ([...url.searchParams].some(([key, value]) => !allowed.includes(key) || value.length > 512 || url.searchParams.getAll(key).length !== 1)) return null;
    return { id: settings ? "owner.payroll-tax-settings" : "owner.payroll-tax-report", title: settings ? "Tax Company settings" : "Tax payroll report", requiresContext: true, Component: PayrollTaxPage,
      features: settings ? ["complete-original-connection-settings", "original-owner-credential-confirmation", "original-access-revocation", "no-credential-snapshot"] : ["complete-original-tax-payroll-report", "original-saved-statement", "period-filter", "original-paystub-upload", "no-persistent-signed-capabilities"] };
  } catch { return null; }
}
