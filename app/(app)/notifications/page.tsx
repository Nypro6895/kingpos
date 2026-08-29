import { markAllAppNotificationsReadAction } from "@/app/notifications/actions";
import { NotificationFeedList } from "@/app/notifications/notification-list";
import { getCurrentAppNotifications } from "@/lib/app-notifications";
import {
  appNotificationToFeedItem,
  groupNotificationFeedItems,
  managerRequestToFeedItem,
  sortNotificationFeedItems,
  staffDashboardRequestToFeedItem,
} from "@/lib/notification-feed-items";
import { hasPermission } from "@/lib/permissions";
import {
  getSalonStaffConnectionRequests,
  getStaffConnectionDashboard,
} from "@/lib/staff-salon-connections";
import { getAppNotificationScopeForContext } from "@/lib/workspace-pending";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { SalonStaffConnectionRequestWithDetails } from "@/types/staff-salon-connection";
import type {
  NotificationFeedGroup,
  NotificationFeedItem,
} from "@/types/notifications";

type NotificationsPageProps = {
  searchParams?: Promise<{
    filter?: string | string[] | undefined;
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function tabClass(active: boolean) {
  return [
    "inline-flex min-h-9 items-center justify-center rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
    active
      ? "bg-blue-50 text-blue-700"
      : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
  ].join(" ");
}

function MarkAllReadButton({ unreadCount }: { unreadCount: number }) {
  if (unreadCount <= 0) {
    return null;
  }

  return (
    <form action={markAllAppNotificationsReadAction}>
      <button
        className="inline-flex min-h-9 items-center justify-center rounded-full px-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        type="submit"
      >
        Mark all read
      </button>
    </form>
  );
}

function NotificationGroupSection({
  group,
}: {
  group: NotificationFeedGroup;
}) {
  const defaultOpen = group.id === "new" || group.items.length <= 6;

  return (
    <details
      className="group border-t border-zinc-100 first:border-t-0"
      open={defaultOpen}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600">
        <h2 className="text-base font-bold text-zinc-950">{group.title}</h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
          {group.items.length}
        </span>
        <span
          aria-hidden="true"
          className="ml-auto text-sm text-zinc-500 transition group-open:rotate-180"
        >
          v
        </span>
      </summary>
      <NotificationFeedList items={group.items} />
    </details>
  );
}

function EmptyNotifications({ filter }: { filter: "all" | "unread" }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-semibold text-zinc-950">
        {filter === "unread" ? "No unread notifications." : "No notifications yet."}
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        Updates that belong to this workspace will appear here.
      </p>
    </div>
  );
}

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  const params = searchParams ? await searchParams : {};
  const filter = firstParam(params.filter) === "unread" ? "unread" : "all";
  const { context, requests } = await getStaffConnectionDashboard();

  if (!context.user) {
    redirect("/login?next=/notifications");
  }

  const now = new Date();
  const appNotifications = await getCurrentAppNotifications({
    ...getAppNotificationScopeForContext(context),
    limit: 100,
  });
  const pendingStaffRequests = requests.filter(
    (request) => request.status === "pending",
  );
  const historyRequests = requests.filter(
    (request) => request.status !== "pending",
  );
  const canManageStaff =
    context.currentMembership && context.currentAccount
      ? await hasPermission("staff.manage", context)
      : false;
  let managerRequests: SalonStaffConnectionRequestWithDetails[] = [];

  if (canManageStaff) {
    try {
      const managerDashboard = await getSalonStaffConnectionRequests();
      managerRequests = managerDashboard.requests.filter(
        (request) =>
          request.direction === "staff_application" && request.status === "pending",
      );
    } catch {
      managerRequests = [];
    }
  }

  const feedItems = sortNotificationFeedItems([
    ...appNotifications.map((notification) =>
      appNotificationToFeedItem(notification, now),
    ),
    ...pendingStaffRequests.map((request) =>
      staffDashboardRequestToFeedItem(request, now),
    ),
    ...historyRequests.map((request) =>
      staffDashboardRequestToFeedItem(request, now),
    ),
    ...managerRequests.map((request) => managerRequestToFeedItem(request, now)),
  ]);
  const visibleItems: NotificationFeedItem[] =
    filter === "unread"
      ? feedItems.filter((item) => item.unread)
      : feedItems;
  const groups = groupNotificationFeedItems(visibleItems, now);
  const unreadAppNotifications = appNotifications.filter(
    (notification) => !notification.read_at,
  ).length;
  const unreadTotal = feedItems.filter((item) => item.unread).length;
  const connectionTotal = pendingStaffRequests.length + historyRequests.length;

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-100 px-3 py-4 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <header className="flex flex-col gap-3 px-4 pb-3 pt-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
            <Link className={tabClass(filter === "all")} href="/notifications">
              All
            </Link>
            <Link
              className={tabClass(filter === "unread")}
              href="/notifications?filter=unread"
            >
              Unread
              {unreadTotal > 0 ? (
                <span className="ml-1 text-xs">({unreadTotal})</span>
              ) : null}
            </Link>
            </div>
            <MarkAllReadButton unreadCount={unreadAppNotifications} />
          </div>
        </header>

        {groups.length > 0 ? (
          <div>
            {groups.map((group) => (
              <NotificationGroupSection group={group} key={group.id} />
            ))}
          </div>
        ) : (
          <EmptyNotifications filter={filter} />
        )}

        {connectionTotal > 0 ? (
          <footer className="border-t border-zinc-100 p-4">
            <Link
              className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-200 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
              href="/staff/connections"
            >
              Manage connections
            </Link>
          </footer>
        ) : null}
      </section>
    </main>
  );
}
