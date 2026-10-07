"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NotificationFeedList } from "@/app/notifications/notification-list";
import {
  markAllCenterViewed,
  NOTIFICATIONS_VIEWED,
  NOTIFICATIONS_REFRESH,
  readFeedItems,
} from "@/lib/notification-client";
import type { NotificationFeedItem } from "@/types/notifications";
import type { NotificationCursor } from "@/lib/notification-center";
export function NotificationCenterClient({
  initialItems,
  initialCursor,
  initialError,
  actionItems,
  initialFilter = "all",
}: {
  initialItems: NotificationFeedItem[];
  initialCursor: NotificationCursor | null;
  initialError?: string;
  actionItems: NotificationFeedItem[];
  initialFilter?: "all" | "unread";
}) {
  const [hasNew, setHasNew] = useState(false);
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState(initialError ?? "");
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">(initialFilter);
  const version = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = (event: Event) =>
      setItems((rows) =>
        readFeedItems(rows, (event as CustomEvent<string[]>).detail),
      );
    const newItems = (event: Event) => {
      if ((event as CustomEvent<{ newItems?: boolean }>).detail?.newItems)
        setHasNew(true);
    };
    window.addEventListener(NOTIFICATIONS_REFRESH, newItems);
    window.addEventListener(NOTIFICATIONS_VIEWED, update);
    return () => {
      window.removeEventListener(NOTIFICATIONS_VIEWED, update);
      window.removeEventListener(NOTIFICATIONS_REFRESH, newItems);
      controller.current?.abort();
    };
  }, []);
  const load = useCallback(
    async (next: "all" | "unread", append = false) => {
      if (append && busy.current) return;
      busy.current = true;
      const requestVersion = ++version.current;
      controller.current?.abort();
      controller.current = new AbortController();
      setLoading(true);
      setError("");
      if (!append) setHasNew(false);
      const params = new URLSearchParams({ filter: next, limit: "10" });
      if (append && cursor) {
        params.set("before", cursor.at);
        params.set("id", cursor.id);
      }
      try {
        const response = await fetch(`/api/notifications?${params}`, {
          cache: "no-store",
          signal: controller.current.signal,
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        if (requestVersion !== version.current) return;
        setItems((previous) =>
          append
            ? Array.from(
                new Map(
                  [...previous, ...data.items].map((item) => [item.id, item]),
                ).values(),
              )
            : data.items,
        );
        setCursor(data.cursor);
      } catch (e) {
        if (
          requestVersion === version.current &&
          !controller.current.signal.aborted
        )
          setError(
            e instanceof Error ? e.message : "Could not load notifications.",
          );
      } finally {
        if (requestVersion === version.current) {
          setLoading(false);
          busy.current = false;
        }
      }
    },
    [cursor],
  );
  useEffect(() => {
    if (!cursor || loading || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          void load(filter, true);
      },
      { rootMargin: "160px" },
    );
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor, loading, error, filter, load]);
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-3 py-4">
      {hasNew && (
        <button
          type="button"
          className="min-h-10 w-full rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-700"
          onClick={() => void load(filter)}
        >
          New updates available Ã‚Â· Refresh
        </button>
      )}
      <section className="content-surface overflow-hidden border-zinc-200 bg-white rounded-none border-y shadow-none">
        <header className="flex items-center gap-2 border-b border-zinc-100 p-4">
          <h1 className="flex-1 text-xl font-bold">Notifications</h1>
          <button
            type="button"
            disabled={loading || marking}
            className="min-h-9 text-xs font-semibold text-blue-700"
            onClick={() => {
              setMarking(true);
              void markAllCenterViewed()
                .then(() => load(filter))
                .catch((e) => setError(e.message))
                .finally(() => setMarking(false));
            }}
          >
            Mark all viewed
          </button>
          <Link
            prefetch={false}
            className="text-sm font-semibold text-blue-700"
            href="/settings?section=notifications"
          >
            Settings
          </Link>
        </header>
        {actionItems.length > 0 && (
          <section className="border-b border-zinc-100 p-3">
            <h2 className="mb-2 text-sm font-bold">
              Needs action{" "}
              <span className="text-zinc-500">({actionItems.length})</span>
            </h2>
            <NotificationFeedList compact items={actionItems} />
          </section>
        )}
        <div className="flex gap-2 p-3">
          {(["all", "unread"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              className={`min-h-9 rounded-full px-4 text-sm font-semibold ${filter === value ? "bg-blue-50 text-blue-700" : "text-zinc-600 hover:bg-zinc-100"}`}
              onClick={() => {
                setFilter(value);
                void load(value);
              }}
            >
              {value === "all" ? "All" : "Unread"}
            </button>
          ))}
        </div>
        {error && (
          <div
            role="alert"
            className="m-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {error}{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void load(filter)}
            >
              Retry
            </button>
          </div>
        )}
        <NotificationFeedList items={items} />
        {loading && (
          <p role="status" className="p-4 text-sm text-zinc-500">
            Loading notificationsÃ¢â‚¬Â¦
          </p>
        )}
        <div ref={sentinel} aria-hidden="true" />
        {cursor && (
          <button
            type="button"
            disabled={loading}
            className="min-h-10 w-full border-t border-zinc-100 p-3 text-sm font-semibold text-blue-700 disabled:opacity-50"
            onClick={() => void load(filter, true)}
          >
            Load older notifications
          </button>
        )}
        <p className="border-t border-zinc-100 p-3 text-xs text-zinc-500">
          Updates are marked viewed when they are visible. Items that need
          action remain until resolved.
        </p>
      </section>
    </main>
  );
}
