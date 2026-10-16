import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaffBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { getCurrentStaffForSalon } from "@/lib/staff-workdays";
import { CURRENT_STAFF_NOT_FOUND_MESSAGE } from "@/lib/staff-account";
import { EXPERIENCE_OFFLINE_MAX_AGE, getExperienceOfflinePath, type ExperienceOfflineGrant } from "@/lib/experience-offline-policy";
import { runReadWithDeadline } from "@/lib/bounded-get";
import type { StaffOfflineBinding } from "@/lib/staff-offline-binding";
import { getStaffOfflineBindingAuthorization } from "@/lib/staff-offline-binding-server";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const failure = (status: number) => Response.json({ error: status === 503 ? "Please try again." : "Access must be checked again." }, { status, headers: responseHeaders });

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const path = getExperienceOfflinePath(url.searchParams.get("path") ?? "", url.origin);
  const generation = url.searchParams.get("generation") ?? "";
  if (!path || !/^[\w-]{16,100}$/.test(generation)) return failure(400);
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") return failure(503);
  try {
    const issuedAt = Date.now();
    if (path.startsWith("/pos/portable")) {
      const store = await cookies();
      const key = store.get("kingpos-portable-pos-key-id")?.value;
      const signature = store.get("kingpos-portable-pos-session")?.value;
      if (!key || !signature || store.get("kingpos-portable-local-lock")?.value === "1") return failure(401);
      const client = createSupabaseServerClient();
      if (!client) return failure(503);
      const [{ data, error }, rootBusiness] = await runReadWithDeadline(Promise.all([
        Promise.resolve(client.rpc("get_pos_portable_access_context", { p_key_id: key, p_session_signature: signature })), getRequestBusinessContext(),
      ]), 12_000);
      if (error) return failure(503);
      if (!data?.salon_id || data.key_id !== key || !Array.isArray(data.capabilities)) return failure(403);
      const capability = path.startsWith("/pos/portable/check-in") ? "portable.checkin.use" : path.startsWith("/pos/portable/book") ? "portable.book.view" : path.startsWith("/pos/portable/report") ? "portable.report.view" : /\/pos\/portable\/(?:ticket|today)/.test(path) ? "portable.today.view" : "portable.pos.use";
      if (!data.capabilities.includes(capability)) return failure(403);
      const scope = `${data.salon_id}:${key}`;
      const root = getExperienceContext(rootBusiness);
      const grant: ExperienceOfflineGrant = { version: 1, scope, scopes: [scope, root.scope], viewerId: root.viewerId, workspaceId: key, salonId: data.salon_id, grantRevision: hash([[...data.capabilities].sort(), root.scope]), generation, issuedAt, expiresAt: issuedAt + EXPERIENCE_OFFLINE_MAX_AGE, path, kind: "portable", localCommands: process.env.KINGPOS_PORTABLE_DRAFT_OUTBOX === "1" };
      return Response.json(grant, { headers: responseHeaders });
    }
    const business = await getRequestBusinessContext();
    const base = getExperienceContext(business);
    const publicPath = path === "/explore" || path.startsWith("/explore?") || path === "/market" || path.startsWith("/market?");
    if (!base.authenticated && !publicPath) return failure(401);
    if (path.startsWith("/pos") && (!isSalonManageContext(business) || !business.currentSalon)) return failure(403);
    if (path.startsWith("/staff/today") && (!isSalonManageContext(business) || !business.currentSalon)) return failure(403);
    const scopes = [base.scope];
    let staffBinding: StaffOfflineBinding | undefined;
    let staffScope: string | undefined;
    if (path.startsWith("/staff/") && !path.startsWith("/staff/today")) {
      const identity = await runReadWithDeadline(path.startsWith("/staff/workday") ? (async () => {
        const context = await getCurrentStaffBusinessContext();
        if (!context.user || !context.currentSalon || !context.currentAccount) return { context, staff: null };
        try { return { context, staff: await getCurrentStaffForSalon(context) }; }
        catch (error) { if (error instanceof Error && error.message === CURRENT_STAFF_NOT_FOUND_MESSAGE) return { context, staff: null }; throw error; }
      })() : getStaffPortalIdentity(), 8_000);
      if (!identity.staff || identity.context.user?.id !== base.viewerId) return failure(403);
      const authorization = await runReadWithDeadline(getStaffOfflineBindingAuthorization(identity as Parameters<typeof getStaffOfflineBindingAuthorization>[0]), 8_000);
      // A verified replacement link is different from a temporary read outage.
      // The client only drops a previous approved lease on this explicit result.
      if (authorization.state === "unconfirmed") return Response.json({ error: "Please confirm this staff account with the owner.", offlineState: "unconfirmed", scope: base.scope, staffId: identity.staff.id }, { status: 503, headers: responseHeaders });
      if (authorization.state === "revoked") return failure(403);
      staffBinding = authorization.binding ?? undefined;
      staffScope = getExperienceContext(identity.context).scope;
      scopes.push(staffScope);
    }
    // Access-token renewal is separate from the user's session. This bounded
    // display lease never substitutes for fresh server authorization on writes.
    const expiresAt = issuedAt + EXPERIENCE_OFFLINE_MAX_AGE;
    const grant: ExperienceOfflineGrant = { version: 1, scope: base.scope, scopes: [...new Set(scopes)], viewerId: base.viewerId, workspaceId: base.workspaceId, salonId: staffBinding?.salonId ?? base.salonId, grantRevision: hash(staffBinding ? [base.permissionRevision, staffScope, staffBinding.revision] : base.permissionRevision), generation, issuedAt, expiresAt, path, staffBinding,
      kind: staffBinding ? "staff" : !base.authenticated ? "public" : isSalonManageContext(business) ? "owner" : "customer" };
    return Response.json(grant, { headers: responseHeaders });
  } catch { return failure(503); }
}
