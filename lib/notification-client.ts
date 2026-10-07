"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CustomerNotificationSummary } from "@/app/customer-shell-context";
import type { NotificationFeedItem } from "@/types/notifications";
export const NOTIFICATIONS_SEED = "kingpos:notifications-seed";
export const NOTIFICATIONS_REFRESH = "kingpos:notifications-refresh";
export const NOTIFICATIONS_VIEWED = "kingpos:notifications-viewed";
const NOTIFICATIONS_COUNT = "kingpos:notifications-count";
const pending = new Set<string>();
const inFlightIds = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
export function queueViewedNotification(id: string) {
  if (inFlightIds.has(id)) return;
  pending.add(id);
  if (timer) return;
  timer = setTimeout(async () => {
    timer = undefined;
    const ids = Array.from(pending).slice(0, 50);
    ids.forEach((id) => {
      pending.delete(id);
      inFlightIds.add(id);
    });
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw Error("Could not save viewed notifications.");
      window.dispatchEvent(
        new CustomEvent(NOTIFICATIONS_VIEWED, { detail: ids }),
      );
      const data = await response.json();
      if (typeof data.unreadCount === "number")
        window.dispatchEvent(
          new CustomEvent(NOTIFICATIONS_COUNT, {
            detail: { count: data.unreadCount, scope: data.scopeKey },
          }),
        );
    } catch {
      window.dispatchEvent(
        new CustomEvent("kingpos:notifications-error", {
          detail:
            "Could not save viewed notifications. Retry by reopening notifications.",
        }),
      );
    } finally {
      ids.forEach((id) => inFlightIds.delete(id));
      if (pending.size) queueViewedNotification(Array.from(pending)[0]);
    }
  }, 150);
}
export function readFeedItems(items: NotificationFeedItem[], ids: string[]) {
  const set = new Set(ids.map((id) => `app:${id}`));
  return items.map((item) =>
    set.has(item.id) ? { ...item, unread: false, status: "read" } : item,
  );
}
function createNotificationStore(
  initial: CustomerNotificationSummary,
  scope: string,
) {
  let snapshot = initial;
  let running: Promise<void> | null = null;
  let refreshedAt = Date.now();
  let disposed = false;
  let hasLiveUpdate = false;
  const listeners = new Set<() => void>();
  let controller = new AbortController();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    scope,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    seed(summary:CustomerNotificationSummary,key:string) {
      if(key!==scope || disposed || hasLiveUpdate)return;
      snapshot=summary;refreshedAt=Date.now();notify();
    },
    snapshot: () => snapshot,
    serverSnapshot: () => initial,
    viewed(ids: string[]) {
      hasLiveUpdate = true;
      const count = snapshot.previewItems.filter(
        (item) => item.unread && ids.includes(item.id.replace(/^app:/, "")),
      ).length;
      snapshot = {
        ...snapshot,
        previewItems: readFeedItems(snapshot.previewItems, ids),
        bookingNotifications: Math.max(
          0,
          snapshot.bookingNotifications - count,
        ),
        total: Math.max(0, snapshot.total - count),
      };
      notify();
    },
    count(count: number, key: string) {
      if (key !== scope) return;
      hasLiveUpdate = true;
      snapshot = { ...snapshot, total: count, bookingNotifications: count };
      notify();
    },
    refresh(force = false) {
      if (running || (!force && Date.now() - refreshedAt < 30000))
        return running;
      running = (async () => {
        try {
          const response = await fetch("/api/notifications?limit=5", {
            cache: "no-store",
            signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok) throw Error(data.error);
          if (disposed) return;
          hasLiveUpdate = true;
          const actionItems = snapshot.previewItems.filter(
            (item) => item.source !== "app",
          );
          snapshot = {
            ...snapshot,
            previewItems: [...data.items, ...actionItems],
            bookingNotifications: data.unreadCount,
            total: data.unreadCount,
          };
          refreshedAt = Date.now();
          notify();
        } catch {
          if (!disposed)
            window.dispatchEvent(
              new CustomEvent("kingpos:notifications-error", {
                detail:
                  "Could not refresh notifications. Showing the last available updates.",
              }),
            );
        } finally {
          running = null;
        }
      })();
      return running;
    },
    activate() {
      disposed = false;
      if (controller.signal.aborted) controller = new AbortController();
    },
    dispose() {
      disposed = true;
      controller.abort();
    },
  };
}
export function useNotificationSummary(
  initial: CustomerNotificationSummary,
  scope: string,
) {
  const store = useMemo(
    () => createNotificationStore(initial, scope),
    [initial, scope],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.serverSnapshot,
  );
  useEffect(() => {
    store.activate();
    const refresh = (event?: Event) => {
      if (document.visibilityState === "visible")
        void store.refresh(
          event instanceof CustomEvent ? event.detail?.force !== false : true,
        );
    };
    const viewed = (event: Event) =>
      store.viewed((event as CustomEvent<string[]>).detail);
    const count = (event: Event) => {
      const detail = (event as CustomEvent<{ count: number; scope: string }>)
        .detail;
      store.count(detail.count, detail.scope);
    };
    const seed=(event:Event)=>{
      const detail=(event as CustomEvent<{summary:CustomerNotificationSummary;scope:string}>).detail;
      store.seed(detail.summary,detail.scope);
    };
    window.addEventListener(NOTIFICATIONS_SEED,seed);
    window.addEventListener(NOTIFICATIONS_REFRESH, refresh);
    window.addEventListener(NOTIFICATIONS_VIEWED, viewed);
    window.addEventListener(NOTIFICATIONS_COUNT, count);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const poll = window.setInterval(refresh, 60000);
    return () => {
      window.removeEventListener(NOTIFICATIONS_SEED,seed);
      window.removeEventListener(NOTIFICATIONS_REFRESH, refresh);
      window.removeEventListener(NOTIFICATIONS_VIEWED, viewed);
      window.removeEventListener(NOTIFICATIONS_COUNT, count);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(poll);
      store.dispose();
    };
  }, [store]);
  return snapshot;
}

export async function markAllCenterViewed() {
  const response = await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ all: true }),
  });
  if (!response.ok) throw Error("Could not mark notifications viewed.");
  window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH));
}
