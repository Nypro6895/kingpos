import "server-only";

import {
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { countUnreadAppNotifications } from "@/lib/app-notifications";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffConnectionDashboardRequest } from "@/types/staff-salon-connection";

export type WorkspacePendingSummaryItem = {
  count: number;
  id: string;
  label: string;
};

export type WorkspacePendingSummary = {
  items: WorkspacePendingSummaryItem[];
  managerApplications: number;
  bookingNotifications: number;
  reviewHref: string;
  staffApplications: number;
  staffInvites: number;
  total: number;
};

function emptyPendingSummary(): WorkspacePendingSummary {
  return {
    items: [],
    bookingNotifications: 0,
    managerApplications: 0,
    reviewHref: "/notifications",
    staffApplications: 0,
    staffInvites: 0,
    total: 0,
  };
}

function pendingDashboardCount(
  requests: StaffConnectionDashboardRequest[],
  direction: StaffConnectionDashboardRequest["direction"],
) {
  return requests.filter(
    (request) => request.direction === direction && request.status === "pending",
  ).length;
}

function buildItems(input: {
  bookingNotifications: number;
  managerApplications: number;
  staffApplications: number;
  staffInvites: number;
}) {
  const items: WorkspacePendingSummaryItem[] = [];

  if (input.bookingNotifications > 0) {
    items.push({
      count: input.bookingNotifications,
      id: "booking-notifications",
      label: "Booking updates",
    });
  }

  if (input.staffInvites > 0) {
    items.push({
      count: input.staffInvites,
      id: "staff-invites",
      label: "Staff invitations",
    });
  }

  if (input.staffApplications > 0) {
    items.push({
      count: input.staffApplications,
      id: "staff-applications",
      label: "Join applications",
    });
  }

  if (input.managerApplications > 0) {
    items.push({
      count: input.managerApplications,
      id: "manager-applications",
      label: "Manager reviews",
    });
  }

  return items;
}

export async function getWorkspacePendingSummary(
  context: CurrentBusinessContext,
): Promise<WorkspacePendingSummary> {
  if (!context.user) {
    return emptyPendingSummary();
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return emptyPendingSummary();
  }

  let staffInvites = 0;
  let staffApplications = 0;
  let managerApplications = 0;
  const bookingNotifications = await countUnreadAppNotifications();

  const { data: dashboardRequests, error: dashboardError } = await supabase.rpc(
    "list_my_staff_salon_connection_requests",
  );

  if (!dashboardError) {
    const requests = Array.isArray(dashboardRequests)
      ? (dashboardRequests as StaffConnectionDashboardRequest[])
      : [];

    staffInvites = pendingDashboardCount(requests, "salon_invite");
    staffApplications = pendingDashboardCount(requests, "staff_application");
  }

  const canManageStaff =
    context.currentMembership && context.currentOrganization
      ? await hasPermission("staff.manage", context)
      : false;

  if (
    canManageStaff &&
    isSalonManageContext(context) &&
    context.currentOrganization &&
    context.currentSalon
  ) {
    const { count, error } = await supabase
      .from("staff_salon_connection_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", context.currentOrganization.id)
      .eq("salon_id", context.currentSalon.id)
      .eq("direction", "staff_application")
      .eq("status", "pending");

    if (!error) {
      managerApplications = count ?? 0;
    }
  }

  const items = buildItems({
    bookingNotifications,
    managerApplications,
    staffApplications,
    staffInvites,
  });

  return {
    bookingNotifications,
    items,
    managerApplications,
    reviewHref: "/notifications",
    staffApplications,
    staffInvites,
    total: staffInvites + staffApplications + managerApplications + bookingNotifications,
  };
}
