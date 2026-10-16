"use client";

import { getAppLocalHost, type AppLocalHost } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";

import { ROLE_READS, ROLE_COMMANDS } from "./app-local-platform-types";
export { ROLE_READS, ROLE_COMMANDS } from "./app-local-platform-types";
function response(value: AppLocalHttpResponse) {
  if (!value || !Number.isInteger(value.status) || value.status < 200 || value.status > 599 || typeof value.body !== "string" || !value.headers || typeof value.headers !== "object") throw new Error("Invalid application response");
  return new Response([204, 205, 304].includes(value.status) ? null : value.body, { status: value.status, headers: value.headers });
}
function cancelled(signal?: AbortSignal | null) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
async function commandResponse(operation: Promise<AppLocalHttpResponse>, signal?: AbortSignal | null) {
  let stop: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { stop = () => reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")); signal?.addEventListener("abort", stop, { once: true }); });
  try { return await Promise.race([operation, aborted]); }
  finally { if (stop) signal?.removeEventListener("abort", stop); }
}
/** Compose after the owner adapter: unmatched requests preserve the previous transport. */
export function createAppLocalRoleHttpFetch(options: { scope: () => string | undefined; host?: () => AppLocalHost; fetch?: typeof fetch }): typeof fetch {
  const original = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const host = (options.host ?? getAppLocalHost)(); if (!host.isNative) return original(input, init);
    const request = input instanceof Request ? input : undefined, value = request?.url ?? String(input), base = typeof location === "undefined" ? "https://reylumi.com" : location.href;
    let url: URL; try { url = new URL(value, base); } catch { return original(input, init); }
    const baseURL = new URL(base);
    // Custom-scheme origins can both serialize to "null". Compare the actual authority.
    const sameLocalAuthority = url.protocol === baseURL.protocol && url.hostname === baseURL.hostname && url.port === baseURL.port;
    const local = url.origin === "https://reylumi.com" || sameLocalAuthority && !value.startsWith("//");
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const read = Object.entries(ROLE_READS).find(([, rule]) => rule.path === url.pathname && rule.method === method), command = Object.entries(ROLE_COMMANDS).find(([, rule]) => rule.path === url.pathname && rule.method === method);
    if (!local || url.hash || url.username || url.password || !read && !command) return original(input, init);
    const signal = init?.signal ?? request?.signal; cancelled(signal);
    const scope = options.scope(); if (!scope) throw new Error("Connect to verify your account.");
    if (read) {
      const [name, rule] = read, allowed: readonly string[] = rule.argumentKeys;
      if ([...url.searchParams].some(([key, item]) => !allowed.includes(key) || item.length > 512 || url.searchParams.getAll(key).length !== 1)) throw new Error("Unsupported application query");
      const result = await host.read<AppLocalHttpResponse>(name, Object.fromEntries(url.searchParams), { scope, signal: signal ?? undefined });
      if (result.scope !== scope || options.scope() !== scope || !result.data) throw new Error("Your account has changed. Please reopen this page.");
      return response(result.data);
    }
    if (url.search) throw new Error("Unsupported application request");
    const text = init?.body !== undefined ? typeof init.body === "string" ? init.body : null : request ? await request.clone().text() : null;
    if (text === null || text.length > 64 * 1024) throw new Error("Invalid application request");
    let data: unknown; try { data = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return new Response(null, { status: 400 });
    cancelled(signal);
    // One command attempt. Cancellation never cancels/retries a possibly committed appointment.
    const result = await commandResponse(host.command<AppLocalHttpResponse>(command![0], { input: data }, { scope }), signal);
    if (options.scope() !== scope) throw new Error("Your account has changed. Please reopen this page.");
    if (result.status >= 200 && result.status < 300 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("reylumi:app-local-command-complete", { detail: { scope } }));
    return response(result);
  };
}
export function installAppLocalRoleHttpClient(scope: () => string | undefined) {
  if (typeof window === "undefined" || !getAppLocalHost().isNative) return () => {};
  const previous = window.fetch, bridged = createAppLocalRoleHttpFetch({ scope, fetch: previous.bind(window) }); window.fetch = bridged;
  return () => { if (window.fetch === bridged) window.fetch = previous; };
}
