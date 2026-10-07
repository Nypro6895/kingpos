"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { confirmNoShowHistory } from "@/components/booking-ui/no-show-confirmation";
import {
  openAppNotificationAction,
  runNotificationBookingAction,
} from "@/app/notifications/actions";
import {
  acceptStaffInviteByRequestFormAction,
  declineStaffInviteByRequestFormAction,
  cancelStaffSalonApplicationFormAction,
} from "@/app/staff/actions";
import {
  NOTIFICATIONS_VIEWED,
  NOTIFICATIONS_REFRESH,
  queueViewedNotification,
  readFeedItems,
} from "@/lib/notification-client";
import type {
  NotificationFeedItem,
  NotificationFeedAction,
} from "@/types/notifications";

function NotificationAvatar({ item }: { item: NotificationFeedItem }) {
  const [failed, setFailed] = useState(false);
  const kind = item.notificationType ?? item.kindLabel.toLowerCase();
  const paths = /booking|appointment/.test(kind)
    ? "M4 5h16v15H4z M8 3v4 M16 3v4 M4 10h16"
    : /comment|reply/.test(kind)
      ? "M4 4h16v12H9l-5 4z"
      : /like/.test(kind)
        ? "M12 20L3 11C-1 3 8 1 12 7C16 1 25 3 21 11z"
        : /receipt|payment/.test(kind)
          ? "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6"
          : /security|login/.test(kind)
            ? "M5 4l7-2 7 2v8c0 5-7 9-7 9s-7-4-7-9z M9 11l2 2 4-4"
            : /post|photo|publication/.test(kind)
              ? "M3 3h18v18H3z M3 17l5-5 4 4 4-7 5 8 M7 7h1"
              : /check_in/.test(kind)
                ? "M4 12l5 5L20 6"
                : /follow/.test(kind)
                  ? "M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M2 21v-3c0-6 14-6 14 0v3 M19 7v6 M16 10h6"
                  : "M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M2 21v-3c0-6 14-6 14 0v3 M18 4l3 3-3 3";
  if (item.thumbnailUrl && !failed)
    return (
      <img
        src={item.thumbnailUrl}
        alt=""
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 rounded-lg object-cover"
      />
    );
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={paths} />
      </svg>
    </span>
  );
}
function NotificationContent({ item }: { item: NotificationFeedItem }) {
  return (
    <>
      <NotificationAvatar item={item} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5 text-zinc-950">
          {item.title}
        </span>
        {item.body && (
          <span className="mt-0.5 block text-xs leading-4 text-zinc-700">
            {item.body}
          </span>
        )}
        <span className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
          {item.meta}
          {item.status && !["read", "unread"].includes(item.status) && (
            <span className="rounded bg-zinc-100 px-1 capitalize">
              {item.status}
            </span>
          )}
        </span>
      </span>
      <span
        aria-label={item.unread ? "Unread" : undefined}
        className={`mt-2 h-2 w-2 rounded-full ${item.unread ? "bg-blue-600" : ""}`}
      />
    </>
  );
}
const buttonClass =
  "inline-flex min-h-9 items-center justify-center rounded-md bg-blue-50 px-3 text-xs font-semibold text-blue-700 disabled:opacity-50";
