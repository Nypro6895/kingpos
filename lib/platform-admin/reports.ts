import "server-only";

import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import {
  assertReportPriority,
  assertReportStatus,
  assertUuid,
  parseAdminSearchParams,
} from "@/lib/platform-admin/validation";
import type {
  PlatformAdminAuditLogItem,
  PlatformAdminNoteItem,
  PlatformAdminPageResult,
  PlatformAdminReportAssignee,
  PlatformAdminReportListItem,
  PlatformAdminReportSubject,
} from "@/types/platform-admin";

export type PlatformAdminReportDetail = {
  assignee: PlatformAdminReportAssignee | null;
  notes: PlatformAdminNoteItem[];
  reporter: {
    id: string;
    display_name: string | null;
    status: string;
  } | null;
  report: {
    id: string;
    report_number: string;
    category: string;
    priority: string;
    status: string;
    summary: string;
    description: string | null;
    source: string;
    reporter_user_id: string | null;
    subject_user_id: string | null;
    subject_organization_id: string | null;
    subject_location_id: string | null;
    assigned_membership_id: string | null;
    resolution: string | null;
    created_by_user_id: string | null;
    resolved_by_user_id: string | null;
    closed_by_user_id: string | null;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
    closed_at: string | null;
  };
  subject: PlatformAdminReportSubject | null;
  timeline: PlatformAdminAuditLogItem[];
};

export async function searchPlatformAdminReports(input: {
  assigned?: string | string[] | null;
  page?: string | string[] | null;
  pageSize?: string | string[] | null;
  priority?: string | string[] | null;
  q?: string | string[] | null;
  status?: string | string[] | null;
}) {
  const search = parseAdminSearchParams(input);
  const statusValue = Array.isArray(input.status) ? input.status[0] : input.status;
  const priorityValue = Array.isArray(input.priority)
    ? input.priority[0]
    : input.priority;
  const assignedValue = Array.isArray(input.assigned)
    ? input.assigned[0]
    : input.assigned;
  const status = assertReportStatus(statusValue?.trim() || null);
  const priority = assertReportPriority(priorityValue?.trim() || null);
  const assigned = assignedValue?.trim() || null;

  if (assigned && assigned !== "me" && assigned !== "unassigned") {
    throw new Error("Invalid assignment filter.");
  }

  return callPlatformAdminRpc<PlatformAdminPageResult<PlatformAdminReportListItem>>(
    "search_platform_admin_reports",
    {
      p_assigned: assigned,
      p_page: search.page,
      p_page_size: search.pageSize,
      p_priority: priority,
      p_query: search.query,
      p_status: status,
    },
  );
}

export async function getPlatformAdminReportDetail(reportId: string) {
  return callPlatformAdminRpc<PlatformAdminReportDetail>(
    "get_platform_admin_report_detail",
    {
      p_report_id: assertUuid(reportId, "Report ID"),
    },
  );
}

export async function createPlatformAdminReport(input: {
  assignedMembershipId: string | null;
  category: string;
  description: string | null;
  priority: string;
  reason: string | null;
  reporterUserId: string | null;
  source: string;
  subjectBusinessId: string | null;
  subjectLocationId: string | null;
  subjectUserId: string | null;
  summary: string;
}) {
  const priority = assertReportPriority(input.priority);

  if (!priority) {
    throw new Error("Report priority is required.");
  }

  return callPlatformAdminRpc<{
    report_id: string;
    report_number: string;
    status: string;
  }>("create_platform_admin_report", {
    p_assigned_membership_id: input.assignedMembershipId
      ? assertUuid(input.assignedMembershipId, "Assigned membership ID")
      : null,
    p_category: input.category,
    p_description: input.description,
    p_priority: priority,
    p_reason: input.reason,
    p_reporter_user_id: input.reporterUserId
      ? assertUuid(input.reporterUserId, "Reporter user ID")
      : null,
    p_source: input.source,
    p_subject_location_id: input.subjectLocationId
      ? assertUuid(input.subjectLocationId, "Subject location ID")
      : null,
    p_subject_organization_id: input.subjectBusinessId
      ? assertUuid(input.subjectBusinessId, "Subject business ID")
      : null,
    p_subject_user_id: input.subjectUserId
      ? assertUuid(input.subjectUserId, "Subject user ID")
      : null,
    p_summary: input.summary,
  });
}

export async function assignPlatformAdminReport(input: {
  assignedMembershipId: string | null;
  reason: string;
  reportId: string;
}) {
  return callPlatformAdminRpc<{
    assigned_membership_id: string | null;
    report_id: string;
  }>("assign_platform_admin_report", {
    p_assigned_membership_id: input.assignedMembershipId
      ? assertUuid(input.assignedMembershipId, "Assigned membership ID")
      : null,
    p_reason: input.reason,
    p_report_id: assertUuid(input.reportId, "Report ID"),
  });
}

export async function updatePlatformAdminReport(input: {
  description: string | null;
  priority: string;
  reason: string;
  reportId: string;
  status: string;
  summary: string;
}) {
  const priority = assertReportPriority(input.priority);
  const status = assertReportStatus(input.status);

  if (!priority || !status) {
    throw new Error("Report priority and status are required.");
  }

  return callPlatformAdminRpc<{
    priority: string;
    report_id: string;
    status: string;
  }>("update_platform_admin_report", {
    p_description: input.description,
    p_priority: priority,
    p_reason: input.reason,
    p_report_id: assertUuid(input.reportId, "Report ID"),
    p_status: status,
    p_summary: input.summary,
  });
}

export async function resolvePlatformAdminReport(input: {
  reason: string;
  reportId: string;
  resolution: string;
}) {
  return callPlatformAdminRpc<{ report_id: string; status: string }>(
    "resolve_platform_admin_report",
    {
      p_reason: input.reason,
      p_report_id: assertUuid(input.reportId, "Report ID"),
      p_resolution: input.resolution,
    },
  );
}

export async function closePlatformAdminReport(input: {
  reason: string;
  reportId: string;
}) {
  return callPlatformAdminRpc<{ report_id: string; status: string }>(
    "close_platform_admin_report",
    {
      p_reason: input.reason,
      p_report_id: assertUuid(input.reportId, "Report ID"),
    },
  );
}
