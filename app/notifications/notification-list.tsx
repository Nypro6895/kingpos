import { openAppNotificationAction } from "@/app/notifications/actions";
import {
  acceptStaffInviteByRequestFormAction,
  cancelStaffSalonApplicationFormAction,
  declineStaffInviteByRequestFormAction,
} from "@/app/staff/actions";
import Link from "next/link";
import type {
  NotificationFeedAction,
  NotificationFeedItem,
} from "@/types/notifications";

function sourceTone(source: NotificationFeedItem["source"]) {
  if (source === "staff") {
    return "bg-amber-100 text-amber-700";
  }

  if (source === "manager") {
    return "bg-emerald-100 text-emerald-700";
  }

  return "bg-blue-100 text-blue-700";
}

function NotificationAvatar({ item }: { item: NotificationFeedItem }) {
  return (
    <span
      className={[
        "grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-black",
        sourceTone(item.source),
      ].join(" ")}
    >
      {item.kindLabel.charAt(0).toUpperCase()}
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status || status === "read" || status === "unread") {
    return null;
  }

  return (
    <span className="w-fit rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-zinc-700">
      {status}
    </span>
  );
}

function UnreadDot({ unread }: { unread: boolean }) {
  if (!unread) {
    return <span aria-hidden="true" className="h-2.5 w-2.5" />;
  }

  return (
    <span
      aria-label="Unread"
      className="mt-5 h-2.5 w-2.5 rounded-full bg-blue-600"
    />
  );
}

function NotificationContent({
  compact,
  item,
}: {
  compact: boolean;
  item: NotificationFeedItem;
}) {
  return (
    <>
      <NotificationAvatar item={item} />
      <span className="min-w-0 py-0.5">
        <span
          className={[
            "block text-zinc-950",
            compact ? "text-sm font-semibold leading-5" : "text-[15px] font-semibold leading-6",
          ].join(" ")}
        >
          {item.title}
        </span>
        {item.body ? (
          <span
            className={[
              "mt-0.5 block text-zinc-700",
              compact ? "line-clamp-2 text-sm leading-5" : "text-sm leading-5",
            ].join(" ")}
          >
            {item.body}
          </span>
        ) : null}
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-blue-600">
          <span>{item.meta}</span>
          <StatusPill status={item.status} />
        </span>
      </span>
      <UnreadDot unread={item.unread} />
    </>
  );
}

function rowClass(compact: boolean, interactive = false) {
  return [
    "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 text-left transition",
    compact ? "px-3 py-2.5" : "px-4 py-3.5",
    interactive ? "hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600" : "",
  ].join(" ");
}

function actionButtonClass(kind: "primary" | "secondary", compact: boolean) {
  return [
    "inline-flex w-full items-center justify-center rounded-md px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2",
    compact ? "min-h-9" : "min-h-10",
    kind === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600"
      : "bg-zinc-200 text-zinc-950 hover:bg-zinc-300 focus-visible:outline-zinc-500",
  ].join(" ");
}

function NotificationActions({
  action,
  compact,
}: {
  action: NotificationFeedAction;
  compact: boolean;
}) {
  if (action.type === "open-app") {
    return null;
  }

  if (action.type === "staff-invite") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <form action={acceptStaffInviteByRequestFormAction}>
          <input name="request_id" type="hidden" value={action.requestId} />
          <button className={actionButtonClass("primary", compact)} type="submit">
            Accept
          </button>
        </form>
        <form action={declineStaffInviteByRequestFormAction}>
          <input name="request_id" type="hidden" value={action.requestId} />
          <button className={actionButtonClass("secondary", compact)} type="submit">
            Decline
          </button>
        </form>
      </div>
    );
  }

  if (action.type === "staff-application") {
    return (
      <form action={cancelStaffSalonApplicationFormAction}>
        <input name="request_id" type="hidden" value={action.requestId} />
        <button className={actionButtonClass("secondary", compact)} type="submit">
          Cancel application
        </button>
      </form>
    );
  }

  return (
    <Link
      className={actionButtonClass(
        action.type === "manager-review" ? "primary" : "secondary",
        compact,
      )}
      href={action.href}
    >
      {action.label}
    </Link>
  );
}

function NotificationRow({
  compact,
  item,
}: {
  compact: boolean;
  item: NotificationFeedItem;
}) {
  if (item.action.type === "open-app") {
    return (
      <article>
        <form action={openAppNotificationAction}>
          <input
            name="notification_id"
            type="hidden"
            value={item.action.notificationId}
          />
          <input name="href" type="hidden" value={item.action.href} />
          {item.action.workspaceId ? (
            <input
              name="workspace_id"
              type="hidden"
              value={item.action.workspaceId}
            />
          ) : null}
          <button className={rowClass(compact, true)} type="submit">
            <NotificationContent compact={compact} item={item} />
          </button>
        </form>
      </article>
    );
  }

  return (
    <article>
      <div className={rowClass(compact)}>
        <NotificationContent compact={compact} item={item} />
      </div>
      <div
        className={[
          "pb-3",
          compact ? "pl-[4.75rem] pr-3" : "pl-[5rem] pr-4",
        ].join(" ")}
      >
        <NotificationActions action={item.action} compact={compact} />
      </div>
    </article>
  );
}

export function NotificationFeedList({
  compact = false,
  emptyLabel = "No notifications yet.",
  items,
}: {
  compact?: boolean;
  emptyLabel?: string;
  items: NotificationFeedItem[];
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm font-medium text-zinc-600">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="divide-y divide-zinc-100 overflow-hidden rounded-md bg-white">
      {items.map((item) => (
        <NotificationRow compact={compact} item={item} key={item.id} />
      ))}
    </div>
  );
}
