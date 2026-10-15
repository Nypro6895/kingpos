"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  experienceResourceCache,
  ExperienceResourceInvalidatedError,
  getExperienceResourceIdentity,
  type ExperienceResourceFetcher,
} from "@/lib/experience-resource-cache";

export type UseExperienceResourceOptions<T> = {
  scope: string;
  key: string;
  tags?: readonly string[];
  initialData: T;
  initialUpdatedAt?: number;
  initialEtag?: string;
  freshForMs?: number;
  retainForMs?: number;
  enabled?: boolean;
  fetcher: ExperienceResourceFetcher<T>;
};

/** Warm reads render immediately; current authorization is still checked by every refresh. */
export function useExperienceResource<T>(options: UseExperienceResourceOptions<T>) {
  const { scope, key, initialData, initialUpdatedAt, initialEtag, freshForMs, retainForMs, fetcher, enabled = true } = options;
  const identity = getExperienceResourceIdentity({ scope, key });
  const context = useMemo(() => ({ scope, key }), [scope, key]);
  const tagKey = JSON.stringify(options.tags ?? []);
  const tags = useMemo<readonly string[]>(() => JSON.parse(tagKey), [tagKey]);
  const policy = useMemo(() => ({ tags, freshForMs, retainForMs }), [tags, freshForMs, retainForMs]);
  const initial = useMemo(() => ({ identity, data: initialData, updatedAt: initialUpdatedAt ?? Date.now() }), [identity, initialData, initialUpdatedAt]);
  const seedTimestamp = initial.updatedAt;
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; }, [fetcher]);
  const subscribe = useCallback((listener: () => void) => experienceResourceCache.subscribe(context, listener), [context]);
  useSyncExternalStore(subscribe, experienceResourceCache.getRevision, () => 0);
  const [requestState, setRequestState] = useState<{ identity: string; refreshing: boolean; error: unknown; data?: T; updatedAt?: number; discardInitial?: boolean }>({ identity, refreshing: false, error: undefined });
  const available = typeof window === "undefined" || experienceResourceCache.isAvailable(context);
  const snapshot = experienceResourceCache.get<T>(context);
  // Do not carry a former account's local state into the first render of a new scope.
  const request = requestState.identity === identity ? requestState : undefined;
  const snapshotWins = snapshot && snapshot.updatedAt >= (request?.updatedAt ?? 0) && (request?.discardInitial || snapshot.updatedAt >= seedTimestamp);
  const data = available ? (snapshotWins ? snapshot.data : request?.data ?? (request?.discardInitial ? undefined : initialData)) : undefined;

  const refresh = useCallback(async () => {
    if (!enabled || !experienceResourceCache.isAvailable(context)) return undefined;
    setRequestState(previous => ({ ...(previous.identity === identity ? previous : {}), identity, refreshing: true, error: undefined }));
    try {
      const result = await experienceResourceCache.load(context, fetcherRef.current, { ...policy, force: true });
      setRequestState(previous => previous.identity === identity ? { identity, refreshing: false, error: undefined, data: result, updatedAt: Date.now(), discardInitial: previous.discardInitial } : previous);
      return result;
    } catch (error) {
      setRequestState(previous => previous.identity === identity ? { ...previous, refreshing: false, error: error instanceof ExperienceResourceInvalidatedError ? undefined : error } : previous);
      return undefined;
    }
  }, [enabled, context, identity, policy]);

  useEffect(() => {
    experienceResourceCache.seed(context, initialData, policy, seedTimestamp, initialEtag);
  }, [context, initialData, initialEtag, policy, seedTimestamp]);

  useEffect(() => {
    if (!enabled || !available || !experienceResourceCache.isAvailable(context)) return;
    const current = experienceResourceCache.get<T>(context);
    if (!current?.fresh) void refresh();
  }, [available, context, enabled, refresh]);

  useEffect(() => experienceResourceCache.subscribe(context, event => {
    if (event === "reset") {
      setRequestState(previous => previous.identity === identity ? { identity, refreshing: false, error: undefined, discardInitial: true } : previous);
    }
    if ((event === "invalidated" || event === "availability") && enabled && experienceResourceCache.isAvailable(context)) {
      if (!experienceResourceCache.get<T>(context)?.fresh) void refresh();
    }
  }), [context, enabled, identity, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      if (!experienceResourceCache.isAvailable(context)) return;
      if (!experienceResourceCache.get<T>(context)?.fresh) void refresh();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [context, enabled, refresh]);

  return { data, available, refreshing: available && (request?.refreshing ?? false), error: available ? request?.error : undefined, refresh };
}
