"use client";

import { getAppLocalHost, type AppLocalHost } from "./app-local-host";
import { getAppLocalCommandScope } from "./app-local-command-client";
import type { AppLocalHttpResponse } from "./app-local-http-client";
export { APP_LOCAL_EXPLORE_READS, APP_LOCAL_EXPLORE_COMMANDS, APP_LOCAL_EXPLORE_PATHS } from "./app-local-explore-metadata";

function response(value: AppLocalHttpResponse) {
  if (!value || !Number.isInteger(value.status) || value.status < 200 || value.status > 599 || typeof value.body !== "string" || !value.headers || typeof value.headers !== "object") throw new Error("Incomplete Explore response");
  return new Response([204, 205, 304].includes(value.status) ? null : value.body, { status: value.status, headers: value.headers });
}
function localUrl(value: string) {
  const base = new URL(typeof location === "undefined" ? "https://reylumi.com/" : location.href);
  let url: URL; try { url = new URL(value, base); } catch { return null; }
  if (url.username || url.password || url.hash || value.startsWith("//") || value.includes("\\")) return null;
  return url.protocol === base.protocol && url.hostname === base.hostname && url.port === base.port || url.protocol === "https:" && url.hostname === "reylumi.com" && !url.port ? url : null;
}
function cancelled(signal?: AbortSignal | null) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
export function createAppLocalExploreHttpFetch(options: { scope: () => string | undefined; host?: () => AppLocalHost; fetch?: typeof fetch }): typeof fetch {
  const original = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const host = (options.host ?? getAppLocalHost)(); if (!host.isNative) return original(input, init);
    const request = input instanceof Request ? input : undefined, url = localUrl(request?.url ?? String(input));
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (!url || !(method === "GET" && ["/api/explore/suggestions", "/api/explore/salon-social"].includes(url.pathname) || method === "POST" && ["/api/explore/search", "/api/explore/feed", "/api/explore/area"].includes(url.pathname))) return original(input, init);
    const signal = init?.signal ?? request?.signal; cancelled(signal);
    const scope = options.scope(); if (!scope) throw new Error("Connect to open Explore.");
    let name: string, args: Record<string, unknown>;
    if (method === "GET") {
      const social = url.pathname === "/api/explore/salon-social", keys = social ? ["ids"] : ["q", "location", "category"];
      if ([...url.searchParams].some(([key, value]) => !keys.includes(key) || value.length > (social ? 8192 : 512) || url.searchParams.getAll(key).length !== 1)) throw new Error("Unsupported Explore request");
      name = social ? "http.explore.salon-social" : "http.explore.suggestions"; args = Object.fromEntries(url.searchParams);
    } else {
      if (url.search) throw new Error("Unsupported Explore request");
      const text = init?.body !== undefined ? typeof init.body === "string" ? init.body : null : request ? await request.clone().text() : null;
      if (text === null || text.length > 16384) throw new Error("Invalid Explore request");
      let body: unknown; try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return new Response(null, { status: 400 });
      args = { input: body };
      name = url.pathname === "/api/explore/search" ? "http.explore.search" : url.pathname === "/api/explore/area" ? "http.explore.area" : "http.explore.feed-" + String((body as Record<string, unknown>).mode ?? "page");
      if (!new Set(["http.explore.search", "http.explore.area", "http.explore.feed-page", "http.explore.feed-updates", "http.explore.feed-validate", "http.explore.feed-events"]).has(name)) throw new Error("Unsupported discovery request");
    }
    cancelled(signal);
    // Existing optional feed events keep one command attempt; they are never a
    // persisted read, queued money operation, or retrying generic proxy.
    if (name === "http.explore.feed-events") {
      const value = await host.command<AppLocalHttpResponse>(name, args, { scope });
      if (options.scope() !== scope) throw new Error("Your account has changed.");
      return response(value);
    }
    const value = await host.read<AppLocalHttpResponse>(name, args, { scope, signal: signal ?? undefined });
    if (options.scope() !== scope || value.scope !== scope || !value.data) throw new Error("Your account has changed.");
    return response(value.data);
  };
}
export function installAppLocalExploreHttpTransport(scope: () => string | undefined = getAppLocalCommandScope): () => void {
  if (typeof window === "undefined" || !getAppLocalHost().isNative) return () => {};
  const original = window.fetch, bridged = createAppLocalExploreHttpFetch({ scope, fetch: original.bind(window) }); window.fetch = bridged;
  return () => { if (window.fetch === bridged) window.fetch = original; };
}
