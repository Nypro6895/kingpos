import { platformEnabled } from "@/lib/market-platform/server";
import { verifyTestWebhook, testPaymentConfig } from "@/lib/market-platform/stripe-test";
import { reconcileTestEvent } from "@/lib/market-platform/commerce";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!platformEnabled()) return Response.json({ error: "Test commerce unavailable" }, { status: 503, headers });
  let config;
  try { config = testPaymentConfig(); } catch { return Response.json({ error: "Test commerce unconfigured" }, { status: 503, headers }); }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing event" }, { status: 400, headers });
  const chunks: Uint8Array[] = [];let size = 0;
  try {
    while (true) { const next = await reader.read();if (next.done) break;size += next.value.byteLength;if (size > 65536) { await reader.cancel();return Response.json({ error: "Event too large" }, { status: 413, headers }); }chunks.push(next.value); }
  } catch { return Response.json({ error: "Invalid body" }, { status: 400, headers }); }
  let event;
  const body = Buffer.concat(chunks).toString("utf8"), signature = request.headers.get("stripe-signature") ?? "";
  try { const candidate = verifyTestWebhook(body, signature, config.webhookSecret);if (!candidate.account) event = candidate; } catch { /* Try the separately configured Connect event destination. */ }
  if (!event && config.connectWebhookSecret) try { const candidate = verifyTestWebhook(body, signature, config.connectWebhookSecret);if (candidate.account) event = candidate; } catch { /* Return a uniform signature denial below. */ }
  if (!event) return Response.json({ error: "Invalid test event signature" }, { status: 400, headers });
  try { await reconcileTestEvent(event.id, event.account);return Response.json({ received: true }, { headers }); }
  catch { return Response.json({ error: "Provider reconciliation requires retry" }, { status: 500, headers }); }
}
