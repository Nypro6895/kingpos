import { verifyGiftSignature, syncGiftOnline } from "@/lib/gift-card-stripe";
import { marketServiceClient } from "@/lib/market-payments";
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1000000 || !verifyGiftSignature(raw, request.headers.get("stripe-signature") ?? "")) return new Response("Invalid signature", { status: 400 });
  try {
    const event = JSON.parse(raw); const object = event.data?.object;
    let id = object?.metadata?.gift_card_order;
    if(event.type==="charge.dispute.created"&&!id&&typeof object?.payment_intent==="string"){
      const found=await marketServiceClient().from("gift_card_online_orders").select("id,stripe_account").eq("payment_intent",object.payment_intent).maybeSingle();
      if(found.error)throw new Error("Payment review will retry");
      if(found.data&&found.data.stripe_account===event.account)id=found.data.id;
    }
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded", "charge.dispute.created"].includes(event.type) && id) {
      if(typeof event.account!=="string")throw new Error("Connected account required");
      await syncGiftOnline(id, event.account,event.type==="charge.dispute.created");
    }
    return Response.json({ received: true });
  } catch { return new Response("Payment reconciliation will retry", { status: 500 }); }
}
