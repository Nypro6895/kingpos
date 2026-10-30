import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAuthenticatedSupabaseServerClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { marketPluginContext } from "@/lib/market-plugins";
import { marketServiceClient } from "@/lib/market-payments";
import { connectGiftStripe, prepareGiftOnline, syncGiftOnline } from "@/lib/gift-card-stripe";
import { defaultGiftDesign, normalizeGiftDesign } from "@/types/gift-card";
import { getCurrentSalonPosSettings } from "@/lib/pos-settings";

export async function POST(request: NextRequest) {
  // All stateful requests use JSON and same-origin requests; bearer secrets stay out of URLs/logs.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const raw = await request.text(); if (raw.length > 2300000) return Response.json({ error: "Request too large." }, { status: 413 });
  try {
    const { scope, op, args = {}, token } = JSON.parse(raw);
    if (typeof op !== "string" || typeof args !== "object" || !args || Array.isArray(args)) throw new Error("Invalid request.");
    const auth = await createAuthenticatedSupabaseServerClient(); const anon = createSupabaseServerClient();
    const db = auth ?? anon; if (!db) throw new Error("Gift cards are temporarily unavailable.");
    let result;
    if (scope === "owner") {
      const ctx = await marketPluginContext();
      if (op === "void-sale") {
        const reversed = await ctx.client.rpc("gift_card_void_counter_sale", {p_salon:ctx.salonId,p_sale:args.saleId});
        if (reversed.error) throw new Error(reversed.error.message);
        const updated = await ctx.client.rpc("gift_card_owner", {p_salon:ctx.salonId,p_op:"read",p_args:{}});
        if (updated.error) throw new Error(updated.error.message);
        return Response.json(updated.data, {headers:{"Cache-Control":"no-store"}});
      }
      if (op === "connect") return Response.json(await connectGiftStripe(ctx.salonId), { headers: { "Cache-Control": "no-store" } });
      if (op === "design") args.design = normalizeGiftDesign(args.design);
      if(op === "install"){const context=await getCurrentBusinessContext();const settings=await getCurrentSalonPosSettings(context);args.design=defaultGiftDesign(context.currentSalon?.name??"Salon",settings.salonLogoUrl??"");}
      result = await ctx.client.rpc("gift_card_owner", { p_salon: ctx.salonId, p_op: op, p_args: args });
    } else if (scope === "pos") {
      const jar = await cookies(); const key = jar.get("kingpos-portable-pos-key-id")?.value; const signature = jar.get("kingpos-portable-pos-session")?.value;
      let salon: string | undefined;
      if (key && signature && jar.get("kingpos-portable-local-lock")?.value !== "1") {
        const validated = await anon!.rpc("get_pos_portable_access_context", { p_key_id: key, p_session_signature: signature });
        const row = Array.isArray(validated.data) ? validated.data[0] : validated.data;
        salon = row?.salon_id;
      }
      if (!salon) { const context = await getCurrentBusinessContext(); salon = context.currentSalon?.id; }
      if (!salon) throw new Error("Select an active salon POS.");
      result = await db.rpc("gift_card_pos", { p_salon: salon, p_op: op, p_args: args, p_key: key || null, p_signature: signature || null });
    } else if (scope === "display") result = await db.rpc("gift_card_display", { p_token: token, p_op: op, p_args: args });
    else if (scope === "wallet") {
      if (!auth) throw new Error("Sign in to use your wallet.");
      result = await auth.rpc("gift_card_wallet", { p_op: op, p_args: args });
    } else if (scope === "public") result = await db.rpc("gift_card_public", { p_token: token, p_op: op, p_args: args });
    else if (scope === "online" && op === "catalog") result = await db.rpc("gift_card_catalog",{p_salon:args.salonId});
    else if (scope === "online" && op === "buy") {
      const context = auth ? await getCurrentBusinessContext() : null;
      return Response.json(await prepareGiftOnline(String(args.salonId), args.amount, args.requestId, context?.user?.id ?? null), { headers: { "Cache-Control": "no-store" } });
    } else if (scope === "online" && op === "status") {
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid purchase link.");
      const service = marketServiceClient(); const { data: order, error } = await service.from("gift_card_online_orders").select("id,stripe_account,stripe_session").eq("token", token).single();
      if (error || !order) throw new Error("Purchase not found.");
      if (order.stripe_session) await syncGiftOnline(order.id, order.stripe_account);
      result = await service.rpc("gift_card_online_receipt", { p_token: token });
    } else throw new Error("Unknown gift card action.");
    if (result.error) throw new Error(result.error.message);
    return Response.json(result.data ?? {}, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Gift card action failed." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
