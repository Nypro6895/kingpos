import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { getBusinessWorkspaceRecord } from "@/lib/platform-admin/business-workspace";
import { getAdminFollowup } from "@/lib/platform-admin/attention";
import { listPlatformAdminNotes } from "@/lib/platform-admin/notes";
import { searchPlatformAdminAuditLogs } from "@/lib/platform-admin/audit";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { assertUuid } from "@/lib/platform-admin/validation";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import type { BusinessRecord } from "@/types/admin-business-workspace";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  const actor = await getCurrentPlatformAdminContext();
  if (!actor?.permissions.includes(P.locationsRead))
    return NextResponse.json(
      { error: "Access denied." },
      { status: 403, headers },
    );
  let id: string;
  try {
    id = assertUuid(request.nextUrl.searchParams.get("id"));
  } catch {
    return NextResponse.json(
      { error: "Invalid business ID." },
      { status: 400, headers },
    );
  }
  try {
    const business = await getBusinessWorkspaceRecord(id);
    const result: BusinessRecord = {
      business,
      kind: "location",
      id,
      name: business.name,
      status: business.status,
      createdAt: business.created_at,
      href: `/admin/locations/${id}`,
      facts: [],
      links: [],
      followup: null,
      assignees: [],
      activity: [],
      notes: [],
      permissions: actor.permissions,
      errors: [],
      ownAccount: false,
      deletion: null,
    };
    const optional = async (label: string, load: () => Promise<void>) => {
      try {
        await load();
      } catch {
        result.errors.push(`${label} could not load. Refresh to retry.`);
      }
    };
    await Promise.all([
      optional("Follow-up", async () => {
        result.followup = await getAdminFollowup("location", id);
      }),
      actor.permissions.includes(P.dashboardRead) &&
      actor.permissions.includes(P.locationsUpdateStatus)
        ? optional("Assignees", async () => {
            result.assignees = await callPlatformAdminRpc(
              "get_platform_admin_followup_assignees",
            );
          })
        : Promise.resolve(),
      actor.permissions.includes(P.notesRead)
        ? optional("Notes", async () => {
            result.notes = (
              await listPlatformAdminNotes({
                targetId: id,
                targetType: "location",
                pageSize: 20,
              })
            ).items;
          })
        : Promise.resolve(),
      actor.permissions.includes(P.auditRead)
        ? optional("Activity", async () => {
            result.activity = (
              await searchPlatformAdminAuditLogs({
                targetId: id,
                pageSize: "20",
              })
            ).items.map((r) => ({
              id: r.id,
              title: r.action.replaceAll("_", " ").replaceAll(".", " "),
              reason: r.reason,
              createdAt: r.created_at,
              actor: r.actor?.display_name || "System",
            }));
          })
        : Promise.resolve(),
    ]);
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json(
      { error: "Unable to load this business. Refresh to retry." },
      { status: 500, headers },
    );
  }
}
