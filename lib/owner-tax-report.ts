import "server-only";
import {
  isOwnerMembership,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { loadTaxReport } from "@/lib/tax-workspace";
import type { TaxWorkspaceData } from "@/types/tax-workspace";

export type OwnerTaxReportData = Pick<
  TaxWorkspaceData,
  "salon" | "runs" | "lines"
>;

export async function loadOwnerTaxReport(
  context: CurrentBusinessContext,
): Promise<OwnerTaxReportData> {
  const salon = context.currentSalon;
  const membership = context.currentMembership;
  if (
    !context.user ||
    context.user.status !== "active" ||
    !salon ||
    !isSalonManageContext(context) ||
    !membership ||
    membership.status !== "active" ||
    membership.user_id !== context.user.id ||
    membership.account_id !== salon.account_id ||
    ("salon_id" in membership && membership.salon_id !== salon.id) ||
    !isOwnerMembership(membership)
  ) {
    throw new Error("Salon owner access required.");
  }

  // The shared authenticated RPC already permits owners without a Tax subscription.
  // Keep its published, sanitized numbers rather than calculating live payroll.
  const data = await loadTaxReport(salon.id);
  if (data.salon.id !== salon.id) {
    throw new Error("Tax report does not belong to the current salon.");
  }
  return { salon: data.salon, runs: data.runs, lines: data.lines };
}
