import { NotificationCenterClient } from "@/app/notifications/notification-center-client";
import { loadNotificationPage } from "@/lib/notification-center";
import { getRequestBusinessContext as getCurrentBusinessContext } from "@/lib/request-business-context";
import { getWorkspacePendingSummary } from "@/lib/workspace-pending";
import { redirect } from "next/navigation";
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const filter = (await searchParams).filter === "unread" ? "unread" : "all";
  const context = await getCurrentBusinessContext();
  if (!context.user) redirect("/login?next=/notifications");
  const [feed, pending] = await Promise.all([
    loadNotificationPage(context, { unread: filter === "unread" })
      .then((page) => ({ ...page, error: "" }))
      .catch(() => ({
        items: [],
        cursor: null,
        error: "Could not load notifications. Please try again.",
      })),
    getWorkspacePendingSummary(context),
  ]);
  return (
    <NotificationCenterClient
      initialFilter={filter}
      initialItems={feed.items}
      initialCursor={feed.cursor}
      initialError={feed.error}
      actionItems={pending.previewItems.filter((item) => item.source !== "app")}
    />
  );
}
