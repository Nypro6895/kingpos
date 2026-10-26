"use client";
import { getAppLocalHost, type AppLocalHost } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";
import { APP_LOCAL_PORTABLE_HTTP_READS, APP_LOCAL_PORTABLE_HTTP_COMMANDS } from "./app-local-portable-http-metadata";

const deviceScope = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function check(signal?: AbortSignal | null) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
function wire(value: AppLocalHttpResponse) {
  if (!value || !Number.isInteger(value.status) || value.status < 200 || value.status > 599 || typeof value.body !== "string" || !value.headers || typeof value.headers !== "object") throw new Error("Invalid POS response.");
  return new Response([204, 205, 304].includes(value.status) ? null : value.body, { status: value.status, headers: value.headers });
}
/** Only the existing outbox owns retries; this transport always makes one attempt. */
async function wait<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  let cancel: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => { cancel = () => reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")); signal?.addEventListener("abort", cancel, { once: true }); });
  try { return await Promise.race([operation, stop]); } finally { if (cancel) signal?.removeEventListener("abort", cancel); }
}
/** Install after other adapters: account requests keep their previous transport. */
export function createAppLocalPortableHttpFetch(options: { scope: () => string | undefined; host?: () => AppLocalHost; fetch?: typeof fetch }): typeof fetch {
  const previous = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const host = (options.host ?? getAppLocalHost)(), scope = options.scope();
    if (!host.isNative || !scope || !deviceScope.test(scope)) return previous(input, init);
    const request = input instanceof Request ? input : undefined, value = request?.url ?? String(input), base = new URL(typeof location === "undefined" ? "https://reylumi.com" : location.href);
    let url: URL; try { url = new URL(value, base); } catch { return previous(input, init); }
    const local = url.protocol === base.protocol && url.hostname === base.hostname && url.port === base.port && !value.startsWith("//");
    if (!(local || url.origin === "https://reylumi.com") || url.hash || url.username || url.password) return previous(input, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const read = method === "GET" ? Object.entries(APP_LOCAL_PORTABLE_HTTP_READS).find(([, rule]) => rule.path === url.pathname) : undefined;
    const command = method === "POST" ? Object.entries(APP_LOCAL_PORTABLE_HTTP_COMMANDS).find(([, rule]) => rule.path === url.pathname) : undefined;
    if (!read && !command) return previous(input, init);
    const signal = init?.signal ?? request?.signal; check(signal);
    if (read) {
      const [name, rule] = read, allowed: readonly string[] = rule.argumentKeys;
      if ([...url.searchParams].some(([key, value]) => !allowed.includes(key) || value.length > 4096 || url.searchParams.getAll(key).length !== 1)) throw new Error("Invalid POS filters.");
      const result = await host.read<AppLocalHttpResponse>(name, Object.fromEntries(url.searchParams), { scope, signal: signal ?? undefined });
      check(signal); if (result.scope !== scope || options.scope() !== scope || !result.data) throw new Error("This POS device changed. Open it again.");
      return wire(result.data);
    }
    if (url.search) throw new Error("Invalid POS request.");
    const text = init?.body !== undefined ? typeof init.body === "string" ? init.body : null : request ? await request.clone().text() : "";
    if (text === null || text.length > 128000) throw new Error("Invalid POS request.");
    let data: unknown; try { data = text ? JSON.parse(text) : {}; } catch { return new Response(null, { status: 400 }); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return new Response(null, { status: 400 });
    check(signal);
    const result = await wait(host.command<AppLocalHttpResponse>(command![0], { input: data }, { scope }), signal);
    if (options.scope() !== scope) throw new Error("This POS device changed. Open it again.");
    return wire(result);
  };
}
export function installAppLocalPortableHttpClient(scope: () => string | undefined) {
  if (typeof window === "undefined" || !getAppLocalHost().isNative) return () => {};
  const previous = window.fetch, bridged = createAppLocalPortableHttpFetch({ scope, fetch: previous.bind(window) }); window.fetch = bridged;
  return () => { if (window.fetch === bridged) window.fetch = previous; };
}
