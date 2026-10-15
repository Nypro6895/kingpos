import { syncTaxCompanySubscription } from "@/lib/tax-company-subscription";
import { syncBookingPolicySubscription } from "@/lib/booking-policy-subscription";
import { syncBookingDepositSubscription } from "@/lib/booking-deposit-subscription";
import { syncCheckinReceiptSubscription } from "@/lib/checkin-receipt-subscription";
import { NextResponse } from "next/server";
import { marketServiceClient, syncVietnameseSubscription, verifyMarketWebhook } from "@/lib/market-payments";

export async function POST(request: Request) {
  const payload = await request.text();
  if (!verifyMarketWebhook(payload, request.headers.get("stripe-signature") ?? "")) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  try {
    const event = JSON.parse(payload);
    const object = event.data?.object;
    if (event.type === "checkout.session.expired" && object.metadata?.vietnamese_checkout && object.metadata?.salon_id) {
      const { error } = await marketServiceClient().from("vietnamese_plugin_subscriptions").update({ checkout_reference: null, checkout_owner: null, checkout_session: null }).eq("salon_id", object.metadata.salon_id).eq("checkout_reference", object.metadata.vietnamese_checkout);
      if (error) throw new Error("Checkout could not reset.");
    }
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) { await syncVietnameseSubscription(object.id); await syncCheckinReceiptSubscription(object.id); await syncBookingPolicySubscription(object.id); await syncTaxCompanySubscription(object.id); await syncBookingDepositSubscription(object.id); }
    else if (["checkout.session.completed", "invoice.paid", "invoice.payment_failed"].includes(event.type)) {
      const subscription = object.subscription ?? object.parent?.subscription_details?.subscription;
      if (typeof subscription === "string") { await syncVietnameseSubscription(subscription); await syncCheckinReceiptSubscription(subscription); await syncBookingPolicySubscription(subscription); await syncTaxCompanySubscription(subscription); await syncBookingDepositSubscription(subscription); }
    }
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ error: "Subscription update could not be recorded" }, { status: 500 }); }
}
