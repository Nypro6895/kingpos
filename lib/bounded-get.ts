/** Finite read requests. Mutations are sent once and are never replayed here. */
export class ReadConnectionError extends Error {
  readonly status = 503;
  constructor(readonly kind: "timeout" | "network" | "body-limit", message = "Connection temporarily unavailable") {
    super(message);
    this.name = "ReadConnectionError";
  }
}

/** Fixed transport facts only. Names/messages/URLs and abort reasons are excluded. */
export type ReadFailureProvenance = {
  kind: "http" | "timeout" | "network" | "body-limit" | "parent-abort";
  attempts: number;
  /** Status received on the last wire attempt, including before a body failure. */
  upstreamStatus?: number;
  /** Any owned attempt timer actually fired; this alone does not establish cause. */
  ownedTimerFired: boolean;
  parentAborted: boolean;
};

export type BoundedGetOptions = {
  timeoutMs?: number;
  totalTimeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  maxBodyBytes?: number;
  fetcher?: typeof fetch;
  onFailure?: (value: ReadFailureProvenance) => void;
};

function abortError(signal?: AbortSignal | null) {
  return signal?.reason ?? new DOMException("Request cancelled", "AbortError");
}

function wait(delay: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, delay);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

type AttemptFacts = { upstreamStatus?: number; ownedTimerFired: boolean };
async function fetchOnce(input: RequestInfo | URL, init: RequestInit, options: Required<Omit<BoundedGetOptions, "fetcher" | "onFailure">>, fetcher: typeof fetch, facts: AttemptFacts): Promise<Response> {
  const external = init.signal ?? (input instanceof Request ? input.signal : undefined);
  if (external?.aborted) throw abortError(external);
  const controller = new AbortController();
  let rejectAbort: (error: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => { controller.abort(external?.reason); rejectAbort(abortError(external)); };
  external?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    facts.ownedTimerFired = true;
    const error = new ReadConnectionError("timeout");
    controller.abort(error);
    rejectAbort(error);
  }, options.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([Promise.resolve().then(() => fetcher(input, { ...init, signal: controller.signal })), aborted]);
    if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) facts.upstreamStatus = response.status;
    // Include the body in the deadline: headers can arrive while JSON never finishes.
    if (!response.body || response.status === 204 || response.status === 205 || response.status === 304 || init.method === "HEAD") return response;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > options.maxBodyBytes) throw new ReadConnectionError("body-limit", "Response exceeds the read budget");
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const buffered = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperties(buffered, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
    return buffered;
  } catch (error) {
    if (external?.aborted) throw abortError(external);
    if (error instanceof ReadConnectionError) throw error;
    throw new ReadConnectionError("network");
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", cancel);
    if (reader) void reader.cancel().catch(() => {});
  }
}

export async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}, options: BoundedGetOptions = {}): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const safeRead = method === "GET" || method === "HEAD";
  const timeoutMs = Math.max(1, Math.min(30_000, options.timeoutMs ?? 6_000));
  const maxAttempts = safeRead ? Math.max(1, Math.min(2, options.maxAttempts ?? 2)) : 1;
  const retryDelayMs = Math.max(0, Math.min(2_000, options.retryDelayMs ?? 250));
  const totalTimeoutMs = Math.max(1, Math.min(60_000, options.totalTimeoutMs ?? timeoutMs * maxAttempts + retryDelayMs));
  const maxBodyBytes = Math.max(1, Math.min(16 * 1024 * 1024, options.maxBodyBytes ?? 8 * 1024 * 1024));
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = Date.now() + totalTimeoutMs;
  let lastError: unknown;
  let attempts = 0, upstreamStatus: number | undefined, ownedTimerFired = false;
  const observe = (kind: ReadFailureProvenance["kind"]) => {
    if (!safeRead) return;
    try { options.onFailure?.({ kind, attempts, ...(upstreamStatus !== undefined ? { upstreamStatus } : {}), ownedTimerFired, parentAborted: Boolean(signal?.aborted) }); }
    catch { /* Diagnostics cannot change a response, cancellation or retry. */ }
  };
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal?.aborted) throw abortError(signal);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ReadConnectionError("timeout");
      const facts: AttemptFacts = { ownedTimerFired: false };
      attempts++;
      try {
        const response = await fetchOnce(input, { ...init, method, cache: init.cache ?? "no-store" }, {
          timeoutMs: Math.min(timeoutMs, remaining), totalTimeoutMs, maxAttempts, retryDelayMs, maxBodyBytes,
        }, options.fetcher ?? fetch, facts);
        upstreamStatus = facts.upstreamStatus;
        ownedTimerFired ||= facts.ownedTimerFired;
        if (!safeRead || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt + 1 === maxAttempts) {
          if (response.status >= 400) observe("http");
          return response;
        }
      } catch (error) {
        if (signal?.aborted || !safeRead || attempt + 1 === maxAttempts || error instanceof ReadConnectionError && error.kind === "body-limit") throw error;
        lastError = error;
      } finally {
        // A failed later attempt cannot inherit an earlier attempt's HTTP status.
        upstreamStatus = facts.upstreamStatus;
        ownedTimerFired ||= facts.ownedTimerFired;
      }
      const delay = Math.min(retryDelayMs * (attempt + 1), Math.max(0, deadline - Date.now()));
      await wait(delay, signal);
    }
    throw lastError ?? new ReadConnectionError("timeout");
  } catch (error) {
    observe(signal?.aborted ? "parent-abort" : error instanceof ReadConnectionError ? error.kind : "network");
    throw error;
  }
}

export function fetchBoundedGet(input: RequestInfo | URL, init: RequestInit = {}, options: BoundedGetOptions = {}) {
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new TypeError("Bounded GET does not accept mutations");
  return fetchWithDeadline(input, init, options);
}

/** Lazy reads can pass the owned signal to their transport. Existing promises
 * keep their wait-only contract; no mutation is cancelled or replayed here. */
export async function runReadWithDeadline<T>(read: Promise<T> | ((signal: AbortSignal) => Promise<T>), timeoutMs = 12_000): Promise<T> {
  const controller = typeof read === "function" ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new ReadConnectionError("timeout");
        controller?.abort(error);
        reject(error);
      }, Math.max(1, Math.min(30_000, timeoutMs)));
    });
    const pending = typeof read === "function" ? read(controller!.signal) : read;
    return await Promise.race([pending, expired]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
