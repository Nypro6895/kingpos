import { withExperiencePage } from "@/components/experience-page";
import { NotificationCenterClient } from "@/app/notifications/notification-center-client";
import { NotificationFeedList } from "@/app/notifications/notification-list";
import { Suspense } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { getExperienceContext } from "@/lib/experience-context";
import type { CurrentBusinessContext } from "@/lib/current-context";
import { getRequestBusinessContext as getCurrentBusinessContext } from "@/lib/request-business-context";
import { getWorkspacePendingSummary } from "@/lib/workspace-pending";
import { redirect } from "next/navigation";
async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const filter = (await searchParams).filter === "unread" ? "unread" : "all";
  const context = await getCurrentBusinessContext();
  if (!context.user) redirect("/login?next=/notifications");
  return (
    <NotificationCenterClient
      initialFilter={filter}
      initialPending
      initialScope={getExperienceContext(context).scope}
      actionContent={<Suspense fallback={<p role="status" className="p-3 text-sm text-zinc-500"><WorkspaceText text="Loading action items…" /></p>}><NotificationActions context={context} /></Suspense>}
    />
  );
}

async function NotificationActions({ context }: { context: CurrentBusinessContext }) {
  const pending = await getWorkspacePendingSummary(context);
  const items = pending.previewItems.filter(item => item.source !== "app");
  if (!items.length) return null;
  return <section className="border-b border-zinc-100 p-3"><h2 className="mb-2 text-sm font-bold"><WorkspaceText text="Needs action" /> <span className="text-zinc-500">({items.length})</span></h2><NotificationFeedList compact items={items} /></section>;
}

export default withExperiencePage(NotificationsPage);