function NotificationActions({ action }: { action: NotificationFeedAction }) {
  if (action.type === "open-app") return null;
  if (action.type === "staff-invite")
    return (
      <div className="flex gap-2">
        {[
          [acceptStaffInviteByRequestFormAction, "Accept"],
          [declineStaffInviteByRequestFormAction, "Decline"],
        ].map(([handler, label]) => (
          <form
            key={label as string}
            action={handler as typeof acceptStaffInviteByRequestFormAction}
          >
            <input name="request_id" type="hidden" value={action.requestId} />
            <SubmitButton className={buttonClass} type="submit">
              {label as string}
            </SubmitButton>
          </form>
        ))}
      </div>
    );
  if (action.type === "staff-application")
    return (
      <form action={cancelStaffSalonApplicationFormAction}>
        <input name="request_id" type="hidden" value={action.requestId} />
        <SubmitButton className={buttonClass} type="submit">
          Cancel application
        </SubmitButton>
      </form>
    );
  return (
    <Link className={buttonClass} href={action.href}>
      {action.label}
    </Link>
  );
}
function BookingNotificationActions({ item }: { item: NotificationFeedItem }) {
  const [pending, setPending] = useState(false),
    [resolved, setResolved] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const booking = item.booking;
  if (!booking?.actionable || resolved || item.action.type !== "open-app")
    return null;
  const notificationId = item.action.notificationId;
  async function run(command: "confirm" | "cancel") {
    if (lock.current || !booking) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      let result = await runNotificationBookingAction({
        notificationId,
        command,
        expectedUpdatedAt: booking.updatedAt,
      });
      if (result.noShowHistory?.length) {
        if (!(await confirmNoShowHistory(result.noShowHistory))) return;
        result = await runNotificationBookingAction({
          notificationId,
          command,
          expectedUpdatedAt: booking.updatedAt,
          acknowledgeNoShow: true,
        });
      }
      if (!result.ok)
        setError(result.message ?? "Unable to update appointment.");
      else {
        setResolved(true);
        window.dispatchEvent(
          new CustomEvent(NOTIFICATIONS_REFRESH, {
            detail: { newItems: true },
          }),
        );
      }
    } catch {
      setError("Unable to update appointment. Please try again.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          className={buttonClass}
          onClick={() => void run("confirm")}
        >
          {pending ? "Saving..." : "Confirm"}
        </button>
        {booking.recipientKind === "owner_manager" && (
          <button
            type="button"
            disabled={pending}
            className={buttonClass}
            onClick={() => void run("cancel")}
          >
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
function NotificationRow({ item }: { item: NotificationFeedItem }) {
  const rowClass =
    "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5 text-left";
  const action = item.action;
  return (
    <article
      data-notification-id={
        action.type === "open-app" ? action.notificationId : undefined
      }
      data-unread={item.unread}
    >
      {action.type === "open-app" ? (
        <form action={openAppNotificationAction}>
          <input
            name="notification_id"
            type="hidden"
            value={action.notificationId}
          />
          <input name="href" type="hidden" value={action.href} />
          {action.workspaceId && (
            <input
              name="workspace_id"
              type="hidden"
              value={action.workspaceId}
            />
          )}
          <SubmitButton
            className={`${rowClass} hover:bg-zinc-50`}
            type="submit"
          >
            <NotificationContent item={item} />
          </SubmitButton>
        </form>
      ) : (
        <div className={rowClass}>
          <NotificationContent item={item} />
        </div>
      )}
      <div className="pb-2 pl-[3.75rem] pr-3">
        <NotificationActions action={action} />
        <BookingNotificationActions item={item} />
      </div>
    </article>
  );
}
export function NotificationFeedList({
  items,
  emptyLabel = "No notifications yet.",
  compact = false,
}: {
  items: NotificationFeedItem[];
  emptyLabel?: string;
  compact?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [viewed, setViewed] = useState<string[]>([]);
  const [currentItems, setCurrentItems] = useState(items);
  if (currentItems !== items) {
    setCurrentItems(items);
    if (viewed.length) setViewed([]);
  }
  useEffect(() => {
    const update = (event: Event) =>
      setViewed((ids) =>
        Array.from(
          new Set([...ids, ...(event as CustomEvent<string[]>).detail]),
        ),
      );
    window.addEventListener(NOTIFICATIONS_VIEWED, update);
    return () => window.removeEventListener(NOTIFICATIONS_VIEWED, update);
  }, []);
  useEffect(() => {
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const observed = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const existing = timers.get(entry.target);
          if (
            !entry.isIntersecting ||
            entry.intersectionRatio < 0.75 ||
            document.visibilityState !== "visible"
          ) {
            if (existing) clearTimeout(existing);
            timers.delete(entry.target);
            continue;
          }
          if (existing || observed.has(entry.target)) continue;
          timers.set(
            entry.target,
            setTimeout(() => {
              timers.delete(entry.target);
              if (document.visibilityState !== "visible") return;
              const id = (entry.target as HTMLElement).dataset.notificationId;
              if (id) {
                observed.add(entry.target);
                queueViewedNotification(id);
              }
            }, 500),
          );
        }
      },
      { threshold: [0, 0.75, 1] },
    );
    const observe = () =>
      root.current
        ?.querySelectorAll('[data-notification-id][data-unread="true"]')
        .forEach((row) => observer.observe(row));
    observe();
    const hide = () => {
      timers.forEach(clearTimeout);
      timers.clear();
      if (document.visibilityState === "visible") {
        observed.clear();
        observer.disconnect();
        observe();
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [items]);
  if (!items.length)
    return <p className="px-3 py-5 text-sm text-zinc-500">{emptyLabel}</p>;
  return (
    <div
      ref={root}
      data-compact={compact}
      className="divide-y divide-zinc-100 overflow-hidden rounded-md bg-white"
    >
      {readFeedItems(items, viewed).map((item) => (
        <NotificationRow key={item.id} item={item} />
      ))}
    </div>
  );
}
