import { connection } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getCurrentKingUser } from "@/lib/users/current-user";

const ORIGIN = "http://localhost:3117";
const SESSION = /^cs_test_qa_[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type Context = { params: Promise<{ session: string }> };
type LocalSession = {
  id: string; livemode: boolean; currency: string; amount_total: number;
  metadata?: { gift_card_order?: string };
};

function enabled(request: Request) {
  return process.env.NODE_ENV !== "production" && process.env.REYLUMI_QA_MODE === "local" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55421" &&
    process.env.NEXT_PUBLIC_APP_URL === ORIGIN && new URL(request.url).origin === ORIGIN;
}

async function localCheckout(sessionId: string) {
  if (!SESSION.test(sessionId)) throw new Error("Unavailable checkout");
  const user = await getCurrentKingUser();
  if (!user || !user.email?.endsWith("@qa.reylumi.invalid")) throw new Error("QA sign-in required");
  const token = (await readFile(path.join(process.cwd(), "qa/runtime/provider-token"), "utf8")).trim();
  const response = await fetch(`http://127.0.0.1:3118/checkout/${sessionId}`, {
    headers: { "x-qa-token": token }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Unavailable checkout");
  const session = await response.json() as LocalSession;
  if (session.id !== sessionId || session.livemode !== false || session.currency !== "usd" ||
      !UUID.test(session.metadata?.gift_card_order ?? "")) throw new Error("Unavailable checkout");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order, error } = await db.from("gift_card_online_orders")
    .select("id,actor_id,stripe_session,amount,token,status")
    .eq("id", session.metadata!.gift_card_order!).eq("actor_id", user.id).maybeSingle();
  if (error || !order || order.stripe_session !== sessionId || order.amount !== session.amount_total ||
      !Number.isInteger(order.amount) || order.amount < 100 || order.amount > 100000 ||
      !/^[a-f0-9]{64}$/.test(order.token) || !["pending", "paid"].includes(order.status)) {
    throw new Error("Unavailable checkout");
  }
  const csrf = createHmac("sha256", token).update(`${sessionId}:${user.id}`).digest("hex");
  return { session, order, token, csrf };
}

export async function GET(request: Request, context: Context) {
  if (!enabled(request)) return new Response(null, { status: 404 });
  await connection();
  try {
    const { session: id } = await context.params;
    const { order, csrf } = await localCheckout(id);
    const body = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reylumi QA — thanh toán thử</title>
<style>body{margin:0;background:#fff9f3;color:#203d3a;font:18px system-ui}main{max-width:420px;padding:24px;margin:auto}h1{font-size:24px}strong{display:block;padding:16px;background:#ffe4ca;border-radius:12px}button{font:inherit;width:100%;min-height:48px;margin-top:16px;border:0;border-radius:12px;padding:12px;background:#147b76;color:white}button[value=cancel]{background:#eee;color:#333}</style>
<main><h1>Thanh toán thử nghiệm</h1><strong>QA ONLY — không thu tiền thật</strong><p>Gift Card: $${(order.amount / 100).toFixed(2)} USD</p><p>Kết quả chỉ được ghi trong môi trường QA trên máy tính.</p>
<form method="post" action="/qa/checkout/${id}"><input type="hidden" name="csrf" value="${csrf}"><button name="operation" value="approve">Chấp nhận thanh toán thử</button><button name="operation" value="cancel">Hủy và quay lại</button></form></main></html>`;
    return new Response(body, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
    } });
  } catch {
    return new Response("Đăng nhập tài khoản QA và mở lại giao dịch Gift Card của bạn.", { status: 403 });
  }
}

export async function POST(request: Request, context: Context) {
  if (!enabled(request)) return new Response(null, { status: 404 });
  if (request.headers.get("origin") !== ORIGIN || Number(request.headers.get("content-length") ?? 0) > 1024 ||
      !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return new Response(null, { status: 403 });
  }
  await connection();
  try {
    const { session: id } = await context.params;
    const { order, token, csrf } = await localCheckout(id);
    const form = await request.formData();
    const submitted = String(form.get("csrf") ?? "");
    const operation = form.get("operation");
    if (!/^[a-f0-9]{64}$/.test(submitted) || !timingSafeEqual(Buffer.from(submitted), Buffer.from(csrf)) ||
        !["approve", "cancel"].includes(String(operation))) return new Response(null, { status: 403 });
    if (operation === "approve" && order.status !== "paid") {
      const paid = await fetch(`http://127.0.0.1:3118/checkout/${id}/pay`, {
        method: "POST", headers: { "x-qa-token": token }, signal: AbortSignal.timeout(5000),
      });
      if (!paid.ok) return new Response("Mô phỏng chưa hoàn tất. Hãy thử lại.", { status: 503 });
    }
    // Build the callback from the authenticated order, never a supplied URL.
    return new Response(null, { status: 303, headers: {
      Location: `${ORIGIN}/gift-cards?order=${order.token}${operation === "cancel" ? "&cancelled=1" : ""}`,
      "Cache-Control": "no-store",
    } });
  } catch {
    return new Response("Không xác nhận được giao dịch QA của bạn.", { status: 403 });
  }
}
