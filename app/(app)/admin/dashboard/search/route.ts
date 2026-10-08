import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { searchPlatformAdminUsers } from "@/lib/platform-admin/users";
import { searchPlatformAdminBusinesses } from "@/lib/platform-admin/businesses";
import { searchPlatformAdminLocations } from "@/lib/platform-admin/locations";
import { searchPlatformAdminReports } from "@/lib/platform-admin/reports";
import { listSupportInbox } from "@/lib/platform-admin/inbox";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";

type Result = { id: string; label: string; detail: string; href: string };
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  const actor = await getCurrentPlatformAdminContext();
  if (!actor?.permissions.includes(P.access)) return NextResponse.json({ error: "Access denied." }, { status: 403, headers });
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 100) return NextResponse.json({ groups: [] }, { headers });
  const jobs: Array<{ label: string; load: () => Promise<Result[]> }> = [];
  if (actor.permissions.includes(P.usersRead)) jobs.push({ label: "Users", load: async () => (await searchPlatformAdminUsers({ q, pageSize: "5" })).items.map(row => ({ id: row.id, label: row.display_name || "Unnamed user", detail: row.status, href: `/admin/users/${row.id}` })) });
  if (actor.permissions.includes(P.businessesRead)) jobs.push({ label: "Businesses", load: async () => (await searchPlatformAdminBusinesses({ q, pageSize: "5" })).items.map(row => ({ id: row.id, label: row.name, detail: row.status, href: `/admin/businesses/${row.id}` })) });
  if (actor.permissions.includes(P.locationsRead)) jobs.push({ label: "Locations", load: async () => (await searchPlatformAdminLocations({ q, pageSize: "5" })).items.map(row => ({ id: row.id, label: row.name, detail: row.organization_name, href: `/admin/locations/${row.id}` })) });
  if (actor.permissions.includes(P.reportsRead)) jobs.push({ label: "Support cases", load: async () => (await searchPlatformAdminReports({ q, pageSize: "5" })).items.map(row => ({ id: row.id, label: `${row.report_number} · ${row.summary}`, detail: row.status.replaceAll("_", " "), href: `/admin/reports/${row.id}` })) });
  if (actor.permissions.includes(P.inboxRead)) jobs.push({ label: "Support inbox", load: async () => (await listSupportInbox({ q, pageSize: "5" })).items.map(row => ({ id: row.id, label: row.customer_name, detail: row.preview, href: `/admin/inbox/${row.id}` })) });
  const results = await Promise.allSettled(jobs.map(job => job.load()));
  return NextResponse.json({ groups: results.map((result, i) => ({ label: jobs[i].label, items: result.status === "fulfilled" ? result.value : [], unavailable: result.status === "rejected" })) }, { headers });
}
