"use client";

import { getAppLocalHost, type AppLocalHost } from "./app-local-host";
import { getAppLocalCommandScope } from "./app-local-command-client";

export type AppLocalHttpResponse = { status: number; headers: Record<string, string>; body: string };
export const APP_LOCAL_HTTP_READS = [
  { name: "owner.workspace-patch", method: "GET", path: "/api/pos/owner/workspace", args: ["resource", "ownerScope", "ids"] },
  { name: "app.connection", method: "GET", path: "/api/pos/connection", args: [] },
  { name: "owner.report-closing", method: "GET", path: "/api/pos/owner/reports", args: ["view", "date"] },
] as const;
export const APP_LOCAL_HTTP_COMMANDS = [
  { name: "owner.receipt-operation", method: "POST", path: "/api/pos/owner/operations", args: ["operation"], replay: "original-idempotent-outbox-only" },
] as const;

function response(value: AppLocalHttpResponse): Response {
  if (!value || !Number.isInteger(value.status) || value.status < 200 || value.status > 599 || typeof value.body !== "string" || !value.headers || typeof value.headers !== "object") throw new Error("Invalid application response");
  return new Response([204, 205, 304].includes(value.status) ? null : value.body, { status: value.status, headers: value.headers });
}
function aborted(signal?: AbortSignal | null) { if (signal?.aborted) throw signal.reason ?? new DOMException("Request cancelled", "AbortError"); }
async function waitCommand<T>(command: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(signal?.reason ?? new DOMException("Request cancelled", "AbortError")); signal?.addEventListener("abort", cancel, { once: true }); });
  try { return await Promise.race([command, cancelled]); }
  finally { if (cancel) signal?.removeEventListener("abort", cancel); }
}

/** Only these original URLs are bridged. Browser fetch and all other URLs keep their transport. */
export function createAppLocalHttpFetch(options: { scope: () => string | undefined; host?: () => AppLocalHost; fetch?: typeof fetch }): typeof fetch {
  const original = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async (input, init) => {
    const host = (options.host ?? getAppLocalHost)();
    if (!host.isNative) return original(input, init);
    const request = input instanceof Request ? input : undefined;
    const value = request?.url ?? String(input), base = typeof location === "undefined" ? "https://reylumi.com" : location.href;
    let url: URL;
    try { url = new URL(value, base); } catch { return original(input, init); }
    const documentUrl = new URL(base);
    // Custom WK schemes have an opaque ("null") origin. Compare their actual
    // authority rather than letting an unrelated opaque URL share that value.
    const sameDocument = url.protocol === documentUrl.protocol && url.hostname === documentUrl.hostname && url.port === documentUrl.port;
    const relative = !/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith("//") && !value.includes("\\");
    const local = !url.username && !url.password && !value.startsWith("//") && (relative || sameDocument || url.protocol === "https:" && url.hostname === "reylumi.com" && !url.port);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const namedRead = APP_LOCAL_HTTP_READS.find(row => row.path === url.pathname && row.method === method);
    const receipt = method === "POST" && url.pathname === APP_LOCAL_HTTP_COMMANDS[0].path;
    if (!local || url.hash || !namedRead && !receipt) return original(input, init);
    const signal = init?.signal ?? request?.signal; aborted(signal);
    const scope = options.scope(); if (!scope) throw new Error("Connect to verify your workspace before uploading.");
    if (namedRead) {
      const declared = new Set<string>(namedRead.args);
      if ([...url.searchParams].some(([key, item]) => !declared.has(key) || item.length > 8192) || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) throw new Error("Unsupported workspace query");
      const headers = new Headers(init?.headers ?? request?.headers);
      const result = await host.read<AppLocalHttpResponse>(namedRead.name, Object.fromEntries(url.searchParams), { scope, signal: signal ?? undefined, etag: headers.get("if-none-match") ?? undefined });
      if (result.scope !== scope) throw new Error("The workspace response belongs to another account.");
      if (result.status === 304) return new Response(null, { status: 304, headers: { ETag: result.etag } });
      if (!result.data) throw new Error("The application response is incomplete");
      return response(result.data);
    }
    if (url.search) throw new Error("Unsupported receipt request");
    const text = init?.body !== undefined ? typeof init.body === "string" ? init.body : null : request ? await request.clone().text() : null;
    if (text === null) throw new Error("Invalid receipt request");
    let operation: unknown;
    try { operation = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
    aborted(signal);
    // Do not forward cancellation to a money command, retry it, or synthesize an
    // OK result. The original outbox retains the operation UUID after ambiguity.
    return response(await waitCommand(host.command<AppLocalHttpResponse>("owner.receipt-operation", { operation }, { scope }), signal));
  };
}

export function installAppLocalHttpClient(scope: () => string | undefined): () => void {
  if (typeof window === "undefined" || !getAppLocalHost().isNative) return () => {};
  const original = window.fetch, bridged = createAppLocalHttpFetch({ scope, fetch: original.bind(window) });
  window.fetch = bridged;
  return () => { if (window.fetch === bridged) window.fetch = original; };
}

export function installAppLocalHttpTransport(scope: () => string | undefined = getAppLocalCommandScope): () => void {
  return installAppLocalHttpClient(scope);
}
