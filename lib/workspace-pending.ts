import "server-only";

import {
  isAccountContext,
  isSalonManageContext,
  isSalonStaffContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import {
  countUnreadAppNotifications,
  getCurrentAppNotifications,
  type AppNotificationQueryScope,
} from "@/lib/app-notifications";
import { countPendingBeautySalonPublicationRequests } from "@/lib/beauty-salon-publications";
import {
  appNotificationToFeedItem,
  managerApplicationsSummaryToFeedItem,
  sortNotificationFeedItems,
  staffDashboardRequestToFeedItem,
} from "@/lib/notification-feed-items";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffConnectionDashboardRequest } from "@/types/staff-salon-connection";
import type { NotificationFeedItem } from "@/types/notifications";

export type WorkspacePendingSummaryItem = {
  count: number;
  id: string;
  label: string;
};

export type WorkspacePendingSummary = {
  items: WorkspacePendingSummaryItem[];
  beautyPublicationRequests: number;
  managerApplications: number;
  bookingNotifications: number;
  previewItems: NotificationFeedItem[];
  reviewHref: string;
  staffApplications: number;
  staffInvites: number;
  total: number;
};

function emptyPendingSummary(): WorkspacePendingSummary {
  return {
    items: [],
    beautyPublicationRequests: 0,
    bookingNotifications: 0,
    managerApplications: 0,
    previewItems: [],
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
  beautyPublicationRequests: number;
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

  if (input.beautyPublicationRequests > 0) {
    items.push({
      count: input.beautyPublicationRequests,
      id: "beauty-publication-requests",
      label: "Client transformations",
    });
  }

  return items;
}

export function getAppNotificationScopeForContext(
  context: CurrentBusinessContext,
): AppNotificationQueryScope {
  if (isSalonStaffContext(context)) {
    return {
      recipientKind: "staff",
      salonId: context.currentSalon?.id,
    };
  }

  if (isSalonManageContext(context)) {
    return {
      recipientKind: "owner_manager",
      salonId: context.currentSalon?.id,
    };
  }

  if (isAccountContext(context)) {
    return {
      accountId: context.accountId,
      recipientKind: "owner_manager",
    };
  }

  return {
    recipientKind: "customer",
  };
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
  let beautyPublicationRequests = 0;
  const notificationScope = getAppNotificationScopeForContext(context);
  const now = new Date();
  const [bookingNotifications, appNotificationPreviews] = await Promise.all([
    countUnreadAppNotifications(notificationScope),
    getCurrentAppNotifications({ ...notificationScope, limit: 5 }),
  ]);
  const previewItems = appNotificationPreviews.map((notification) =>
    appNotificationToFeedItem(notification, now),
  );

  const { data: dashboardRequests, error: dashboardError } = await supabase.rpc(
    "list_my_staff_salon_connection_requests",
  );

  let dashboardConnectionRequests: StaffConnectionDashboardRequest[] = [];

  if (!dashboardError) {
    dashboardConnectionRequests = Array.isArray(dashboardRequests)
      ? (dashboardRequests as StaffConnectionDashboardRequest[])
      : [];

    staffInvites = pendingDashboardCount(
      dashboardConnectionRequests,
      "salon_invite",
    );
    staffApplications = pendingDashboardCount(
      dashboardConnectionRequests,
      "staff_application",
    );
    previewItems.push(
      ...dashboardConnectionRequests
        .filter((request) => request.status === "pending")
        .slice(0, 3)
        .map((request) => staffDashboardRequestToFeedItem(request, now)),
    );
  }

  const canManageStaff =
    context.currentMembership && context.currentAccount
      ? await hasPermission("staff.manage", context)
      : false;

  if (
    canManageStaff &&
    isSalonManageContext(context) &&
    context.currentAccount &&
    context.currentSalon
  ) {
    const { count, error } = await supabase
      .from("staff_salon_connection_requests")
      .select("id", { count: "exact", head: true })
      .eq("salon_id", context.currentSalon.id)
      .eq("direction", "staff_application")
      .eq("status", "pending");

    if (!error) {
      managerApplications = count ?? 0;
    }
  }

  if (managerApplications > 0) {
    previewItems.push(
      managerApplicationsSummaryToFeedItem(managerApplications, now),
    );
  }

  beautyPublicationRequests =
    isSalonManageContext(context) && context.currentSalon
      ? await countPendingBeautySalonPublicationRequests(context)
      : 0;

  const items = buildItems({
    beautyPublicationRequests,
    bookingNotifications,
    managerApplications,
    staffApplications,
    staffInvites,
  });

  return {
    beautyPublicationRequests,
    bookingNotifications,
    items,
    managerApplications,
    previewItems: sortNotificationFeedItems(previewItems).slice(0, 6),
    reviewHref: "/notifications",
    staffApplications,
    staffInvites,
    total:
      staffInvites +
      staffApplications +
      managerApplications +
      bookingNotifications +
      beautyPublicationRequests,
  };
}
