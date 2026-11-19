import type { PayrollPeriod } from "@/types/payroll";
import { payrollPeriodHref } from "./payroll-period-rail";

export function payrollReadTab(tab: string) {
  return ["gifts", "rewards", "discounts"].includes(tab) ? "shop" : tab;
}

/** Money tabs use the same getter plan; the original URL still selects the UI.
 * Staff/check, analytics and plugin entitlement reads remain distinct. */
export function payrollReadArgs(path: string, defaultPeriod?: PayrollPeriod): Record<string, string> {
  const query = new URL(path, "https://reylumi.com").searchParams;
  const args: Record<string, string> = {};
  for (const key of ["end", "month", "payPeriodStart", "preset", "segment", "start"]) {
    const value = query.get(key);
    if (value !== null) args[key] = value;
  }
  const tab = query.get("tab");
  args.tab = tab && ["staff", "shop", "gifts", "rewards", "discounts", "settings", "tools", "download", "tax", "analytics", "overview", "differences", "record"].includes(tab) ? tab : "shop";
  args.tab = payrollReadTab(args.tab);
  // Only a server-resolved period from this scope's default read can establish
  // this equivalence. Do not infer payroll dates from the device clock.
  if (defaultPeriod && args.tab === "shop") {
    const resolved = payrollReadArgs(payrollPeriodHref(defaultPeriod, "shop"));
    const keys = Object.keys(args);
    if (keys.length === Object.keys(resolved).length && keys.every(key => args[key] === resolved[key])) return { tab: "shop" };
  }
  return args;
}
