"use client";

import { fetchBoundedGet, fetchWithDeadline } from "./bounded-get";
import type { ExperienceContext } from "./experience-context";
import type { ExperienceOfflineGrant } from "./experience-offline-policy";
import { acceptExperienceOfflineGrant, clearExperienceSnapshots, getExperienceDeviceGeneration } from "./experience-persistent-cache";
import { APP_LOCAL_READ_REQUEST_ID, captureAppLocalReadTrace, newReadRequestId, responseReadTrace } from "./read-request-trace-protocol";

export type AppLocalContext = {
  schemaVersion: 1;
  context: ExperienceContext;
  grant: ExperienceOfflineGrant | null;
  grantStatus?: number;
  offlineState?: "unconfirmed" | "online-only";
  staffOnlineAccess?: { version: 1; staffId: string; viewerId: string; salonId: string; scope: string };
  display: { name: string; language: string; role: string };
  home?: string;
  access?: { ownerWorkspace: boolean; staffWorkspace: boolean; portableWorkspace?: boolean };
  onlineValidatedAt: number;
  offline?: boolean;
};
export type AppLocalRead<T = unknown> = {
  schemaVersion: 1; status: 200 | 304; scope: string; etag: string; updatedAt: number; data?: T; offline?: boolean;
};
export type AppLocalRequestOptions = { signal?: AbortSignal; etag?: string; scope?: string; fresh?: boolean };
export type AppLocalBridgeRequest = {
  version: 1; id: string; kind: "context" | "read" | "command" | "online" | "cache";
  name: string; args: Record<string, unknown>; nonce: string; scopeEpoch: number;
};
export type AppLocalHost = {
  context(path?: string, options?: AppLocalRequestOptions): Promise<AppLocalContext>;
  read<T>(name: string, args?: Record<string, unknown>, options?: AppLocalRequestOptions): Promise<AppLocalRead<T>>;
  command<T>(name: string, args: Record<string, unknown>, options?: { scope?: string }): Promise<T>;
  openOnline(path: string): Promise<void>;
  cache<T>(name: "get" | "remove", args: Record<string, unknown>): Promise<T | null>;
  isNative: boolean;
};

declare global {
  interface Window {
    __reylumiAppLocalTransport?: { request<T = unknown>(request: AppLocalBridgeRequest): Promise<T> };
    __reylumiAppLocalContext?: { version: 1; nonce: string; scopeEpoch: number; generation: string };
  }
}

export function appLocalPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) throw new Error("Invalid application page");
  const url = new URL(value, "https://reylumi.com");
  if (url.origin !== "https://reylumi.com" || url.username || url.password || value.length > 4096) throw new Error("Invalid application page");
  return url.pathname + url.search + url.hash;
}

