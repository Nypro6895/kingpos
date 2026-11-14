"use client";
import { LanguageNotifications } from "@/components/salon-language-preferences";
import { WorkspaceText } from "@/components/workspace-language";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NotificationCenterFrame } from "./notification-center-frame";
export { NotificationCenterLoading } from "./notification-center-frame";
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
const EMPTY_ITEMS: NotificationFeedItem[] = [];
export function NotificationCenterClient({
  initialItems = EMPTY_ITEMS,
  initialCursor = null,
  initialError,
  actionItems = EMPTY_ITEMS,
  initialFilter = "all",
  initialPending = false,
  initialScope,
  actionContent,
}: {
  initialItems?: NotificationFeedItem[];
  initialCursor?: NotificationCursor | null;
  initialError?: string;
  actionItems?: NotificationFeedItem[];
  initialFilter?: "all" | "unread";
  /** No authoritative feed seed exists yet; use the original authorized GET. */
  initialPending?: boolean;
  initialScope?: string;
  actionContent?: ReactNode;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState(initialError ?? "");
  const [loading, setLoading] = useState(initialPending);
  const [hasFeed, setHasFeed] = useState(!initialPending && !initialError);
  const [withdrawn, setWithdrawn] = useState(false);
  const [marking, setMarking] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">(initialFilter);
  const version = useRef(0);
  const markVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const current = useRef({ items, cursor, filter, ready: hasFeed });
  useEffect(() => { current.current = { items, cursor, filter, ready: hasFeed }; }, [items, cursor, filter, hasFeed]);
  const anchor = useRef<{ id: string; top: number; scroll: number } | null>(null);
  const experience = useExperienceScope();
  const scope = experience?.context.scope;
  const validate = experience?.validate;
  const admitted = Boolean(scope && experience?.context.authenticated);
  const contextFor = useCallback((next: "all" | "unread") => ({ scope: scope ?? "unscoped-notifications", key: `notifications?filter=${next}` }), [scope]);
  const initial = useMemo(() => ({ items: initialItems, cursor: initialCursor }), [initialItems, initialCursor]);
  const actionSeed = useMemo(() => ({ actionItems, actionContent, initialScope }), [actionItems, actionContent, initialScope]);
  const latestActionSeed = useRef(actionSeed);
  const [rejectedActions, setRejectedActions] = useState<typeof actionSeed | null>(null);
  useLayoutEffect(() => { latestActionSeed.current = actionSeed; }, [actionSeed]);
  const initialStamp = useRef<{ value: NotificationExperienceSnapshot; at: number } | null>(null);
  const rejectedInitial = useRef<NotificationExperienceSnapshot | null>(null);
  const apply = useCallback((snapshot: NotificationExperienceSnapshot, preserveReading = false, ready = true) => {
    if (preserveReading && window.scrollY > 80) {
      const row = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-notification-id]") ?? [])
        .find(element => element.getBoundingClientRect().bottom > 0 && element.getBoundingClientRect().top < window.innerHeight);
      if (row?.dataset.notificationId) anchor.current = { id: row.dataset.notificationId, top: row.getBoundingClientRect().top, scroll: window.scrollY };
    }
    current.current = { ...current.current, ...snapshot, ready };
    setItems(snapshot.items);
    setCursor(snapshot.cursor);
  }, []);
  const renderedScope = useRef(scope);
  useLayoutEffect(() => {
    if (renderedScope.current === scope) return;
    renderedScope.current = scope;
    ++version.current; ++markVersion.current; controller.current?.abort(); busy.current = false;
    rejectedInitial.current = initial;
    setRejectedActions(latestActionSeed.current);
    apply({ items: [], cursor: null }, false, false); setHasFeed(false); setWithdrawn(true); setLoading(true); setMarking(false);
  }, [scope, apply, initial]);
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
      if (!admitted || !active.current || (busy.current && (append || background))) return;
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
        setHasFeed(true);
      } catch (e) {
        if (e instanceof ExperienceResourceAccessError && active.current && requestVersion === version.current) {
          apply({ items: [], cursor: null }, false, false); setHasFeed(false); setWithdrawn(true);
          void validate?.(true);
        }
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
    [scope, contextFor, validate, apply, admitted],
  );
  useEffect(() => {
    active.current = admitted;
    if (!admitted) return;
    let alive = true;
    const update = (event: Event) => {
      const latest = current.current;
      if (!active.current || !latest.ready) return;
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
      if (!active.current) return;
      active.current = false; ++version.current; ++markVersion.current; controller.current?.abort(); busy.current = false;
      rejectedInitial.current = initial;
      setRejectedActions(latestActionSeed.current);
      if (scope) for (const value of ["all", "unread"] as const) experienceResourceCache.forget(contextFor(value));
      apply({ items: [], cursor: null }, false, false); setHasFeed(false); setWithdrawn(true); setLoading(false); setError("");
      setMarking(false);
    };
    window.addEventListener(NOTIFICATIONS_VIEWED, update);
    const subscriptions = (["all", "unread"] as const).map(value => {
      const context = contextFor(value);
      return experienceResourceCache.subscribe(context, () => { if (!experienceResourceCache.isAvailable(context)) reset(); });
    });
    window.addEventListener(NOTIFICATIONS_REFRESH, refresh);
    window.addEventListener("reylumi:experience-mutation", refresh);
    window.addEventListener("reylumi:experience-reset", reset);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const poll = window.setInterval(refresh, 30_000);
    queueMicrotask(() => {
      if (!alive || !active.current) return;
      setWithdrawn(false);
      const context = contextFor(current.current.filter);
      const cached = scope ? experienceResourceCache.get<NotificationExperienceSnapshot>(context) : undefined;
      const acceptedSeed = !initialPending && !initialError && rejectedInitial.current !== initial && (!initialScope || initialScope === scope);
      if (acceptedSeed) {
        if (initialStamp.current?.value !== initial) initialStamp.current = { value: initial, at: Date.now() };
        const initialUpdatedAt = initialStamp.current.at;
        const seeded = cached && cached.updatedAt >= initialUpdatedAt ? cached.data : cached ? reconcileNotificationWindow(cached.data, initial) : initial;
        if (current.current.filter === initialFilter) {
          apply(seeded, true); setHasFeed(true); setLoading(false);
          if (scope) experienceResourceCache.seed(context, seeded, CACHE_POLICY, initialUpdatedAt);
        }
      } else if (cached) { apply(cached.data, true); setHasFeed(true); setLoading(false); }
      if (!acceptedSeed && !cached) void load(current.current.filter);
      else refresh();
    });
    return () => {
      alive = false;
      // These are request generations, not DOM refs; invalidate the live values.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      active.current = false; ++version.current; ++markVersion.current; controller.current?.abort(); busy.current = false;
      setMarking(false);
      window.clearInterval(poll);
      subscriptions.forEach(unsubscribe => unsubscribe());
      window.removeEventListener(NOTIFICATIONS_VIEWED, update);
      window.removeEventListener(NOTIFICATIONS_REFRESH, refresh);
      window.removeEventListener("reylumi:experience-mutation", refresh);
      window.removeEventListener("reylumi:experience-reset", reset);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [scope, contextFor, validate, apply, load, initial, initialFilter, initialPending, initialError, initialScope, admitted]);
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
  const changeFilter = (value: "all" | "unread") => {
    if (!active.current || withdrawn || value === current.current.filter) return;
    const cached = scope ? experienceResourceCache.get<NotificationExperienceSnapshot>(contextFor(value)) : undefined;
    current.current = { items: cached?.data.items ?? [], cursor: cached?.data.cursor ?? null, filter: value, ready: Boolean(cached) };
    setFilter(value); apply(current.current, false, Boolean(cached)); setHasFeed(Boolean(cached)); setError("");
    if (cached?.fresh) {
      ++version.current; controller.current?.abort(); busy.current = false; setLoading(false);
    } else void load(value);
  };
  const actionsAllowed = admitted && !withdrawn && rejectedActions !== actionSeed && (!initialScope || initialScope === scope);
  const actions = actionsAllowed ? actionContent ?? (actionItems.length > 0 ? <section className="border-b border-zinc-100 p-3">
    <h2 className="mb-2 text-sm font-bold"><WorkspaceText text="Needs action" /> <span className="text-zinc-500">({actionItems.length})</span></h2>
    <NotificationFeedList compact items={actionItems} />
  </section> : null) : null;
  return <NotificationCenterFrame filter={filter} onFilterChange={withdrawn || !admitted ? undefined : changeFilter}
    language={withdrawn || !admitted ? undefined : <LanguageNotifications unreadOnly={filter === "unread"} />} actions={actions}
    markDisabled={loading || withdrawn || !hasFeed || !admitted} marking={marking} onMarkViewed={() => {
      if (!active.current || withdrawn) return;
      const generation = ++markVersion.current;
      setMarking(true);
      // The original helper dispatches NOTIFICATIONS_REFRESH after success.
      // Its listener owns the read; starting a second one here would cancel it.
      void markAllCenterViewed()
        .catch(e => { if (active.current && generation === markVersion.current) setError(e.message); })
        .finally(() => { if (active.current && generation === markVersion.current) setMarking(false); });
    }}>
    {error && <div role="alert" className="m-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
      <WorkspaceText text={error} /> <button type="button" className="font-semibold underline" onClick={() => void load(filter)}><WorkspaceText text="Retry" /></button>
    </div>}
    <div ref={list}>{admitted && hasFeed && !withdrawn && <NotificationFeedList items={items} />}</div>
    {(loading || !admitted) && !withdrawn && <p role="status" className="p-4 text-sm text-zinc-500"><WorkspaceText text="Loading notifications…" /></p>}
    <div ref={sentinel} aria-hidden="true" />
    {admitted && cursor && !withdrawn && <button type="button" disabled={loading} className="min-h-10 w-full border-t border-zinc-100 p-3 text-sm font-semibold text-blue-700 disabled:opacity-50" onClick={() => void load(filter, true)}><WorkspaceText text="Load older notifications" /></button>}
  </NotificationCenterFrame>;
}
