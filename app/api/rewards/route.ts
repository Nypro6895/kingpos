import { NextRequest, after } from "next/server";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import { cookies } from "next/headers";
import { createAuthenticatedSupabaseServerClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { marketPluginContext } from "@/lib/market-plugins";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const origin = request.headers.get("origin");
  if ((origin && origin !== request.nextUrl.origin) || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const raw = await request.text();
  if (raw.length > 100000) return Response.json({ error: "Request too large." }, { status: 413, headers });
  try {
    const { scope, op, args = {}, token } = JSON.parse(raw);
    if (typeof op !== "string" || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid request.");
    const auth = await createAuthenticatedSupabaseServerClient();
    const anon = createSupabaseServerClient();
    const db = auth ?? anon;
    if (!db) throw new Error("Rewards are temporarily unavailable.");
    let result;
    if (scope === "admin") {
      await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.advertisingManage);
      if (!auth) throw new Error("Sign in required.");
      result = await auth.rpc("reward_admin", { p_op: op, p_args: args });
    } else if (scope === "owner") {
      const context = await marketPluginContext();
      if (op === "report") {
        const report = await context.client.rpc("reward_owner_report", { p_salon: context.salonId, p_day: args.day || null });
        if (report.error) throw new Error(report.error.message);
        return Response.json(report.data, { headers });
      }
      if (op === "accept") {
        const invitation = await context.client.rpc("reward_owner_invitations", { p_salon: context.salonId, p_accept: args.id });
        if (invitation.error) throw new Error(invitation.error.message);
        return Response.json({ invitations: invitation.data }, { headers });
      }
      result = await context.client.rpc("reward_owner", { p_salon: context.salonId, p_op: op, p_args: args });
      if (!result.error) {
        const invitations = await context.client.rpc("reward_owner_invitations", { p_salon: context.salonId });
        result.data = { ...result.data, invitations: invitations.data ?? [] };
      }
    } else if (scope === "personal") {
      if (!auth) throw new Error("Sign in to view your rewards.");
      result = op === "gift-load" || op === "gift-approve" ? await auth.rpc("reward_visit_gifts", { p_visit: args.visitId, p_card: op === "gift-approve" ? args.cardId : null }) : await auth.rpc("reward_personal", { p_op: op, p_args: args });
    } else if (scope === "display") {
      if (typeof token !== "string" || token.length > 200) throw new Error("Display session required.");
      result = await db.rpc("reward_display", { p_token: token, p_op: op, p_args: args });
    } else if (scope === "pos") {
      const jar = await cookies();
      const key = jar.get("kingpos-portable-pos-key-id")?.value;
      const signature = jar.get("kingpos-portable-pos-session")?.value;
      let salon: string | undefined;
      if (key && signature) {
        if (jar.get("kingpos-portable-local-lock")?.value === "1") throw new Error("Unlock POS first.");
        const validated = await anon?.rpc("get_pos_portable_access_context", { p_key_id: key, p_session_signature: signature });
        const row = Array.isArray(validated?.data) ? validated.data[0] : validated?.data;
        salon = row?.salon_id;
        if (!salon) throw new Error("POS session expired.");
      } else salon = (await getCurrentBusinessContext()).currentSalon?.id;
      if (!salon) throw new Error("Select an active salon POS.");
      result = op === "owner-cart" ? await db.rpc("reward_owner_cart", { p_salon: salon, p_cart: args.cartId, p_receipt: args.receipt }) : op === "owner-submit" ? await db.rpc("reward_submit_owner", { p_salon: salon, p_request: args.cartId, p_receipt: args.receipt }) : op === "relay" ? await db.rpc("reward_relay_gateway", { p_salon: salon, p_visit: args.visitId, p_expected: args.expected, p_op: args.innerOp, p_args: args.innerArgs ?? {}, p_tip: args.tip ?? 0, p_discount: args.discount ?? 0, p_key: key || null, p_signature: signature || null }) : await db.rpc("reward_pos", { p_salon: salon, p_op: op, p_args: args, p_key: key || null, p_signature: signature || null });
      if (!result.error && result.data?.ticketId) after(() => broadcastPosStaffChange(salon!, "pos"));
    } else throw new Error("Unknown reward action.");
    if (result.error) throw new Error(result.error.message);
    return Response.json(result.data ?? {}, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Reward action failed." }, { status: 400, headers });
  }
}
