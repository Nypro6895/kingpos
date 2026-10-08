import "server-only";
import { callPlatformAdminRpc } from "./rpc";
import { assertUuid, parseAdminSearchParams } from "./validation";
import type { PlatformAdminPageResult } from "@/types/platform-admin";

export type AdminNotification = { id: string; recipient_user_id: string; recipient_name: string | null; sender_name: string | null; title: string; body: string; reason: string; delivery_status: "delivered" | "suppressed"; read_at: string | null; created_at: string };
export type DeletionImpact = { salons: Array<{ id: string; name: string; status: string; last_owner: boolean }>; status: string; blocked: boolean; grace_days: number };
export type UserSecurity = { sessions: Array<{ id: string; device_label: string; browser_name: string; os_name: string; device_type: string; created_at: string; last_seen_at: string; revoked_at: string | null }> };

export function getAdminDeletionImpact(userId: string) {
  return callPlatformAdminRpc<DeletionImpact>("get_platform_admin_deletion_impact", { p_user_id: assertUuid(userId) });
}
export function getAdminUserSecurity(userId: string) {
  return callPlatformAdminRpc<UserSecurity>("get_platform_admin_user_security", { p_user_id: assertUuid(userId) });
}
export function listAdminNotifications(input: { page?: string; q?: string; userId?: string }) {
  const search = parseAdminSearchParams(input);
  return callPlatformAdminRpc<PlatformAdminPageResult<AdminNotification>>("list_platform_admin_notifications", { p_page: search.page, p_page_size: search.pageSize, p_query: search.query, p_user_id: input.userId ? assertUuid(input.userId) : null });
}
