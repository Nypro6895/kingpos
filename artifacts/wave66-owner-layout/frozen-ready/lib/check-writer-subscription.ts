import "server-only";
import type { marketServiceClient } from "@/lib/market-payments";
export async function checkWriterSubscription(
  service: ReturnType<typeof marketServiceClient>,
  salonId: string,
  actor: string,
) {
  const { data, error } = await service
    .from("check_writer_subscriptions")
    .select("paid_until,stripe_subscription,payment_owner")
    .eq("salon_id", salonId)
    .maybeSingle();
  if (error) throw Error("Check Writer subscription could not load.");
  let verifiedCanceled = false;
  if (data?.stripe_subscription) {
    const purchase = await service
      .from("market_card_purchases")
      .select("status,synced_at")
      .eq("salon_id", salonId)
      .eq("plugin_id", "print-check")
      .eq("subscription_id", data.stripe_subscription)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    verifiedCanceled =
      !purchase.error &&
      purchase.data?.status === "canceled" &&
      Boolean(purchase.data.synced_at);
  }
  return {
    installed: Boolean(data),
    active:
      data?.payment_owner === actor &&
      Date.parse(data?.paid_until ?? "") > Date.now(),
    subscribed: Boolean(data?.stripe_subscription) && !verifiedCanceled,
    paidUntil: data?.paid_until ?? null,
  };
}
