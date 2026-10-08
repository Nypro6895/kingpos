import "server-only";
import { cache } from "react";
import { getCurrentPlatformAdminContext } from "./auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { callPlatformAdminRpc } from "./rpc";
import { listSupportInbox } from "./inbox";
import { searchPlatformAdminReports } from "./reports";
import { searchPlatformAdminUsers } from "./users";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { DASHBOARD_QUEUE_PERMISSIONS, type DashboardQueueItem, type DashboardQueueKind, type DashboardQueueSource } from "@/lib/admin-dashboard-model";
import type { BusinessClaimRequest } from "@/lib/business-claims";
import type { SalonVerificationRequest } from "@/lib/salon-identity";
import type { DashboardRecoveryCase, DashboardSafetyCase } from "@/types/admin-dashboard";
import type { PlatformAdminPageResult } from "@/types/platform-admin";

export const loadAdminNavigationCounts = cache(async (): Promise<Record<string, number>> => {
  const actor = await getCurrentPlatformAdminContext();
  if (!actor) return {};
  const can = (permission: typeof P[keyof typeof P]) => actor.permissions.includes(permission);
  const client = await createAuthenticatedSupabaseServerClient();
  const results = await Promise.allSettled([
    can(P.dashboardRead) ? callPlatformAdminRpc<Record<string, number | null>>("get_platform_admin_work_queues") : Promise.resolve(null),
    can(P.inboxRead) ? listSupportInbox({ pageSize: "1" }) : Promise.resolve(null),
    can(P.reportsRead) && client ? client.from("post_safety_cases").select("id", { count: "exact", head: true }).eq("status", "pending") : Promise.resolve(null),
    can(P.recoveryRead) && client ? client.from("account_recovery_requests").select("id", { count: "exact", head: true }).in("status", ["open", "reviewing", "needs_info"]) : Promise.resolve(null),
  ]);
  const counts: Record<string, number> = {};
  const [queues, inbox, safety, recovery] = results;
  if (queues.status === "fulfilled" && queues.value) {
    for (const [key, href] of [["claims", "/admin/claims"], ["verification", "/admin/verification"], ["cases", "/admin/reports"]]) {
      const count = queues.value[key]; if (count != null) counts[href] = count;
    }
  }
  if (inbox.status === "fulfilled" && inbox.value) counts["/admin/inbox"] = inbox.value.counts.new + inbox.value.counts.in_progress;
  if (safety.status === "fulfilled" && safety.value && !safety.value.error && safety.value.count != null) counts["/admin/post-safety"] = safety.value.count;
  if (recovery.status === "fulfilled" && recovery.value && !recovery.value.error && recovery.value.count != null) counts["/admin/recovery"] = recovery.value.count;
  return counts;
});

// Follow each service's pagination instead of silently truncating the combined queue.
export async function collectAdminPages<T>(load: (page: number) => Promise<PlatformAdminPageResult<T>>) {
  const first = await load(1);
  const items = [...first.items];
  const pages = Math.ceil(first.total / first.page_size);
  for (let start = 2; start <= pages; start += 4) {
    const batch = await Promise.all(Array.from({ length: Math.min(4, pages - start + 1) }, (_, offset) => load(start + offset)));
    for (const page of batch) items.push(...page.items);
  }
  return items;
}

