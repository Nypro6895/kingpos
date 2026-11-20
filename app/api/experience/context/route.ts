import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getVerifiedPlatformAdminContext } from "@/lib/platform-admin/auth";
import { getAdminExperienceContext, getExperienceContext } from "@/lib/experience-context";
import { headers } from "next/headers";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { connection } from "next/server";
import { runReadWithDeadline } from "@/lib/bounded-get";

export async function GET(request: Request) {
  await connection();
  const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    if ((await headers()).get("x-reylumi-auth-unavailable") === "1") {
      return Response.json({ error: "Authentication temporarily unavailable" }, { status: 503, headers: responseHeaders });
    }
    const contextRead = getRequestBusinessContext();
    if (new URL(request.url).searchParams.get("admin") === "1") {
      const [businessContext, admin] = await runReadWithDeadline(Promise.all([
        contextRead,
        runReadWithDeadline(getVerifiedPlatformAdminContext(), 8_000),
      ]), 12_000);
      if (!admin || !admin.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.access)) {
        return Response.json({ error: "Access changed" }, { status: 403, headers: responseHeaders });
      }
      return Response.json(getAdminExperienceContext(getExperienceContext(businessContext), admin), { headers: responseHeaders });
    }
    const context = getExperienceContext(await runReadWithDeadline(contextRead, 12_000));
    return Response.json(context, { headers: responseHeaders });
  } catch {
    return Response.json({ error: "Context temporarily unavailable" }, { status: 503, headers: responseHeaders });
  }
}
