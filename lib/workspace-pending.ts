import "server-only";
import { cache } from "react";

import {
  isAccountContext,
  isSalonManageContext,
  isSalonStaffContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import {
  type AppNotification,
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

export function emptyPendingSummary(): WorkspacePendingSummary {
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
      label: "Unread updates",
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

export const getWorkspacePendingSummary = cache(async function getWorkspacePendingSummary(
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
  const [notificationResult,dashboardResult,managerApplicationsResult,publicationCount,bookingActionResult] = await Promise.all([
    supabase.rpc("notification_feed", {
      p_kind:notificationScope.recipientKind as string,p_salon:notificationScope.salonId ?? null,
      p_account:notificationScope.accountId ?? null,p_limit:5,
    }),
    supabase.rpc("list_my_staff_salon_connection_requests"),
    (async()=>{
      if (!context.currentMembership || !context.currentAccount || !isSalonManageContext(context) || !context.currentSalon || !await hasPermission("staff.manage",context)) return 0;
      const {count,error}=await supabase.from("staff_salon_connection_requests")
        .select("id",{count:"exact",head:true}).eq("salon_id",context.currentSalon.id)
        .eq("direction","staff_application").eq("status","pending");
      return error ? 0 : count ?? 0;
    })(),
    isSalonManageContext(context) && context.currentSalon ? countPendingBeautySalonPublicationRequests(context) : Promise.resolve(0),
    supabase.rpc("notification_booking_action_count", {
      p_kind:notificationScope.recipientKind as string,p_salon:notificationScope.salonId ?? null,p_account:notificationScope.accountId ?? null,
    }),
  ]);
  const {data:notificationFeed,error:notificationError}=notificationResult;
  const {data:dashboardRequests,error:dashboardError}=dashboardResult;
  managerApplications=managerApplicationsResult;
  beautyPublicationRequests=publicationCount;
  const actionableBookings=bookingActionResult.data;
  const bookingNotifications = Number(notificationFeed?.unreadCount ?? 0);
  const appNotificationPreviews = (notificationFeed?.items ?? []) as AppNotification[];
  if (notificationError) console.error("Notification summary unavailable", { code: notificationError.code });
  const previewItems = appNotificationPreviews.map((notification) =>
    appNotificationToFeedItem(notification, now),
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

  if (managerApplications > 0) {
    previewItems.push(
      managerApplicationsSummaryToFeedItem(managerApplications, now),
    );
  }

  if (Number(actionableBookings) > 0) previewItems.push({
    id: "booking-actions", source: "manager", title: `${actionableBookings} appointment requests need confirmation`, body: "Viewed requests stay here until they are resolved.",
    createdAt: now.toISOString(), kindLabel: "Booking requests", meta: "Needs action", status: "pending", unread: false,
    action: { type: "link", href: notificationScope.recipientKind === "staff" ? "/staff/appointments" : "/bookings", label: "Review appointments" },
  });
  if (beautyPublicationRequests > 0) previewItems.push({
    id: "beauty-actions", source: "manager", title: `${beautyPublicationRequests} client transformations need approval`, body: null,
    createdAt: now.toISOString(), kindLabel: "Content approval", meta: "Needs action", status: "pending", unread: false,
    action: { type: "link", href: "/salon-profile/client-transformations", label: "Review transformations" },
  });
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
    previewItems: [...sortNotificationFeedItems(previewItems.filter(item=>item.source === "app")).slice(0,5), ...previewItems.filter(item=>item.source !== "app").map(item=>({...item,unread:false}))],
    reviewHref: "/notifications",
    staffApplications,
    staffInvites,
    // Badge means unread updates; operational tasks have their own counts.
    total: bookingNotifications,
  };
});
