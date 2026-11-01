import { NextRequest } from "next/server";
import { getCurrentBusinessContext, isOwnerMembership } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { readOwnerFinancialAttention } from "@/lib/owner-financial-attention";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const context = await getCurrentBusinessContext();
    if (!context.user) return Response.json({ error: "Sign in required" }, { status: 401, headers });
    if (!context.currentSalon || !isOwnerMembership(context.currentMembership)) return Response.json({ error: "Owner access required" }, { status: 403, headers });
    const query = request.nextUrl.searchParams;
    if (query.get("salonId") !== context.currentSalon.id) return Response.json({ error: "Workspace changed. Reopen Today." }, { status: 409, headers });
    if ([...query.keys()].some(key => !["salonId", "item", "page"].includes(key) || query.getAll(key).length !== 1)) return Response.json({ error: "Invalid query" }, { status: 400, headers });
    const item = query.get("item") ?? undefined, page = query.get("page") ?? "0";
    if ((item && item.length > 180) || !/^\d{1,6}$/.test(page) || Number(page) > 100000) return Response.json({ error: "Invalid item or page" }, { status: 400, headers });
    return Response.json(await readOwnerFinancialAttention(context, item, Number(page)), { headers });
  } catch { return Response.json({ error: "Financial checks could not load. Please retry." }, { status: 503, headers }); }
}

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return fail("Invalid origin", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return fail("JSON required", 400);
  try {
    const raw = await request.text();
    if (raw.length > 2000) return fail("Request too large", 400);
    const body = JSON.parse(raw);
    const context = await getCurrentBusinessContext();
    if (!context.user) return fail("Sign in required", 401);
    if (!context.currentSalon || !isOwnerMembership(context.currentMembership)) return fail("Owner access required", 403);
    if (body.salonId !== context.currentSalon.id) return fail("Workspace changed. Reopen Today.", 409);
    if (body.item !== undefined && (typeof body.item !== "string" || body.item.length > 180)) return fail("Invalid item", 400);
    if (body.op === "read") {
      const page = body.page ?? 0;
      if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return fail("Invalid page", 400);
      return Response.json(await readOwnerFinancialAttention(context, body.item, page), { headers });
    }
    if (!["ignore", "review_closing"].includes(body.op) || !body.item) return fail("Invalid action", 400);
    if (body.viewerId !== context.user.id) return fail("Account changed. Reopen this item.", 409);
    const db = await createAuthenticatedSupabaseServerClient();
    if (!db) return fail("Authentication unavailable", 503);
    const result = await db.rpc("owner_financial_attention_action", { p_salon: context.currentSalon.id, p_item: body.item, p_action: body.op });
    if (result.error?.code === "22023") return fail("Verify entered collections and finish open receipts in Reports before confirming.", 409);
    if (result.error) return fail(result.error.code === "40001" ? "This item changed. Refresh before continuing." : "Unable to save. Please retry.", result.error.code === "40001" ? 409 : 503);
    return Response.json({ ok: true }, { headers });
  } catch {
    return fail("Financial checks could not load. Please retry.", 503);
  }
}
