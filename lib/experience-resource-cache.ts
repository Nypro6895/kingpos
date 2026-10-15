/** Authorized read models only. This cache stays in the current browser's memory. */
export const EXPERIENCE_RESOURCE_MAX_ENTRIES = 30;
export const EXPERIENCE_RESOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const EXPERIENCE_RESOURCE_DEFAULT_FRESH_MS = 30 * 1000;
export const EXPERIENCE_RESOURCE_DEFAULT_RETAIN_MS = 30 * 60 * 1000;
const MAX_RETAIN_MS = 2 * 60 * 60 * 1000;

export type ExperienceResourceContext = { scope: string; key: string };
export type ExperienceResourcePolicy = {
  freshForMs?: number;
  retainForMs?: number;
  tags?: readonly string[];
  force?: boolean;
};
export type ExperienceResourceSnapshot<T> = {
  data: T;
  updatedAt: number;
  freshUntil: number;
  retainUntil: number;
  etag?: string;
  fresh: boolean;
};
export type ExperienceResourceFetchContext<T> = {
  signal: AbortSignal;
  etag?: string;
  cached?: T;
};
export type ExperienceResourceResult<T> = { data: T; etag?: string } | { notModified: true };
export type ExperienceResourceFetcher<T> = (context: ExperienceResourceFetchContext<T>) => Promise<ExperienceResourceResult<T>>;
export type ExperienceResourceInvalidation = { scope?: string; tags?: readonly string[] };
export type ExperienceResourceEvent = "updated" | "invalidated" | "reset" | "availability";

export class ExperienceResourceInvalidatedError extends Error {
  constructor() { super("Resource context changed"); this.name = "ExperienceResourceInvalidatedError"; }
}

/** Throw from an authorized GET on 401/403 or a 409 context mismatch. */
export class ExperienceResourceAccessError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Resource access must be checked again");
    this.name = "ExperienceResourceAccessError";
    this.status = status;
  }
}

type Entry = {
  context: ExperienceResourceContext;
  data: unknown;
  updatedAt: number;
  freshUntil: number;
  retainUntil: number;
  etag?: string;
  tags: Set<string>;
  bytes: number;
};
type Pending = { context: ExperienceResourceContext; tags: Set<string>; startedAt: number; controller: AbortController; promise: Promise<unknown> };
type Listener = (event: ExperienceResourceEvent) => void;

/** Sort query names, preserving repeated-value order and the caller's domain/date key. */
export function normalizeExperienceResourceKey(key: string): string {
  const trimmed = key.trim();
  const question = trimmed.indexOf("?");
  if (question < 0) return trimmed;
  const query = new URLSearchParams(trimmed.slice(question + 1));
  query.sort();
  return trimmed.slice(0, question) + (query.size ? `?${query.toString()}` : "");
}

function normalizeContext(context: ExperienceResourceContext): ExperienceResourceContext {
  if (!context || typeof context.scope !== "string" || typeof context.key !== "string") throw new TypeError("Resource scope and key are required");
  const scope = context.scope.trim();
  const key = normalizeExperienceResourceKey(context.key);
  if (!scope || scope.length > 8192 || !key || key.length > 4096) throw new TypeError("Invalid resource context");
  return { scope, key };
}

export function getExperienceResourceIdentity(context: ExperienceResourceContext): string {
  const normalized = normalizeContext(context);
  return JSON.stringify([normalized.scope, normalized.key]);
}

function tagsFor(tags?: readonly string[]): Set<string> {
  return new Set((tags ?? []).filter(tag => typeof tag === "string" && tag.length > 0 && tag.length <= 128).slice(0, 32));
}

function times(policy: ExperienceResourcePolicy) {
  const retainForMs = Math.min(MAX_RETAIN_MS, Number.isFinite(policy.retainForMs) ? Math.max(0, policy.retainForMs!) : EXPERIENCE_RESOURCE_DEFAULT_RETAIN_MS);
  const freshForMs = Math.min(retainForMs, Number.isFinite(policy.freshForMs) ? Math.max(0, policy.freshForMs!) : EXPERIENCE_RESOURCE_DEFAULT_FRESH_MS);
  return { retainForMs, freshForMs };
}

function matches(context: ExperienceResourceContext, tags: Set<string>, filter: ExperienceResourceInvalidation) {
  return (!filter.scope || filter.scope.trim() === context.scope)
    && (!filter.tags?.length || filter.tags.some(tag => tags.has(tag)));
}

