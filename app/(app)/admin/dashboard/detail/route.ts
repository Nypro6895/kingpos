import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { DASHBOARD_QUEUE_PERMISSIONS, isDashboardQueueKind } from "@/lib/admin-dashboard-model";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { assertUuid } from "@/lib/platform-admin/validation";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getSupportThread } from "@/lib/platform-admin/inbox";
import { getPlatformAdminReportDetail } from "@/lib/platform-admin/reports";
import { getPlatformAdminUserDetail } from "@/lib/platform-admin/users";
import { listPlatformAdminNotes } from "@/lib/platform-admin/notes";
import { getSupportEmailConfig, supportEmailReady } from "@/lib/support-email";
import { SUPPORT_EMAIL } from "@/lib/support-rules";
import type { BusinessClaimRequest } from "@/lib/business-claims";
import type { SalonVerificationRequest } from "@/lib/salon-identity";
import type { DashboardDetail, DashboardRecoveryCase, DashboardSafetyCase } from "@/types/admin-dashboard";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  const actor = await getCurrentPlatformAdminContext();
  const kind = request.nextUrl.searchParams.get("kind");
  if (!actor?.permissions.includes(P.dashboardRead) || !isDashboardQueueKind(kind) || !actor.permissions.includes(DASHBOARD_QUEUE_PERMISSIONS[kind])) return NextResponse.json({ error: "Access denied." }, { status: 403, headers });
  let id: string;
  try { id = assertUuid(request.nextUrl.searchParams.get("id")); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400, headers }); }
  const can = (permission: typeof P[keyof typeof P]) => actor.permissions.includes(permission);
  try {
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) throw new Error("Admin data service is unavailable.");
    const notes = async (salonId: string) => can(P.notesRead) ? (await listPlatformAdminNotes({ targetId: salonId, targetType: "location", pageSize: 5 })).items : [];
    let result: DashboardDetail;
    if (kind === "claims") {
      const rows = await callPlatformAdminRpc<BusinessClaimRequest[]>("get_business_claim_requests");
      const row = rows.find(row => row.id === id);
      if (!row) return NextResponse.json({ error: "Request no longer exists." }, { status: 404, headers });
      const listing = await callPlatformAdminRpc<Array<{ claim_state: string }>>("get_public_salon_directory_listing", { target_salon_id: row.salon_id });
      result = { kind, request: { ...row, applicant_email: can(P.usersReadSensitive) ? row.applicant_email : null, phone: can(P.usersReadSensitive) ? row.phone : null }, canApprove: row.status === "waiting" && listing?.[0]?.claim_state === "unclaimed", notes: await notes(row.salon_id), permissions: actor.permissions };
    } else if (kind === "verification") {
      const rows = await callPlatformAdminRpc<SalonVerificationRequest[]>("get_salon_verification_requests");
      const row = rows.find(row => row.id === id);
      if (!row) return NextResponse.json({ error: "Request no longer exists." }, { status: 404, headers });
      const latest = !rows.some(other => other.salon_id === row.salon_id && (other.attempt > row.attempt || other.attempt === row.attempt && other.created_at > row.created_at));
      result = { kind, request: { ...row, phone: can(P.usersReadSensitive) ? row.phone : "" }, latest, notes: await notes(row.salon_id), permissions: actor.permissions };
    } else if (kind === "inbox") {
      const detail = await getSupportThread(id);
      const config = can(P.inboxReply) ? await getSupportEmailConfig().catch(() => null) : null;
      result = { kind, detail, emailReady: Boolean(config && supportEmailReady(config)), emailFrom: config?.from || SUPPORT_EMAIL, permissions: actor.permissions };
    } else if (kind === "cases") {
      const detail = await getPlatformAdminReportDetail(id);
      const assignees = can(P.reportsAssign) ? await callPlatformAdminRpc<Array<{ id: string; name: string; role: string }>>("get_platform_admin_case_assignees") : [];
      result = { kind, detail, assignees, permissions: actor.permissions };
    } else if (kind === "pending_deletion") {
      const detail = await getPlatformAdminUserDetail(id);
      result = { kind, detail: { ...detail, user: { ...detail.user, auth_user_id: can(P.usersReadSensitive) ? detail.user.auth_user_id : null } }, permissions: actor.permissions };
    } else if (kind === "recovery") {
      const { data, error } = await client.from("account_recovery_requests").select("id,user_id,request_type,status,priority,risk_level,assigned_to_user_id,details,resolution_summary,contact_email,contact_phone,created_at").eq("id", id).maybeSingle();
      if (error) throw new Error("Recovery details unavailable.");
      if (!data) return NextResponse.json({ error: "Request no longer exists." }, { status: 404, headers });
      const events = await client.from("account_recovery_request_events").select("id,event_type,note,created_at").eq("request_id", id).order("created_at", { ascending: false }).limit(10);
      if (events.error) throw new Error("Recovery history unavailable.");
      result = { kind, detail: { ...data, contact_email: can(P.usersReadSensitive) ? data.contact_email : null, contact_phone: can(P.usersReadSensitive) ? data.contact_phone : null } as DashboardRecoveryCase, events: events.data ?? [], permissions: actor.permissions };
    } else {
      const { data, error } = await client.from("post_safety_cases").select("id,reason,source_type,source_id,origin,created_at,author_user_id,platform_report_id,matched_keywords,content_snapshot,status").eq("id", id).maybeSingle();
      if (error) throw new Error("Post details unavailable.");
      if (!data) return NextResponse.json({ error: "Request no longer exists." }, { status: 404, headers });
      const detail = data as DashboardSafetyCase;
      const mediaUrls: string[] = [];
      const queue = detail.status === "pending" ? await callPlatformAdminRpc<DashboardSafetyCase[]>("get_post_safety_queue", { p_origin: detail.origin }) : [];
      const mediaFromQueue = queue.find(row => row.id === id)?.media;
      if (mediaFromQueue?.length) {
        for (const media of mediaFromQueue) mediaUrls.push(client.storage.from(media.bucket).getPublicUrl(media.path).data.publicUrl);
      } else if (detail.source_type === "beauty_post") {
        const media = await client.from("beauty_post_media").select("object_path").eq("post_id", detail.source_id);
        if (media.error) throw new Error("Post media unavailable.");
        for (const item of media.data ?? []) mediaUrls.push(client.storage.from("beauty-profile-media").getPublicUrl(item.object_path).data.publicUrl);
      } else if (detail.content_snapshot.media_path) mediaUrls.push(client.storage.from("salon-profile-media").getPublicUrl(detail.content_snapshot.media_path).data.publicUrl);
      result = { kind, detail, mediaUrls, permissions: actor.permissions };
    }
    return NextResponse.json(result, { headers });
  } catch { return NextResponse.json({ error: "Details could not be loaded. Please retry." }, { status: 503, headers }); }
}
