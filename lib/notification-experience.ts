import type { NotificationFeedItem } from "@/types/notifications";
import type { NotificationCursor } from "@/lib/notification-center";

export type NotificationExperienceSnapshot = { items: NotificationFeedItem[]; cursor: NotificationCursor | null };

/** Replace the freshly covered window, preserving older pages outside that window. */
export function reconcileNotificationWindow(previous: NotificationExperienceSnapshot, fresh: NotificationExperienceSnapshot): NotificationExperienceSnapshot {
  if (!fresh.cursor || !fresh.items.length) return fresh;
  const last = fresh.items.at(-1)!;
  const boundary = Date.parse(last.createdAt);
  const incoming = new Set(fresh.items.map(item => item.id));
  const older = previous.items.filter(item => !incoming.has(item.id) && (Date.parse(item.createdAt) < boundary
    || (Date.parse(item.createdAt) === boundary && item.id < last.id)));
  return { items: [...fresh.items, ...older], cursor: older.length ? previous.cursor : fresh.cursor };
}

export function appendNotificationWindow(previous: NotificationExperienceSnapshot, page: NotificationExperienceSnapshot): NotificationExperienceSnapshot {
  return { items: Array.from(new Map([...previous.items, ...page.items].map(item => [item.id, item])).values()), cursor: page.cursor };
}
