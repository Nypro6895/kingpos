import "server-only";
import { POST as giftPOST } from "@/app/api/gift-cards/route";
import { POST as rewardPOST } from "@/app/api/rewards/route";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireAppLocalPortableScope } from "./app-local-portable-context-server";
import { APP_LOCAL_PORTABLE_HTTP_READS, APP_LOCAL_PORTABLE_HTTP_COMMANDS } from "./app-local-portable-http-metadata";
import { GET as workspaceGET } from "@/app/api/pos/portable/workspace/route";
import { GET as staffGET } from "@/app/api/pos/portable/staff/route";
import { GET as ticketsGET } from "@/app/api/pos/portable/tickets/route";
import { GET as connectionGET } from "@/app/api/pos/connection/route";
import { POST as operationsPOST } from "@/app/api/pos/portable/operations/route";
import { POST as draftPOST } from "@/app/api/pos/portable/draft/route";
import { POST as preparePOST } from "@/app/api/pos/portable/device/route";
import type { AppLocalHttpResponse } from "./app-local-http-client";
import type { AppLocalRead } from "./app-local-host";

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
async function wire(response: Response): Promise<AppLocalHttpResponse> {
  const selected: Record<string, string> = {}; for (const key of ["content-type", "cache-control"]) { const value = response.headers.get(key); if (value) selected[key] = value; }
  return { status: response.status, headers: selected, body: await response.text() };
}
export async function readAppLocalPortableHttpResource(name: string, args: Record<string, unknown> = {}, options: { scope: string; etag?: string; signal?: AbortSignal }): Promise<AppLocalRead<AppLocalHttpResponse> | null> {
  if (!Object.hasOwn(APP_LOCAL_PORTABLE_HTTP_READS, name)) return null;
  const rule = APP_LOCAL_PORTABLE_HTTP_READS[name as keyof typeof APP_LOCAL_PORTABLE_HTTP_READS], allowed: readonly string[] = rule.argumentKeys;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.entries(args).some(([key, value]) => !allowed.includes(key) || typeof value !== "string" || value.length > 4096)) fail(400, "Invalid POS filters.");
  if (options.signal?.aborted) throw options.signal.reason;
  await requireAppLocalPortableScope(options.scope);
  const current = await headers(), forwarded = new Headers(); if (current.get("cookie")) forwarded.set("cookie", current.get("cookie")!);
  const url = new URL(rule.path, "https://reylumi.com"); url.search = new URLSearchParams(args as Record<string, string>).toString();
  const handlers = { "portable.http.workspace": workspaceGET, "portable.http.staff": staffGET, "portable.http.tickets": ticketsGET, "portable.http.connection": connectionGET };
  const data = await wire(await handlers[name as keyof typeof handlers](new Request(url, { headers: forwarded, signal: options.signal })));
  if (options.signal?.aborted) throw options.signal.reason;
  const etag = '"' + createHash("sha256").update(JSON.stringify([options.scope, name, args, data])).digest("hex") + '"';
  return { schemaVersion: 1, status: 200, scope: options.scope, etag, updatedAt: Date.now(), data };
}
export async function runAppLocalPortableHttpCommand(name: string, args: Record<string, unknown>, request: Request, scope: string): Promise<{ handled: boolean; data?: AppLocalHttpResponse; status?: number }> {
  if (!Object.hasOwn(APP_LOCAL_PORTABLE_HTTP_COMMANDS, name)) return { handled: false };
  const origin = new URL(request.url).origin; if (request.headers.get("origin") !== origin) fail(403, "Please open the POS again.");
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => key !== "input") || !args.input || typeof args.input !== "object" || Array.isArray(args.input)) fail(400, "Invalid POS request.");
  const body = JSON.stringify(args.input); if (body.length > 128000) fail(413, "This POS request is too large.");
  await requireAppLocalPortableScope(scope, name === "portable.http.draft" ? "portable.pos.use" : undefined);
  if (name === "portable.http.operations" && (args.input as { scope?: unknown }).scope !== scope) fail(409, "This POS device changed. Open it again.");
  const current = await headers(), forwarded = new Headers({ "Content-Type": "application/json", Origin: origin }); const cookie = request.headers.get("cookie") ?? current.get("cookie"); if (cookie) forwarded.set("cookie", cookie);
  const handlers = { "portable.http.gift-cards": giftPOST, "portable.http.rewards": rewardPOST, "portable.http.operations": operationsPOST, "portable.http.draft": draftPOST, "portable.http.prepare-device": preparePOST }, rule = APP_LOCAL_PORTABLE_HTTP_COMMANDS[name as keyof typeof APP_LOCAL_PORTABLE_HTTP_COMMANDS];
  const original = await handlers[name as keyof typeof handlers](new NextRequest(new URL(rule.path, origin), { method: "POST", headers: forwarded, body }));
  // This original endpoint returns its HttpOnly device cookie on NextResponse.
  // Carry only that exact cookie to the outer route response; it is never JSON.
  if (name === "portable.http.prepare-device" && original instanceof NextResponse && original.ok) {
    const prepared = original.cookies.get("kingpos-workspace-device");
    if (prepared) (await cookies()).set(prepared);
  }
  const result = await wire(original);
  return { handled: true, status: result.status, data: result };
}
