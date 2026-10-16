"use client";

import { getAppLocalHost, type AppLocalHost } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";
import { APP_LOCAL_DISPLAY_HTTP_READS } from "./app-local-display-metadata";

function check(signal?: AbortSignal | null) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
export function createAppLocalDisplayHttpFetch(options: { scope: () => string | undefined; host?: () => AppLocalHost; fetch?: typeof fetch }): typeof fetch {
  const previous = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const host = (options.host ?? getAppLocalHost)();
    if (!host.isNative) return previous(input, init);
    const request = input instanceof Request ? input : undefined, value = request?.url ?? String(input), base = new URL(typeof location === "undefined" ? "https://reylumi.com" : location.href);
    let url: URL; try { url = new URL(value, base); } catch { return previous(input, init); }
    const local = url.protocol === base.protocol && url.hostname === base.hostname && url.port === base.port;
    if (value.startsWith("//") || value.includes("\\") || !(local || url.origin === "https://reylumi.com") || url.hash || url.username || url.password) return previous(input, init);
    if ((init?.method ?? request?.method ?? "GET").toUpperCase() !== "GET") return previous(input, init);
    const rule = APP_LOCAL_DISPLAY_HTTP_READS.find(row => row.path === url.pathname);
    if (!rule) return previous(input, init);
    if ([...url.searchParams].some(([key, token]) => key !== "token" || token.length > 256 || url.searchParams.getAll(key).length !== 1)) throw new Error("Invalid display request.");
    const signal = init?.signal ?? request?.signal; check(signal);
    // Match the original empty-token entry route without making an account read.
    if (rule.name === "display.http.entry" && !url.searchParams.get("token")) return Response.json({ entry: null });
    const scope = options.scope(); if (!scope) throw new Error("Open this display from POS again.");
    const result = await host.read<AppLocalHttpResponse>(rule.name, Object.fromEntries(url.searchParams), { scope, signal: signal ?? undefined });
    check(signal);
    if (result.scope !== scope || options.scope() !== scope || !result.data) throw new Error("This display changed. Open it from POS again.");
    const response = result.data;
    if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599 || typeof response.body !== "string" || !response.headers || typeof response.headers !== "object") throw new Error("Invalid display response.");
    return new Response([204, 205, 304].includes(response.status) ? null : response.body, { status: response.status, headers: response.headers });
  };
}
export function installAppLocalDisplayHttpClient(scope: () => string | undefined) {
  if (typeof window === "undefined" || !getAppLocalHost().isNative) return () => {};
  const previous = window.fetch, bridged = createAppLocalDisplayHttpFetch({ scope, fetch: previous.bind(window) }); window.fetch = bridged;
  return () => { if (window.fetch === bridged) window.fetch = previous; };
}