export const loadAdminDashboardWorkspace = cache(async (): Promise<DashboardQueueSource[]> => {
  const actor = await getCurrentPlatformAdminContext();
  if (!actor) return [];
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Admin data service is unavailable.");
  const source = async (kind: DashboardQueueKind, load: () => Promise<DashboardQueueItem[]>): Promise<DashboardQueueSource | null> => {
    if (!actor.permissions.includes(DASHBOARD_QUEUE_PERMISSIONS[kind])) return null;
    try { return { kind, items: await load(), error: null }; }
    catch { return { kind, items: [], error: "This queue could not be loaded. Refresh or open its management page to retry." }; }
  };
  const reference = (id: string) => id.slice(0, 8).toUpperCase();
  const tableRows = async <T,>(table: string, columns: string, statuses: string[]) => {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from(table).select(columns).in("status", statuses).order("created_at").order("id").range(offset, offset + 499);
      if (error) throw new Error("Queue unavailable.");
      rows.push(...(data as unknown as T[]));
      if (!data || data.length < 500) break;
    }
    return rows;
  };
  const results = await Promise.all([
    source("claims", async () => (await callPlatformAdminRpc<BusinessClaimRequest[]>("get_business_claim_requests")).filter(row => row.status === "waiting").map(row => ({
      id: row.id, kind: "claims", title: row.salon_name, reference: reference(row.id), preview: `${row.address} · ${row.applicant_name || "Applicant"}`,
      status: row.status, priority: "normal", createdAt: row.created_at, assignedUserId: null, assignee: null, href: `/admin/claims?status=waiting&q=${encodeURIComponent(row.salon_name)}`,
    }))),
    source("verification", async () => {
      const requests = await callPlatformAdminRpc<SalonVerificationRequest[]>("get_salon_verification_requests");
      const latest = new Map<string, SalonVerificationRequest>();
      for (const row of requests) {
        const current = latest.get(row.salon_id);
        if (!current || row.attempt > current.attempt || row.attempt === current.attempt && row.created_at > current.created_at) latest.set(row.salon_id, row);
      }
      return [...latest.values()].filter(row => row.status === "waiting").map(row => ({
        id: row.id, kind: "verification", title: row.salon_name, reference: reference(row.id), preview: `${row.address} · Application ${row.attempt}`,
        status: row.status, priority: "normal", createdAt: row.submitted_at || row.created_at, assignedUserId: null, assignee: null, href: `/admin/verification?status=waiting&q=${encodeURIComponent(row.salon_name)}`,
      }));
    }),
    source("inbox", async () => {
      const statuses = await Promise.all(["new", "in_progress"].map(status => collectAdminPages(page => listSupportInbox({ status, page: String(page), pageSize: "100" }))));
      return statuses.flat().map(row => ({
        id: row.id, kind: "inbox", title: row.customer_name, reference: reference(row.id), preview: row.preview,
        status: row.status, priority: row.needs_delivery_review ? "high" : "normal", createdAt: row.created_at,
        assignedUserId: row.assigned_user_id, assignee: row.assignee, href: `/admin/inbox/${row.id}`,
      }));
    }),
    source("cases", async () => {
      const statuses = await Promise.all(["new", "under_review", "action_required"].map(status => collectAdminPages(page => searchPlatformAdminReports({ status, page: String(page), pageSize: "100" }))));
      return statuses.flat().map(row => ({
        id: row.id, kind: "cases", title: row.summary, reference: row.report_number, preview: row.subject?.label || row.category,
        status: row.status, priority: row.priority, createdAt: row.created_at, assignedUserId: row.assignee?.user_id ?? null,
        assignee: row.assignee?.display_name ?? null, href: `/admin/reports/${row.id}`,
      }));
    }),
    source("post_safety", async () => (await tableRows<DashboardSafetyCase>("post_safety_cases", "id,reason,origin,source_type,source_id,created_at,platform_report_id,status", ["pending"])).map(row => ({
      id: row.id, kind: "post_safety", title: `Reported post · ${row.reason.replaceAll("_", " ")}`, reference: reference(row.id), preview: `${row.origin === "automatic" ? "Automatic hold" : "User report"} · ${row.source_type.replaceAll("_", " ")}`,
      status: row.status, priority: "normal", createdAt: row.created_at, assignedUserId: null, assignee: null,
      linkedReportId: row.platform_report_id, href: `/admin/post-safety?origin=${row.origin}`,
    }))),
    source("pending_deletion", async () => (await collectAdminPages(page => searchPlatformAdminUsers({ status: "pending_deletion", page: String(page), pageSize: "100" }))).map(row => ({
      id: row.id, kind: "pending_deletion", title: row.display_name || "Unnamed user", reference: reference(row.id), preview: "Account in its deletion grace period",
      status: row.status, priority: "normal", createdAt: row.updated_at, assignedUserId: null, assignee: null, href: `/admin/users/${row.id}`,
    }))),
    source("recovery", async () => (await tableRows<DashboardRecoveryCase>("account_recovery_requests", "id,user_id,request_type,status,priority,risk_level,assigned_to_user_id,created_at", ["open", "reviewing", "needs_info"])).map(row => ({
      id: row.id, kind: "recovery", title: row.request_type.replaceAll("_", " "), reference: reference(row.id), preview: `Account recovery · ${row.risk_level} risk`,
      status: row.status, priority: row.priority, createdAt: row.created_at, assignedUserId: row.assigned_to_user_id,
      assignee: row.assigned_to_user_id === actor.userId ? "You" : row.assigned_to_user_id ? "Assigned admin" : null, href: `/admin/recovery?case=${row.id}`,
    }))),
  ]);
  return results.filter((result): result is DashboardQueueSource => result !== null);
});
