import type { PlatformReportStatus, PlatformAdminRoleSlug } from "@/types/platform-admin";

const labels: Record<PlatformReportStatus, string> = {
  new: "New",
  under_review: "Under review",
  action_required: "Action required",
  resolved: "Resolved",
  closed: "Closed",
};

// Terminal transitions use the dedicated Resolve / Close actions.
export function reportUpdateStatusOptions(status: PlatformReportStatus, role: PlatformAdminRoleSlug) {
  const next: PlatformReportStatus[] = [status];
  if (status === "new" || status === "action_required" || status === "resolved" || (status === "closed" && role === "platform_owner")) next.push("under_review");
  if (status === "under_review") next.push("action_required");
  return next.map(value => ({ value, label: labels[value] }));
}

export function reportCanResolve(status: PlatformReportStatus) {
  return status === "under_review" || status === "action_required" || status === "resolved";
}

export function reportCanClose(status: PlatformReportStatus, resolution: string | null) {
  return status === "resolved" && Boolean(resolution?.trim());
}
