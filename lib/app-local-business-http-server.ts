import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { GET } from "@/app/api/business-claims/matches/route";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { APP_LOCAL_BUSINESS_HTTP_READS } from "./app-local-business-http-metadata";
import type { AppLocalRead } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
/** The original active-user endpoint remains the only handler. No caller-selected path or write exists. */
export async function readAppLocalBusinessHttpResource(name: string, args: Record<string, unknown> = {}, options: { scope: string; etag?: string; signal?: AbortSignal }): Promise<AppLocalRead<AppLocalHttpResponse> | null> {
  if (name !== "http.business-claims.matches") return null;
  const rule = APP_LOCAL_BUSINESS_HTTP_READS[name], allowed: readonly string[] = rule.argumentKeys;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.entries(args).some(([key, value]) => !allowed.includes(key) || typeof value !== "string" || value.length > 512)) fail(400, "Unsupported salon search.");
  if (options.signal?.aborted) throw options.signal.reason;
  const current = await headers(); if (current.get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const context = await getRequestBusinessContext();
  if (!context.user) fail(401, "Please sign in again.");
  if (!options.scope || getExperienceContext(context).scope !== options.scope) fail(409, "Your account changed. Open this page again.");
  const url = new URL(rule.path, "https://reylumi.com"); url.search = new URLSearchParams(args as Record<string, string>).toString();
  const forwarded = new Headers(); if (current.get("cookie")) forwarded.set("cookie", current.get("cookie")!);
  const response = await GET(new Request(url, { headers: forwarded, signal: options.signal }));
  const responseHeaders: Record<string, string> = {};
  for (const key of ["content-type", "cache-control"]) { const value = response.headers.get(key); if (value) responseHeaders[key] = value; }
  const data = { status: response.status, headers: responseHeaders, body: await response.text() };
  if (options.signal?.aborted) throw options.signal.reason;
  const etag = '"' + createHash("sha256").update(JSON.stringify([options.scope, name, args, data])).digest("hex") + '"';
  return { schemaVersion: 1, status: 200, scope: options.scope, etag, updatedAt: Date.now(), data };
}