function nativeAvailable() { return typeof window !== "undefined" && Boolean(window.__reylumiAppLocalTransport && window.__reylumiAppLocalContext); }
const systemRandomUUID = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID.bind(globalThis.crypto) : undefined;
export function appLocalRequestId(): string {
  if (systemRandomUUID) return systemRandomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function nativeRequest<T>(kind: AppLocalBridgeRequest["kind"], name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const bridge = window.__reylumiAppLocalTransport, context = window.__reylumiAppLocalContext;
  if (!bridge || !context || signal?.aborted) throw signal?.reason ?? new Error("The application connection is unavailable");
  const id = appLocalRequestId(), generation = context.generation, epoch = context.scopeEpoch;
  let cancel: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  // Native HTTP has a 20s resource limit. A read may first validate its
  // context, then fetch the page; allow both trips plus bridge delivery time.
  // Lost WebKit callbacks still need to release the UI for an explicit retry.
  const timeoutMs = kind === "read" ? 45_000 : kind === "context" || kind === "cache" && (args.op === "get" || args.op === "remove") ? 25_000 : undefined;
  const cancelNativeRead = () => {
    // A command may already be committed, and hosted navigation owns its
    // lifecycle. Only read/context work can receive native cancellation.
    if (kind !== "read" && kind !== "context") return;
    try { void bridge.request({ version: 1, id: appLocalRequestId(), kind: "cache", name: "cancel", args: { requestId: id }, nonce: context.nonce, scopeEpoch: epoch }).catch(() => {}); } catch {}
  };
  const operation = bridge.request<T>({ version: 1, id, kind, name, args, nonce: context.nonce, scopeEpoch: epoch });
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => {
      cancelNativeRead();
      reject(signal?.reason ?? new DOMException("Request cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    if (timeoutMs !== undefined) deadline = setTimeout(() => {
      cancelNativeRead();
      reject(new DOMException("The application connection took too long. Please try again.", "TimeoutError"));
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([operation, aborted]);
    const current = window.__reylumiAppLocalContext;
    const accepted = kind === "context" && value && typeof value === "object" ? (value as { host?: typeof current }).host : undefined;
    const logout = kind === "command" && name === "shell.logout" && value && typeof value === "object" && (value as {signedOut?:boolean}).signedOut === true ? (value as {host?:typeof current}).host : undefined;
    const logoutAccepted=Boolean(current&&logout&&logout.scopeEpoch===current.scopeEpoch&&logout.nonce===current.nonce&&logout.generation===current.generation);
    if ((current?.generation !== generation || current?.scopeEpoch !== epoch) && !logoutAccepted && !(current?.generation===generation&&accepted?.scopeEpoch === current?.scopeEpoch && accepted?.nonce === current?.nonce && accepted?.generation === current?.generation)) throw new Error("Your account has changed. Please open the page again.");
    return value;
  } finally { if (deadline !== undefined) clearTimeout(deadline); if (cancel) signal?.removeEventListener("abort", cancel); }
}

const webHost: AppLocalHost = {
  isNative: false,
  async context(path = "/market", options = {}) {
    const requestId = newReadRequestId();
    const response = await fetchBoundedGet("/api/app-local/context?" + new URLSearchParams({ path: appLocalPath(path), generation: getExperienceDeviceGeneration() }), { credentials: "same-origin", cache: "no-store", headers: { "X-Reylumi-Staff-Online-Access": "1", ...(requestId ? {[APP_LOCAL_READ_REQUEST_ID]:requestId} : {}) }, signal: options.signal }, { timeoutMs: 10_000, totalTimeoutMs: 10_000, maxAttempts: 1 });
    const trace = responseReadTrace(response,requestId,"context");
    if (!response.ok) {
      if([401,403,409].includes(response.status)){await clearExperienceSnapshots();window.dispatchEvent(new Event("reylumi:app-local-access-changed"));}
      throw captureAppLocalReadTrace(Object.assign(new Error("Connect to verify your account"),{status:response.status}),trace);
    }
    const value = await response.json() as AppLocalContext;
    if (value.schemaVersion !== 1 || !value.context?.scope) throw new Error("Invalid application context");
    if (value.offlineState === "unconfirmed" || value.offlineState === "online-only" || [401,403,409].includes(value.grantStatus ?? 0)) await clearExperienceSnapshots();
    if (value.grant && value.offlineState !== "unconfirmed" && value.offlineState !== "online-only" && ![401,403,409].includes(value.grantStatus ?? 0)) await acceptExperienceOfflineGrant(value.grant);
    return captureAppLocalReadTrace(value,trace);
  },
  async read<T>(name: string, args: Record<string, unknown> = {}, options: AppLocalRequestOptions = {}) {
    const query = new URLSearchParams({ name, args: JSON.stringify(args) });
    if (options.scope) query.set("scope", options.scope);
    const requestId = newReadRequestId();
    const long=query.toString().length>1800, headers:Record<string,string>={...(requestId ? {[APP_LOCAL_READ_REQUEST_ID]:requestId} : {}),...(options.etag?{"If-None-Match":options.etag}:{}),...(long?{"Content-Type":"application/json"}:{})};
    const response = await fetchWithDeadline(long?"/api/app-local/read":"/api/app-local/read?"+query, { method:long?"POST":"GET", credentials: "same-origin", cache: "no-store", signal: options.signal, headers, ...(long?{body:JSON.stringify({name,args,scope:options.scope})}:{}) }, { timeoutMs: 10_000, totalTimeoutMs: 10_000, maxAttempts: 1 });
    const trace = responseReadTrace(response,requestId,"read");
    if (response.status === 304) return captureAppLocalReadTrace({ schemaVersion: 1, status: 304, scope: response.headers.get("x-reylumi-scope") ?? options.scope ?? "", etag: response.headers.get("etag") ?? options.etag ?? "", updatedAt: Date.now() } as AppLocalRead<T>,trace);
    if (!response.ok) throw captureAppLocalReadTrace(Object.assign(new Error(response.status === 401 || response.status === 403 ? "Your access must be checked again" : "Could not update this page"), { status: response.status }),trace);
    const value = await response.json() as AppLocalRead<T>;
    if (value.schemaVersion !== 1 || value.status !== 200 || options.scope && value.scope !== options.scope) throw new Error("The page belongs to a different account");
    return captureAppLocalReadTrace(value,trace);
  },
  async command<T>(name: string, args: Record<string, unknown>, options: { scope?: string } = {}) {
    const response = await fetchWithDeadline("/api/app-local/command", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args, requestId: appLocalRequestId(), scope: options.scope }) }, { timeoutMs: 20_000, totalTimeoutMs: 20_000, maxAttempts: 1 });
    const value = await response.json();
    if (!response.ok || !value.ok) throw Object.assign(new Error(value.error ?? "The change could not be confirmed"),{status:response.status});
    return value.data as T;
  },
  async openOnline(path) { window.location.assign(appLocalPath(path)); },
  async cache() { return null; },
};
const nativeHost: AppLocalHost = {
  isNative: true,
  context(path = "/market", options = {}) { return nativeRequest<AppLocalContext>("context", "context", { path: appLocalPath(path), ...(options.fresh?{fresh:true}:{}) }, options.signal).then(value => captureAppLocalReadTrace(value)); },
  read<T>(name: string, args: Record<string, unknown> = {}, options: AppLocalRequestOptions = {}) { return nativeRequest<AppLocalRead<T>>("read", name, { ...args, ...(options.etag ? { etag: options.etag } : {}), ...(options.scope ? { scope: options.scope } : {}) }, options.signal).then(value => captureAppLocalReadTrace(value)); },
  command<T>(name: string, args: Record<string, unknown>, options: { scope?: string } = {}) { return nativeRequest<T>("command", name, { ...args, ...(options.scope ? { scope: options.scope } : {}) }); },
  openOnline(path) { return nativeRequest("online", "open", { path: appLocalPath(path) }); },
  async cache<T>(operation: "get" | "remove", args: Record<string, unknown>) {
    const value = await nativeRequest<AppLocalRead<unknown> | null>("cache", String(args.name), { op: operation, arguments: args.args ?? {}, scope: args.scope });
    return value ? { data: value.data, revision: value.etag, updatedAt: value.updatedAt } as T : null;
  },
};
export function getAppLocalHost(): AppLocalHost { return nativeAvailable() ? nativeHost : webHost; }
