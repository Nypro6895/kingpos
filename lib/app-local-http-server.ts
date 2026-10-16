import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { GET as workspaceGET } from "@/app/api/pos/owner/workspace/route";
import { GET as connectionGET } from "@/app/api/pos/connection/route";
import { POST as receiptPOST } from "@/app/api/pos/owner/operations/route";
import { GET as reportsGET } from "@/app/api/pos/owner/reports/route";
import type { AppLocalRead } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
async function authorized(scope?: string) {
  const currentHeaders = await headers();
  if (currentHeaders.get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const context = await getRequestBusinessContext();
  if (!scope || getExperienceContext(context).scope !== scope) fail(409, "Your workspace has changed.");
  return currentHeaders;
}
async function wire(response: Response): Promise<AppLocalHttpResponse> {
  const selected: Record<string, string> = {};
  for (const name of ["content-type", "cache-control", "etag"]) { const value = response.headers.get(name); if (value) selected[name] = value; }
  return { status: response.status, headers: selected, body: await response.text() };
}

export async function readAppLocalHttpResource(name: string, args: Record<string, unknown> = {}, options: { scope?: string; etag?: string; signal?: AbortSignal } = {}): Promise<AppLocalRead<AppLocalHttpResponse> | null> {
  if (name !== "owner.workspace-patch" && name !== "app.connection" && name !== "owner.report-closing") return null;
  const declared = name === "app.connection" ? [] : name === "owner.report-closing" ? ["view", "date"] : ["resource", "ownerScope", "ids"];
  if (Object.keys(args).some(key => !declared.includes(key)) || Object.values(args).some(value => typeof value !== "string" || value.length > 8192)) fail(400, "Unsupported workspace query");
  if (args.resource !== undefined && !["staff", "catalog", "settings"].includes(String(args.resource))) fail(400, "Unsupported workspace resource");
  if (args.ids !== undefined && (String(args.ids).split(",").length > 100 || String(args.ids).split(",").some(id => !/^[a-f0-9-]{36}$/i.test(id)))) fail(400, "Invalid staff selection");
  if (name === "owner.report-closing" && (args.view !== "closing" || typeof args.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.date))) fail(400, "Unsupported closing query");
  if (options.signal?.aborted) throw options.signal.reason;
  const current = await authorized(options.scope), query = new URLSearchParams(args as Record<string, string>);
  const url = new URL(name === "app.connection" ? "/api/pos/connection" : name === "owner.report-closing" ? "/api/pos/owner/reports" : "/api/pos/owner/workspace", "https://reylumi.com"); url.search = query.toString();
  const requestHeaders = new Headers(); if (current.get("cookie")) requestHeaders.set("cookie", current.get("cookie")!);
  const result = await wire(name === "app.connection" ? connectionGET() : await (name === "owner.report-closing" ? reportsGET : workspaceGET)(new Request(url, { headers: requestHeaders, signal: options.signal })));
  if (options.signal?.aborted) throw options.signal.reason;
  const etag = `"${createHash("sha256").update(JSON.stringify([options.scope, name, Object.keys(args).sort().map(key => [key, args[key]]), result])).digest("hex")}"`;
  return { schemaVersion: 1, status: options.etag === etag ? 304 : 200, scope: options.scope!, etag, updatedAt: Date.now(), ...(options.etag === etag ? {} : { data: result }) };
}

export async function runAppLocalHttpCommand(name: string, args: Record<string, unknown>, request: Request, scope: string): Promise<{ handled: boolean; data?: AppLocalHttpResponse; status?: number }> {
  if (name !== "owner.receipt-operation") return { handled: false };
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) fail(403, "Please open the form again.");
  if (!args || Object.keys(args).some(key => key !== "operation") || !args.operation || typeof args.operation !== "object" || Array.isArray(args.operation)) fail(400, "Invalid receipt request");
  const current = await authorized(scope);
  const forwarded = new Headers({ "Content-Type": "application/json", Origin: origin });
  // Only the current request's cookie crosses this in-process adapter. No
  // client-provided headers, URL, bearer token or signing secret are accepted.
  const cookie = request.headers.get("cookie") ?? current.get("cookie"); if (cookie) forwarded.set("cookie", cookie);
  const body = JSON.stringify(args.operation);
  const result = await wire(await receiptPOST(new NextRequest(new URL("/api/pos/owner/operations", origin), { method: "POST", headers: forwarded, body })));
  return { handled: true, data: result, status: result.status };
}
