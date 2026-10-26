"use client";
import { WorkspaceText } from "@/components/workspace-language";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useExperienceScope } from "@/components/experience-scope";
import { experienceResourceCache, ExperienceResourceAccessError } from "@/lib/experience-resource-cache";
import { appendNotificationWindow, reconcileNotificationWindow, type NotificationExperienceSnapshot } from "@/lib/notification-experience";

const CACHE_POLICY = { freshForMs: 15_000, retainForMs: 10 * 60_000, tags: ["notification-center"] };
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
  const list = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const current = useRef({ items, cursor, filter });
  useEffect(() => { current.current = { items, cursor, filter }; }, [items, cursor, filter]);
  const anchor = useRef<{ id: string; top: number; scroll: number } | null>(null);
  const experience = useExperienceScope();
  const scope = experience?.context.scope;
  const validate = experience?.validate;
  const contextFor = useCallback((next: "all" | "unread") => ({ scope: scope ?? "unscoped-notifications", key: `notifications?filter=${next}` }), [scope]);
  const initial = useMemo(() => ({ items: initialItems, cursor: initialCursor }), [initialItems, initialCursor]);
  const initialStamp = useRef<{ value: NotificationExperienceSnapshot; at: number } | null>(null);
  const apply = useCallback((snapshot: NotificationExperienceSnapshot, preserveReading = false) => {
    if (preserveReading && window.scrollY > 80) {
      const row = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-notification-id]") ?? [])
        .find(element => element.getBoundingClientRect().bottom > 0 && element.getBoundingClientRect().top < window.innerHeight);
      if (row?.dataset.notificationId) anchor.current = { id: row.dataset.notificationId, top: row.getBoundingClientRect().top, scroll: window.scrollY };
    }
    current.current = { ...current.current, ...snapshot };
    setItems(snapshot.items);
    setCursor(snapshot.cursor);
  }, []);
  useLayoutEffect(() => {
    const saved = anchor.current;
    anchor.current = null;
    if (!saved || Math.abs(window.scrollY - saved.scroll) > 2) return;
    const row = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-notification-id]") ?? [])
      .find(element => element.dataset.notificationId === saved.id);
    if (row) window.scrollBy({ top: row.getBoundingClientRect().top - saved.top, behavior: "instant" });
  }, [items]);
  const load = useCallback(
    async (next: "all" | "unread", append = false, background = false, force = true) => {
      if (!active.current || (busy.current && (append || background))) return;
      const context = contextFor(next);
      if (scope && !experienceResourceCache.isAvailable(context)) return;
      if (background && !force && scope && experienceResourceCache.get(context)?.fresh) return;
      if (busy.current && scope) experienceResourceCache.invalidate({ scope, tags: CACHE_POLICY.tags });
      busy.current = true;
      const requestVersion = ++version.current;
      controller.current?.abort();
      const requestController = new AbortController();
      controller.current = requestController;
      if (!background) { setLoading(true); setError(""); }
      const previous = current.current.filter === next ? current.current : { items: [], cursor: null };
      try {
        if (validate && !(await validate())) return;
        const fetcher = async ({ signal }: { signal: AbortSignal }) => {
          const abort = () => requestController.abort();
          signal.addEventListener("abort", abort, { once: true });
          try {
            if (signal.aborted || requestController.signal.aborted) throw new DOMException("Aborted", "AbortError");
            const params = new URLSearchParams({ filter: next, limit: String(background ? Math.max(10, Math.min(previous.items.length, 50)) : 10) });
            if (append && previous.cursor) { params.set("before", previous.cursor.at); params.set("id", previous.cursor.id); }
            const response = await fetch(`/api/notifications?${params}`, { cache: "no-store", signal: requestController.signal });
            if ([401, 403, 409].includes(response.status)) throw new ExperienceResourceAccessError(response.status);
            const page = await response.json();
            if (!response.ok) throw Error(page.error);
            const fresh: NotificationExperienceSnapshot = { items: page.items, cursor: page.cursor };
            return { data: append ? appendNotificationWindow(previous, fresh) : background ? reconcileNotificationWindow(previous, fresh) : fresh };
          } finally { signal.removeEventListener("abort", abort); }
        };
        const data = scope ? await experienceResourceCache.load(context, fetcher, { ...CACHE_POLICY, force: true })
          : (await fetcher({ signal: requestController.signal })).data;
        if (!active.current || requestController.signal.aborted || requestVersion !== version.current) return;
        apply(data, background);
      } catch (e) {
        if (e instanceof ExperienceResourceAccessError) void validate?.(true);
        if (!background && active.current && requestVersion === version.current && !requestController.signal.aborted)
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
    [scope, contextFor, validate, apply],
  );
  useEffect(() => {
    active.current = true;
    if (initialStamp.current?.value !== initial) initialStamp.current = { value: initial, at: Date.now() };
    const initialUpdatedAt = initialStamp.current.at;
    const context = contextFor(current.current.filter);
    const cached = scope ? experienceResourceCache.get<NotificationExperienceSnapshot>(context) : undefined;
    const seeded = cached && cached.updatedAt >= initialUpdatedAt ? cached.data : cached ? reconcileNotificationWindow(cached.data, initial) : initial;
    if (current.current.filter === initialFilter) apply(seeded, true);
    if (scope && current.current.filter === initialFilter) experienceResourceCache.seed(context, seeded, CACHE_POLICY, initialUpdatedAt);
    const update = (event: Event) => {
      const latest = current.current;
      const rows = readFeedItems(latest.items, (event as CustomEvent<string[]>).detail);
      const snapshot = { items: latest.filter === "unread" ? rows.filter(item => item.unread) : rows, cursor: latest.cursor };
      apply(snapshot, true);
      if (scope) experienceResourceCache.seed(contextFor(latest.filter), snapshot, CACHE_POLICY);
    };
    const refresh = (event?: Event) => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void load(current.current.filter, false, true, event?.type === NOTIFICATIONS_REFRESH);
    };
    const reset = () => {
      active.current = false; ++version.current; controller.current?.abort(); busy.current = false;
      apply({ items: [], cursor: null }); setLoading(false); setError("");
    };
    window.addEventListener(NOTIFICATIONS_VIEWED, update);
    window.addEventListener(NOTIFICATIONS_REFRESH, refresh);
    window.addEventListener("reylumi:experience-mutation", refresh);
    window.addEventListener("reylumi:experience-reset", reset);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const poll = window.setInterval(refresh, 30_000);
    const restoreFrame = window.requestAnimationFrame(() => { if (active.current) setLoading(false); });
    refresh();
    return () => {
      active.current = false; controller.current?.abort(); busy.current = false;
      window.clearInterval(poll);
      window.cancelAnimationFrame(restoreFrame);
      window.removeEventListener(NOTIFICATIONS_VIEWED, update);
      window.removeEventListener(NOTIFICATIONS_REFRESH, refresh);
      window.removeEventListener("reylumi:experience-mutation", refresh);
      window.removeEventListener("reylumi:experience-reset", reset);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [scope, contextFor, validate, apply, load, initial, initialFilter]);
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
      <section className="content-surface overflow-hidden border-zinc-200 bg-white rounded-none border-y shadow-none">
        <header className="flex items-center gap-2 border-b border-zinc-100 p-4">
          <h1 className="flex-1 text-xl font-bold"><WorkspaceText text="Notifications" /></h1>
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
            <WorkspaceText text="Mark all viewed" />
          </button>
          <Link
            prefetch={false}
            className="text-sm font-semibold text-blue-700"
            href="/settings?section=notifications"
          >
            <WorkspaceText text="Settings" />
          </Link>
        </header>
        {actionItems.length > 0 && (
          <section className="border-b border-zinc-100 p-3">
            <h2 className="mb-2 text-sm font-bold">
              <WorkspaceText text="Needs action" />{" "}
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
              <WorkspaceText text={value === "all" ? "All" : "Unread"} />
            </button>
          ))}
        </div>
        {error && (
          <div
            role="alert"
            className="m-3 rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            <WorkspaceText text={error} />{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void load(filter)}
            >
              <WorkspaceText text="Retry" />
            </button>
          </div>
        )}
        <div ref={list}><NotificationFeedList items={items} /></div>
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
            <WorkspaceText text="Load older notifications" />
          </button>
        )}
        <p className="border-t border-zinc-100 p-3 text-xs text-zinc-500">
          <WorkspaceText text="Updates are marked viewed when they are visible. Items that need action remain until resolved." />
        </p>
      </section>
    </main>
  );
}
