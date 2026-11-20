"use client";

import { getAppLocalHost, type AppLocalHost } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";
import { APP_LOCAL_BUSINESS_HTTP_READS } from "./app-local-business-http-metadata";
export { APP_LOCAL_BUSINESS_HTTP_READS } from "./app-local-business-http-metadata";

/** Compose with previous HTTP adapters. Only the original read-only suggestions URL is pinned. */
export function createAppLocalBusinessHttpFetch(options: { scope: () => string | undefined; host?: () => AppLocalHost; fetch?: typeof fetch }): typeof fetch {
  const original = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const host = (options.host ?? getAppLocalHost)(); if (!host.isNative) return original(input, init);
    const request = input instanceof Request ? input : undefined, value = request?.url ?? String(input), base = typeof location === "undefined" ? "https://reylumi.com" : location.href;
    let url: URL; try { url = new URL(value, base); } catch { return original(input, init); }
    const local = new URL(base), sameAuthority = url.protocol === local.protocol && url.hostname === local.hostname && url.port === local.port;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const rule = APP_LOCAL_BUSINESS_HTTP_READS["http.business-claims.matches"];
    if (!(url.origin === "https://reylumi.com" || sameAuthority && !value.startsWith("//")) || url.pathname !== rule.path || method !== rule.method || url.hash || url.username || url.password) return original(input, init);
    const allowed: readonly string[] = rule.argumentKeys;
    if ([...url.searchParams].some(([key, item]) => !allowed.includes(key) || item.length > 512 || url.searchParams.getAll(key).length !== 1)) throw new Error("Unsupported salon search.");
    const signal = init?.signal ?? request?.signal; if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
    const scope = options.scope(); if (!scope) throw new Error("Connect to verify your account.");
    const result = await host.read<AppLocalHttpResponse>("http.business-claims.matches", Object.fromEntries(url.searchParams), { scope, signal: signal ?? undefined });
    if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
    if (result.scope !== scope || options.scope() !== scope) throw new Error("Your account changed. Open this page again.");
    const response = result.data;
    if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 599 || typeof response.body !== "string" || !response.headers || typeof response.headers !== "object") throw new Error("The salon search response was invalid.");
    return new Response([204, 205, 304].includes(response.status) ? null : response.body, { status: response.status, headers: response.headers });
  };
}
export function installAppLocalBusinessHttpClient(scope: () => string | undefined) {
  if (typeof window === "undefined" || !getAppLocalHost().isNative) return () => {};
  const previous = window.fetch, bridged = createAppLocalBusinessHttpFetch({ scope, fetch: previous.bind(window) }); window.fetch = bridged;
  return () => { if (window.fetch === bridged) window.fetch = previous; };
}
