import { NextRequest, NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { searchPlatformAdminUsers } from "@/lib/platform-admin/users";
import { searchPlatformAdminBusinesses } from "@/lib/platform-admin/businesses";
import { searchPlatformAdminLocations } from "@/lib/platform-admin/locations";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

export async function GET(request: NextRequest) {
  const context = await getCurrentPlatformAdminContext();
  const kind = request.nextUrl.searchParams.get("kind");
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const permission = kind === "user" ? PLATFORM_ADMIN_PERMISSIONS.usersRead : kind === "business" ? PLATFORM_ADMIN_PERMISSIONS.businessesRead : kind === "location" ? PLATFORM_ADMIN_PERMISSIONS.locationsRead : null;
  if (!permission || !context?.permissions.includes(permission)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  if (q.length < 2 || q.length > 100) return NextResponse.json({ items: [] });
  try {
    const items = kind === "user"
      ? (await searchPlatformAdminUsers({ q, pageSize: "10" })).items.map(user => ({ id: user.id, label: `${user.display_name ?? "Unnamed user"}${user.email ? ` · ${user.email}` : ` · ${user.id.slice(0,8)}`}` }))
      : kind === "business" ? (await searchPlatformAdminBusinesses({ q, pageSize: "10" })).items.map(item => ({ id: item.id, label: item.name }))
      : (await searchPlatformAdminLocations({ q, pageSize: "10" })).items.map(item => ({ id: item.id, label: `${item.name} · ${item.organization_name}` }));
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Search unavailable" }, { status: 503 }); }
}
