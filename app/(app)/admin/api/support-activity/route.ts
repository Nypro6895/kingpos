import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";

const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  await requirePlatformAdmin();
  try { return Response.json(await callPlatformAdminRpc("get_platform_admin_activity"), { headers }); }
  catch { return Response.json({ error: "Team notifications are unavailable. Please retry." }, { status: 503, headers }); }
}
export async function POST(request: NextRequest) {
  await requirePlatformAdmin();
  if (request.headers.get("origin") !== request.nextUrl.origin) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) return Response.json({ error: "Invalid notification IDs." }, { status: 400, headers });
    await callPlatformAdminRpc("mark_platform_admin_activity_read", { p_ids: ids });
    return Response.json({ ok: true }, { headers });
  } catch { return Response.json({ error: "Could not mark notifications read." }, { status: 503, headers }); }
}
