"use client";
import { getAppLocalHost, type AppLocalHost } from "./app-local-host";
import { getAppLocalCommandScope } from "./app-local-command-client";
import type { AppLocalHttpResponse } from "./app-local-http-client";
export { APP_LOCAL_PUBLIC_READS, APP_LOCAL_PUBLIC_COMMANDS, APP_LOCAL_PUBLIC_PATHS } from "./app-local-public-metadata";
function response(value: AppLocalHttpResponse) { if (!value || typeof value.body !== "string" || !Number.isInteger(value.status) || value.status < 200 || value.status > 599) throw new Error("Invalid booking response"); return new Response([204, 205, 304].includes(value.status) ? null : value.body, { status: value.status, headers: value.headers }); }
export function createAppLocalPublicHttpFetch(options: { scope: () => string | undefined; host?: () => AppLocalHost; fetch?: typeof fetch }): typeof fetch {
  const original = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const host = (options.host ?? getAppLocalHost)(); if (!host.isNative) return original(input, init);
    const request = input instanceof Request ? input : undefined, value = request?.url ?? String(input), base = new URL(typeof location === "undefined" ? "https://reylumi.com/" : location.href);
    let url: URL; try { url = new URL(value, base); } catch { return original(input, init); }
    const local = !url.username && !url.password && !value.startsWith("//") && !value.includes("\\") && (url.protocol === base.protocol && url.hostname === base.hostname && url.port === base.port || url.protocol === "https:" && url.hostname === "reylumi.com" && !url.port);
    if (!local || url.search || url.hash || (init?.method ?? request?.method ?? "GET").toUpperCase() !== "POST" || !["/api/public-booking/availability", "/api/public-booking/confirm"].includes(url.pathname)) return original(input, init);
    const scope = options.scope(), signal = init?.signal ?? request?.signal; if (signal?.aborted) throw signal.reason; if (!scope) throw new Error("Connect to open booking.");
    const text = init?.body !== undefined ? typeof init.body === "string" ? init.body : null : request ? await request.clone().text() : null;
    if (text === null || text.length > 32768) throw new Error("Invalid booking request");
    let data: unknown; try { data = JSON.parse(text); } catch { return new Response(null, { status: 400 }); } if (!data || typeof data !== "object" || Array.isArray(data)) return new Response(null, { status: 400 });
    if (signal?.aborted) throw signal.reason;
    if (url.pathname === "/api/public-booking/availability") {
      const read = await host.read<AppLocalHttpResponse>("http.public-booking.availability", { input: data }, { scope, signal: signal ?? undefined }); if (scope !== options.scope() || read.scope !== scope || !read.data) throw new Error("Your account has changed."); return response(read.data);
    }
    // Confirmation is one attempt. The original booking idempotency key and
    // all original server checks remain untouched, even after a lost reply.
    const result = await host.command<AppLocalHttpResponse>("http.public-booking.confirm", { input: data }, { scope }); if (scope !== options.scope()) throw new Error("Your account has changed.");
    let body: unknown; try { body = JSON.parse(result.body); } catch { /* Original error body remains intact. */ }
    if (body && typeof body === "object" && (body as { code?: string }).code === "payment_online_required") {
      const salonId = (data as { salonId?: unknown }).salonId; if (typeof salonId === "string" && /^[a-f0-9-]{36}$/i.test(salonId)) await host.openOnline("/book/" + salonId);
    }
    return response(result);
  };
}
export function installAppLocalPublicHttpTransport(scope: () => string | undefined = getAppLocalCommandScope): () => void {
  if (typeof window === "undefined" || !getAppLocalHost().isNative) return () => {};
  const original = window.fetch, bridged = createAppLocalPublicHttpFetch({ scope, fetch: original.bind(window) }); window.fetch = bridged; return () => { if (window.fetch === bridged) window.fetch = original; };
}
