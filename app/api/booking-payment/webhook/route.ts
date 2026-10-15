import { marketServiceClient } from "@/lib/market-payments";
import { syncBookingDeposit, verifyDepositWebhook } from "@/lib/booking-deposit";

export async function POST(request: Request) {
  const payload = await request.text();
  if (payload.length > 262144 || !verifyDepositWebhook(payload, request.headers.get("stripe-signature") ?? "")) return Response.json({ error: "Invalid signature" }, { status: 400 });
  try {
    const event = JSON.parse(payload), object = event.data?.object;
    if (!/^acct_[a-zA-Z0-9]+$/.test(event.account ?? "")) return Response.json({ error: "Connected account required" }, { status: 400 });
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded"].includes(event.type)) {
      let id = object?.metadata?.booking_deposit_order;
      if (!id && event.type === "charge.refunded" && typeof object.payment_intent === "string") {
        const { data, error } = await marketServiceClient().from("booking_deposit_orders").select("id").eq("stripe_intent", object.payment_intent).eq("stripe_account", event.account).maybeSingle();
        if (error) throw new Error("Refund lookup failed.");
        id = data?.id;
      }
      if (id) await syncBookingDeposit(id, event.account);
    }
    if (event.type === "checkout.session.expired" && object.metadata?.booking_deposit_order) {
      const { error } = await marketServiceClient().from("booking_deposit_orders").update({ status: "expired" }).eq("id", object.metadata.booking_deposit_order).eq("stripe_account", event.account).eq("stripe_session", object.id).eq("status", "pending");
      if (error) throw new Error("Expiry update failed.");
    }
    if (event.type === "account.application.deauthorized") {
      const { error } = await marketServiceClient().from("booking_deposit_subscriptions").update({ enabled: false, stripe_account: null }).eq("stripe_account", event.account);
      if (error) throw new Error("Connection update failed.");
    }
    return Response.json({ received: true });
  } catch { return Response.json({ error: "Payment update is being retried" }, { status: 500 }); }
}
