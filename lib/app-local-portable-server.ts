import "server-only";

import { createHash } from "node:crypto";
import { requireAppLocalPortableScope } from "./app-local-portable-context-server";
import { getPortablePosDeskData, getPortableCheckInData, getPortableBookData, getPortableTicketData, getPortableReportData } from "@/app/pos/portable/actions";
import { APP_LOCAL_PORTABLE_READS } from "./app-local-portable-metadata";
import { runReadWithDeadline } from "./bounded-get";
import type { AppLocalRead } from "./app-local-host";

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
export async function readAppLocalPortableResource(name: string, args: Record<string, unknown> = {}, options: { scope: string; etag?: string; signal?: AbortSignal }): Promise<AppLocalRead | null> {
  if (!Object.hasOwn(APP_LOCAL_PORTABLE_READS, name)) return null;
  const rule = APP_LOCAL_PORTABLE_READS[name as keyof typeof APP_LOCAL_PORTABLE_READS], allowed: readonly string[] = rule.argumentKeys;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.entries(args).some(([key, value]) => !allowed.includes(key) || typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) fail(400, "Invalid POS filters.");
  if (options.signal?.aborted) throw options.signal.reason;
  const session = await requireAppLocalPortableScope(options.scope, rule.capability);
  if (options.signal?.aborted) throw options.signal.reason;
  const date = args.date as string | undefined;
  const data = await runReadWithDeadline<unknown>(name === "portable.workspace" ? getPortablePosDeskData() : name === "portable.check-in" ? getPortableCheckInData() : name === "portable.book" ? getPortableBookData(date) : name === "portable.ticket" ? getPortableTicketData(date) : getPortableReportData(date), 25000);
  // All original getters recheck capability/device cookies before their RPCs.
  // Where present, their salon identifier must also match the accepted session.
  if (data && typeof data === "object" && "salonId" in data && data.salonId !== session.salon_id) fail(409, "The POS device changed. Open it again.");
  if (options.signal?.aborted) throw options.signal.reason;
  const etag = '"' + createHash("sha256").update(JSON.stringify({ schemaVersion: 1, name, args, scope: options.scope, data })).digest("hex") + '"';
  return { schemaVersion: 1, status: options.etag === etag ? 304 : 200, scope: options.scope, etag, updatedAt: Date.now(), ...(options.etag === etag ? {} : { data }) };
}