export function createExperienceResourceCache(options: {
  maxEntries?: number;
  maxBytes?: number;
  now?: () => number;
  canUse?: () => boolean;
} = {}) {
  const maxEntries = Math.max(1, Math.min(EXPERIENCE_RESOURCE_MAX_ENTRIES, options.maxEntries ?? EXPERIENCE_RESOURCE_MAX_ENTRIES));
  const maxBytes = Math.max(1, Math.min(EXPERIENCE_RESOURCE_MAX_BYTES, options.maxBytes ?? EXPERIENCE_RESOURCE_MAX_BYTES));
  const now = options.now ?? Date.now;
  const canUse = options.canUse ?? (() => true);
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Pending>();
  const listeners = new Map<string, { context: ExperienceResourceContext; callbacks: Set<Listener> }>();
  const revokedScopes = new Set<string>();
  let suspended = false;
  let bytes = 0;
  let revision = 0;

  function available(context: ExperienceResourceContext) { return canUse() && !suspended && !revokedScopes.has(context.scope); }
  function notify(id: string | undefined, event: ExperienceResourceEvent) {
    revision += 1;
    for (const [listenerId, subscription] of listeners) {
      if (id && listenerId !== id) continue;
      for (const listener of subscription.callbacks) listener(event);
    }
  }
  function remove(id: string) {
    const entry = entries.get(id);
    if (entry) { bytes -= entry.bytes; entries.delete(id); }
  }
  function prune() {
    const timestamp = now();
    for (const [id, entry] of entries) if (entry.retainUntil <= timestamp) remove(id);
  }
  function abort(id: string) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    request.controller.abort();
  }
  function get<T>(rawContext: ExperienceResourceContext): ExperienceResourceSnapshot<T> | undefined {
    const context = normalizeContext(rawContext);
    if (!available(context)) return;
    const id = getExperienceResourceIdentity(context);
    const entry = entries.get(id);
    if (!entry) return;
    const timestamp = now();
    if (entry.retainUntil <= timestamp) { remove(id); return; }
    // Map order is the LRU order. No browser storage is involved.
    entries.delete(id);
    entries.set(id, entry);
    return { data: entry.data as T, updatedAt: entry.updatedAt, freshUntil: entry.freshUntil, retainUntil: entry.retainUntil, etag: entry.etag, fresh: entry.freshUntil > timestamp };
  }
  function write<T>(context: ExperienceResourceContext, data: T, policy: ExperienceResourcePolicy, updatedAt: number, etag?: string): boolean {
    if (!available(context)) return false;
    const id = getExperienceResourceIdentity(context);
    let encoded: string | undefined;
    try { encoded = JSON.stringify(data); } catch { return false; }
    if (encoded === undefined) return false;
    const tags = tagsFor(policy.tags);
    // UTF-16 accounting is conservative for serialized JSON; also count keys and metadata.
    const entryBytes = (encoded.length + id.length + Array.from(tags).join("").length + (etag?.length ?? 0)) * 2 + 128;
    const { retainForMs, freshForMs } = times(policy);
    if (entryBytes > maxBytes || retainForMs === 0) { remove(id); notify(id, "updated"); return false; }
    prune();
    remove(id);
    while (entries.size >= maxEntries || bytes + entryBytes > maxBytes) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      remove(oldest);
    }
    entries.set(id, { context, data, updatedAt, freshUntil: updatedAt + freshForMs, retainUntil: updatedAt + retainForMs, etag, tags, bytes: entryBytes });
    bytes += entryBytes;
    notify(id, "updated");
    return true;
  }
  function seed<T>(rawContext: ExperienceResourceContext, data: T, policy: ExperienceResourcePolicy = {}, updatedAt = now(), etag?: string): boolean {
    const context = normalizeContext(rawContext);
    if (!available(context) || !Number.isFinite(updatedAt) || updatedAt > now()) return false;
    const id = getExperienceResourceIdentity(context);
    const previous = get<T>(context);
    if (previous && previous.updatedAt >= updatedAt) return false;
    // A render of old initial props after resume must not cancel the new live request.
    if ((pending.get(id)?.startedAt ?? -Infinity) >= updatedAt) return false;
    if (updatedAt + times(policy).retainForMs <= now()) return false;
    // A newer authorized server render supersedes an older request already in flight.
    abort(id);
    return write(context, data, policy, updatedAt, etag);
  }
  function reset(scope?: string) {
    const normalizedScope = scope?.trim();
    for (const [id, entry] of entries) if (!normalizedScope || entry.context.scope === normalizedScope) remove(id);
    for (const [id, request] of pending) if (!normalizedScope || request.context.scope === normalizedScope) abort(id);
    for (const [id, subscription] of listeners) if (!normalizedScope || subscription.context.scope === normalizedScope) notify(id, "reset");
    // Even without listeners, change the store revision for a new subscriber.
    revision += 1;
  }
  function revokeScope(scope: string) {
    revokedScopes.add(scope);
    if (revokedScopes.size > maxEntries) { suspended = true; revokedScopes.clear(); reset(); }
    else reset(scope);
  }
  function load<T>(rawContext: ExperienceResourceContext, fetcher: ExperienceResourceFetcher<T>, policy: ExperienceResourcePolicy = {}): Promise<T> {
    const context = normalizeContext(rawContext);
    if (!available(context)) return Promise.reject(new ExperienceResourceInvalidatedError());
    const id = getExperienceResourceIdentity(context);
    const cached = get<T>(context);
    const running = pending.get(id);
    if (running) {
      for (const tag of tagsFor(policy.tags)) running.tags.add(tag);
      return running.promise as Promise<T>;
    }
    if (!policy.force && cached?.fresh) return Promise.resolve(cached.data);
    while (pending.size >= maxEntries) {
      const oldest = pending.keys().next().value;
      if (oldest === undefined) break;
      abort(oldest);
    }
    const controller = new AbortController();
    const request: Pending = { context, tags: tagsFor(policy.tags), startedAt: now(), controller, promise: Promise.resolve(undefined) };
    let rejectAborted: (error: Error) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
    const onAbort = () => rejectAborted(new ExperienceResourceInvalidatedError());
    controller.signal.addEventListener("abort", onAbort, { once: true });
    // Register before starting the fetcher, so synchronous invalidation also has a guard.
    pending.set(id, request);
    const fetched = Promise.resolve().then(() => {
      if (controller.signal.aborted || pending.get(id) !== request) throw new ExperienceResourceInvalidatedError();
      return fetcher({ signal: controller.signal, etag: cached?.etag, cached: cached?.data });
    }).then(result => {
      if (!available(context) || controller.signal.aborted || pending.get(id) !== request) throw new ExperienceResourceInvalidatedError();
      if ("notModified" in result) {
        if (!cached) throw new Error("A resource cannot return 304 without a retained snapshot");
        write(context, cached.data, { ...policy, tags: Array.from(request.tags) }, now(), cached.etag);
        return cached.data;
      }
      write(context, result.data, { ...policy, tags: Array.from(request.tags) }, now(), result.etag);
      return result.data;
    }).catch(error => {
      // An old response must never revoke a newly validated session after reset/resume.
      if (error instanceof ExperienceResourceAccessError && pending.get(id) === request && !controller.signal.aborted) {
        revokeScope(context.scope);
        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
          window.dispatchEvent(new CustomEvent("reylumi:experience-access-changed", { detail: { scope: context.scope, status: error.status } }));
        }
      }
      throw error;
    });
    request.promise = Promise.race([fetched, aborted]).finally(() => {
      controller.signal.removeEventListener("abort", onAbort);
      if (pending.get(id) === request) pending.delete(id);
    });
    // Cache invalidation can abort a request before its consumer attaches a handler.
    void request.promise.catch(() => {});
    return request.promise as Promise<T>;
  }
  function invalidate(filter: ExperienceResourceInvalidation = {}) {
    const changed = new Set<string>();
    for (const [id, request] of pending) if (matches(request.context, request.tags, filter)) { abort(id); changed.add(id); }
    for (const [id, entry] of entries) if (matches(entry.context, entry.tags, filter)) { entry.freshUntil = 0; changed.add(id); }
    for (const id of changed) notify(id, "invalidated");
  }
  function suspend() { suspended = true; reset(); notify(undefined, "availability"); }
  function resume(scope?: string) {
    if (scope) revokedScopes.delete(scope.trim()); else revokedScopes.clear();
    suspended = false;
    notify(undefined, "availability");
  }
  function subscribe(rawContext: ExperienceResourceContext, listener: Listener) {
    const context = normalizeContext(rawContext);
    const id = getExperienceResourceIdentity(context);
    let subscription = listeners.get(id);
    if (!subscription) { subscription = { context, callbacks: new Set() }; listeners.set(id, subscription); }
    subscription.callbacks.add(listener);
    return () => {
      subscription.callbacks.delete(listener);
      if (!subscription.callbacks.size && listeners.get(id) === subscription) listeners.delete(id);
    };
  }

  return {
    get, seed, load, reset, invalidate, suspend, resume, subscribe,
    isAvailable: (context: ExperienceResourceContext) => available(normalizeContext(context)),
    getRevision: () => revision,
    stats: () => { prune(); return { entries: entries.size, bytes, pending: pending.size, suspended, revokedScopes: revokedScopes.size }; },
  };
}

// Never retain a private server render in a process shared by different visitors.
export const experienceResourceCache = createExperienceResourceCache({ canUse: () => typeof window !== "undefined" });
export function resetExperienceResources(scope?: string) { experienceResourceCache.reset(scope); }
export function invalidateExperienceResources(filter: ExperienceResourceInvalidation = {}) { experienceResourceCache.invalidate(filter); }
export function suspendExperienceResources() { experienceResourceCache.suspend(); }
export function resumeExperienceResources(scope?: string) { experienceResourceCache.resume(scope); }
