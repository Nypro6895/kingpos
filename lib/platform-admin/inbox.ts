import "server-only";
import { callPlatformAdminRpc } from "./rpc";
import { SUPPORT_STATUSES, type SupportStatus } from "@/lib/support-rules";
import { parseAdminSearchParams, assertUuid } from "./validation";

export type SupportThread = { id: string; customer_name: string; customer_email: string; message: string; status: SupportStatus; assigned_user_id: string | null; created_at: string; updated_at: string };
export type SupportInboxItem = Omit<SupportThread, "message"> & { preview: string; assignee: string | null; needs_delivery_review: boolean };
export type SupportInboxList = { items: SupportInboxItem[]; total: number; page: number; page_size: number; counts: Record<SupportStatus, number> };
export type SupportMessage = { id: string; thread_id: string; actor_user_id: string; actor_name: string | null; kind: "email_reply" | "note" | "manual_reply"; body: string; subject: string | null; recipient_email: string | null; delivery_status: "sending" | "sent" | "failed" | "unknown" | "recorded"; provider_message_id: string | null; failure_reason: string | null; created_at: string; sent_at: string | null };
export type SupportThreadDetail = { thread: SupportThread; assignee: string | null; messages: SupportMessage[] };

export async function listSupportInbox(params: { page?: string; pageSize?: string; q?: string; status?: string }) {
  const search = parseAdminSearchParams(params);
  const status = params.status || null;
  if (status && !SUPPORT_STATUSES.includes(status as SupportStatus)) throw new Error("Invalid inbox status.");
  return callPlatformAdminRpc<SupportInboxList>("list_platform_support_inbox", { p_page: search.page, p_page_size: search.pageSize, p_query: search.query, p_status: status });
}

export function getSupportThread(id: string) { return callPlatformAdminRpc<SupportThreadDetail>("get_platform_support_thread", { p_thread_id: assertUuid(id) }); }
