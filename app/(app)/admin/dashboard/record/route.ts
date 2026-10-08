import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { assertUuid } from "@/lib/platform-admin/validation";
import { getPlatformAdminUserDetail } from "@/lib/platform-admin/users";
import { getPlatformAdminLocationDetail } from "@/lib/platform-admin/locations";
import { getPlatformAdminBusinessDetail } from "@/lib/platform-admin/businesses";
import { getAdminFollowup, getAdminAccountActivity } from "@/lib/platform-admin/attention";
import { searchPlatformAdminAuditLogs } from "@/lib/platform-admin/audit";
import { listPlatformAdminNotes } from "@/lib/platform-admin/notes";
import { getAdminDeletionImpact } from "@/lib/platform-admin/workflows";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import type { DashboardRecord } from "@/types/admin-dashboard-record";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  const actor = await getCurrentPlatformAdminContext();
  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "user" && kind !== "location" && kind !== "business") return NextResponse.json({ error: "Invalid record type." }, { status: 400, headers });
  const can = (p: typeof P[keyof typeof P]) => actor?.permissions.includes(p) ?? false;
  if (!actor || !can(P.dashboardRead) || !can(kind === "user" ? P.usersRead : kind === "location" ? P.locationsRead : P.businessesRead)) return NextResponse.json({ error: "Access denied." }, { status: 403, headers });
  let id: string;
  try { id = assertUuid(request.nextUrl.searchParams.get("id")); } catch { return NextResponse.json({ error: "Invalid record ID." }, { status: 400, headers }); }
  try {
    const result: DashboardRecord = { kind, id, name: "", status: "", createdAt: "", href: `/admin/${kind === "user" ? "users" : kind === "location" ? "locations" : "businesses"}/${id}`, facts: [], links: [], followup: null, assignees: [], activity: [], notes: [], permissions: actor.permissions, errors: [], ownAccount: actor.userId === id && kind === "user", deletion: null };
    if (kind === "user") {
      const { user, salon_memberships, organization_memberships, platform_membership } = await getPlatformAdminUserDetail(id);
      result.name = user.display_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unnamed user";
      result.status = user.status; result.createdAt = user.created_at;
      result.facts = [{ label: "Email", value: can(P.usersReadSensitive) ? user.email : "Restricted by your role" }, { label: "Phone", value: can(P.usersReadSensitive) ? user.phone : "Restricted by your role" }, { label: "Role", value: platform_membership?.role_name || (salon_memberships?.some(row => row.status === "active" && row.role.toLowerCase() === "owner") ? "Salon owner" : organization_memberships.some(row => row.status === "active" && row.role.toLowerCase() === "owner") ? "Business owner" : "Standard user") }];
      if (can(P.locationsRead)) result.links.push(...(salon_memberships ?? []).slice(0, 10).map(row => ({ label: row.salon_name, href: `/admin/locations/${row.salon_id}` })));
      if (can(P.businessesRead)) result.links.push(...organization_memberships.slice(0, 10).map(row => ({ label: row.organization_name, href: `/admin/businesses/${row.organization_id}` })));
    } else if (kind === "location") {
      const { location, business } = await getPlatformAdminLocationDetail(id);
      result.name = location.name; result.status = location.status; result.createdAt = location.created_at;
      result.facts = [{ label: "Address", value: [location.address_line1, location.address_line2, location.city, location.state, location.postal_code].filter(Boolean).join(", ") }, { label: "Phone", value: location.phone }, { label: "Business", value: business?.name || null }];
      if (business && can(P.businessesRead)) result.links.push({ label: business.name, href: `/admin/businesses/${business.id}` });
    } else {
      const { business, owner, locations } = await getPlatformAdminBusinessDetail(id);
      result.name = business.name; result.status = business.status; result.createdAt = business.created_at;
      result.facts = [{ label: "Owner", value: can(P.usersRead) ? owner?.display_name || null : "Restricted by your role" }];
      if (owner && can(P.usersRead)) result.links.push({ label: owner.display_name || "Owner", href: `/admin/users/${owner.id}` });
      if (can(P.locationsRead)) result.links.push(...locations.slice(0, 10).map(row => ({ label: row.name, href: `/admin/locations/${row.id}` })));
    }
    const optional = async (label: string, load: () => Promise<void>) => { try { await load(); } catch { result.errors.push(`${label} could not load. Refresh to retry.`); } };
    await Promise.all([
      kind !== "business" ? optional("Follow-up", async () => { result.followup = await getAdminFollowup(kind, id); }) : Promise.resolve(),
      kind !== "business" && can(kind === "user" ? P.usersUpdate : P.locationsUpdateStatus) ? optional("Assignees", async () => { result.assignees = await callPlatformAdminRpc("get_platform_admin_followup_assignees"); }) : Promise.resolve(),
      can(P.notesRead) ? optional("Notes", async () => { result.notes = (await listPlatformAdminNotes({ targetId: id, targetType: kind, pageSize: 10 })).items; }) : Promise.resolve(),
      can(P.auditRead) ? optional("Audit activity", async () => { result.activity.push(...(await searchPlatformAdminAuditLogs({ targetId: id, pageSize: "20" })).items.map(row => ({ id: row.id, title: row.action.replaceAll("_", " ").replaceAll(".", " "), reason: row.reason, createdAt: row.created_at, actor: row.actor?.display_name || "System" }))); }) : Promise.resolve(),
      kind === "user" && can(P.auditRead) ? optional("Account activity", async () => { result.activity.push(...(await getAdminAccountActivity(id)).map(row => ({ id: row.id, title: row.activity_type.replaceAll("_", " "), reason: row.device_label, createdAt: row.created_at, actor: null }))); }) : Promise.resolve(),
      kind === "user" && can(P.usersDelete) && !result.ownAccount ? optional("Deletion impact", async () => { result.deletion = await getAdminDeletionImpact(id); }) : Promise.resolve(),
    ]);
    result.activity.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    result.activity = result.activity.slice(0, 30);
    return NextResponse.json(result, { headers });
  } catch { return NextResponse.json({ error: "This record could not be loaded. Refresh or open its full profile." }, { status: 500, headers }); }
}
