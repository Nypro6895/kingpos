"use client";

import { peekAppLocalResource } from "./app-local-resource";
import type { AppLocalOwnerPayrollData } from "./app-local-owner-page-types";
import { payrollReadArgs } from "./payroll-read-args";

export const DEFAULT_PAYROLL_READ_ARGS = { tab: "shop" } as const;

/** The hint changes read identity only, never authority or cache timestamps. */
export function appLocalPayrollReadArgs(scope: string | undefined, path: string) {
  const reference = peekAppLocalResource<AppLocalOwnerPayrollData>(scope, "page.owner-payroll", DEFAULT_PAYROLL_READ_ARGS);
  return payrollReadArgs(path, reference?.accessDenied ? undefined : reference?.data?.payroll?.period);
}
