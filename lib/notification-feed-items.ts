import type { AppNotification } from "@/lib/app-notifications";
import { getManageWorkspaceId } from "@/lib/current-context";
import type {
  SalonStaffConnectionRequestWithDetails,
  StaffConnectionDashboardRequest,
} from "@/types/staff-salon-connection";
import type {
  NotificationFeedGroup,
  NotificationFeedGroupKey,
  NotificationFeedItem,
} from "@/types/notifications";

export const BEAUTY_SALON_PUBLICATION_REQUEST_TYPE =
  "beauty_salon_publication_request";
export const BEAUTY_SALON_PUBLICATION_REQUEST_HREF =
  "/salon-profile/client-transformations";
export const PUBLIC_BOOKING_CREATED_TYPE = "public_booking_created";
export const PUBLIC_BOOKING_HREF = "/bookings";

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeTime(value: string, now = new Date()) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d`;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function isSameDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function safeNotificationHref(href: string | null | undefined) {
  const trimmed = href?.trim() ?? "";

  return trimmed.startsWith("/") && !trimmed.startsWith("//")
    ? trimmed
    : "/notifications";
}

function matchesPath(href: string, path: string) {
  const [pathname] = href.split("?");

  return pathname === path || pathname.startsWith(`${path}/`);
}

export function resolveAppNotificationDestination(
  notification: AppNotification,
) {
  if (notification.recipient_kind === "customer" && notification.booking_id) {
    const href = `/my-bookings/${notification.booking_id}`;

    return {
      href,
      label: appNotificationActionLabel(href),
      workspaceId: null,
    };
  }

  const href = safeNotificationHref(notification.href);
  const shouldOpenManageWorkspace =
    notification.recipient_kind === "owner_manager" &&
    Boolean(notification.salon_id) &&
    ((notification.notification_type === BEAUTY_SALON_PUBLICATION_REQUEST_TYPE &&
      matchesPath(href, BEAUTY_SALON_PUBLICATION_REQUEST_HREF)) ||
      (notification.notification_type === PUBLIC_BOOKING_CREATED_TYPE &&
        matchesPath(href, PUBLIC_BOOKING_HREF)));

  return {
    href,
    label: appNotificationActionLabel(href),
    workspaceId:
      shouldOpenManageWorkspace && notification.salon_id
        ? getManageWorkspaceId(notification.salon_id)
        : null,
  };
}

function appNotificationActionLabel(href: string) {
  if (href.startsWith("/my-bookings")) {
    return "View booking";
  }

  if (href.startsWith("/bookings")) {
    return "Review booking";
  }

  if (href.startsWith("/staff/appointments")) {
    return "View appointment";
  }

  if (href.startsWith("/salon-profile/client-transformations")) {
    return "Review";
  }

  return "Open";
}

function staffRequestTimestamp(request: StaffConnectionDashboardRequest) {
  return (
    request.updated_at ??
    request.created_at ??
    request.accepted_at ??
    request.declined_at ??
    request.cancelled_at ??
    request.revoked_at
  );
}

export function appNotificationToFeedItem(
  notification: AppNotification,
  now = new Date(),
): NotificationFeedItem {
  const kindLabel = titleCase(notification.notification_type || "Notification");
  const destination = resolveAppNotificationDestination(notification);

  return {
    action: {
      href: destination.href,
      label: destination.label,
      notificationId: notification.id,
      type: "open-app",
      workspaceId: destination.workspaceId,
    },
    body: notification.body,
    createdAt: notification.created_at,
    id: `app:${notification.id}`,
    kindLabel,
    meta: `${relativeTime(notification.created_at, now)} - ${kindLabel}`,
    source: "app",
    status: notification.read_at ? "read" : "unread",
    title: notification.title,
    unread: !notification.read_at,
  };
}

export function staffDashboardRequestToFeedItem(
  request: StaffConnectionDashboardRequest,
  now = new Date(),
): NotificationFeedItem {
  const isInvite = request.direction === "salon_invite";
  const pending = request.status === "pending";
  const title = isInvite
    ? `Invitation from ${request.salon_name}`
    : `Application to ${request.salon_name}`;
  const fallbackBody = isInvite
    ? `Invited as ${request.staff_job_title ?? "Staff"}`
    : `Requested title ${request.requested_job_title ?? "Not specified"}`;
  const action = pending
    ? isInvite
      ? ({
          requestId: request.id,
          type: "staff-invite" as const,
        })
      : ({
          requestId: request.id,
          type: "staff-application" as const,
        })
    : ({
        href: "/staff/connections",
        label: "View",
        type: "link" as const,
      });

  return {
    action,
    body: request.message ?? fallbackBody,
    createdAt: staffRequestTimestamp(request),
    id: `staff:${request.id}`,
    kindLabel: isInvite ? "Staff invite" : "Staff application",
    meta: `${relativeTime(staffRequestTimestamp(request), now)} - ${request.status}`,
    source: "staff",
    status: request.status,
    title,
    unread: pending,
  };
}

export function managerRequestToFeedItem(
  request: SalonStaffConnectionRequestWithDetails,
  now = new Date(),
): NotificationFeedItem {
  const applicant =
    request.staff?.display_name ??
    request.account?.display_name ??
    request.target_email_normalized ??
    "Applicant";
  const role = request.requested_job_title ? ` - ${request.requested_job_title}` : "";

  return {
    action: {
      href: "/staff",
      label: "Review",
      type: "manager-review",
    },
    body: request.message ?? `${applicant}${role}`,
    createdAt: request.created_at,
    id: `manager:${request.id}`,
    kindLabel: "Manager review",
    meta: `${relativeTime(request.created_at, now)} - ${request.status}`,
    source: "manager",
    status: request.status,
    title: "Staff application pending",
    unread: request.status === "pending",
  };
}

export function managerApplicationsSummaryToFeedItem(
  count: number,
  now = new Date(),
): NotificationFeedItem {
  return {
    action: {
      href: "/staff",
      label: "Review",
      type: "manager-review",
    },
    body: `${count} pending staff application${count === 1 ? "" : "s"}`,
    createdAt: now.toISOString(),
    id: "manager:pending-summary",
    kindLabel: "Manager review",
    meta: "Needs action",
    source: "manager",
    status: "pending",
    title: "Staff applications need review",
    unread: count > 0,
  };
}

export function sortNotificationFeedItems(items: NotificationFeedItem[]) {
  return [...items].sort((left, right) => {
    if (left.unread !== right.unread) {
      return left.unread ? -1 : 1;
    }

    return (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  });
}

export function groupNotificationFeedItems(
  items: NotificationFeedItem[],
  now = new Date(),
): NotificationFeedGroup[] {
  const buckets: Record<NotificationFeedGroupKey, NotificationFeedItem[]> = {
    earlier: [],
    new: [],
    today: [],
  };

  for (const item of sortNotificationFeedItems(items)) {
    const createdAt = new Date(item.createdAt);

    if (item.unread) {
      buckets.new.push(item);
    } else if (!Number.isNaN(createdAt.getTime()) && isSameDate(createdAt, now)) {
      buckets.today.push(item);
    } else {
      buckets.earlier.push(item);
    }
  }

  const groups: NotificationFeedGroup[] = [
    { id: "new", items: buckets.new, title: "New" },
    { id: "today", items: buckets.today, title: "Today" },
    { id: "earlier", items: buckets.earlier, title: "Earlier" },
  ];

  return groups.filter((group) => group.items.length > 0);
}
