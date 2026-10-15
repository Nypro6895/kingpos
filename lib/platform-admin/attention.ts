import "server-only";
import { callPlatformAdminRpc } from "./rpc";
export type RecentAdminRecord = { id: string; name: string; contact?: string | null; status: string; created_at: string; marked: boolean; address?: string; creator_id?: string | null; creator_name?: string | null; creator_contact?: string | null };
export type NewAccountsOverview = { users_today?: number; salons_today?: number; users?: RecentAdminRecord[]; salons?: RecentAdminRecord[] };
export type AttentionRecord = { target_id: string; target_type: "user" | "location"; name: string; contact: string | null; status: string; reason: string; marked_by: string | null; created_at: string; due_at?: string | null; assigned_user_id?: string | null };
export function getAdminNewAccounts() { return callPlatformAdminRpc<NewAccountsOverview>("get_platform_admin_new_accounts"); }
export function listAdminAttention(page: number, kind: "user" | "location") { return callPlatformAdminRpc<{ items: AttentionRecord[]; total: number }>("list_platform_admin_attention", { p_page: page, p_kind: kind }); }
export function getAdminAccountActivity(userId: string) { return callPlatformAdminRpc<Array<{ id: string; activity_type: string; device_label: string | null; created_at: string }>>("get_platform_admin_account_activity", { p_user_id: userId }); }
export function getAdminAttentionState(kind: "user" | "location", id: string) { return callPlatformAdminRpc<boolean>("get_platform_admin_attention_state", { p_kind: kind, p_id: id }); }
export type AdminFollowup = { target_type: "user" | "location"; target_id: string; reason: string; assigned_user_id: string | null; assignee: string | null; due_at: string | null; updated_at: string; created_at: string; name?: string; status?: string };
export function getAdminFollowup(kind: "user" | "location", id: string) { return callPlatformAdminRpc<AdminFollowup | null>("get_platform_admin_followup", { p_kind: kind, p_id: id }); }
export function getDashboardFollowups() { return callPlatformAdminRpc<{ total: number; due_today: number; overdue: number; items: AdminFollowup[] }>("get_platform_admin_dashboard_followups"); }
export function getDeliveryHealth() { return callPlatformAdminRpc<{ email_failed?: number; email_uncertain?: number; notifications_delivered_today?: number; notifications_suppressed_today?: number }>("get_platform_admin_delivery_health"); }
