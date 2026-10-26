import "server-only";
import { marketPluginContext } from "@/lib/market-plugins";
import { marketServiceClient, marketStripe } from "@/lib/market-payments";
import { paymentStripe } from "@/lib/platform-payment";
import { syncCardSubscription } from "@/lib/market-card";
import { syncBookingDepositSubscription } from "@/lib/booking-deposit-subscription";

export const BOOKING_DEPOSIT_PRODUCT_PATH = "/market/booking-deposit";

export async function bookingDepositPurchaseState(salonId: string) {
  const { data, error } = await marketServiceClient().from("booking_deposit_subscriptions")
    .select("installed,paid_until,stripe_subscription,stripe_checkout").eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("Booking Deposit could not load. Please try again.");
  return { ...data, paid: Boolean(data?.paid_until && Date.parse(data.paid_until) > Date.now()) };
}

// A checkout return URL is only a navigation hint. Paid access comes from the
// provider-verified subscription, scoped to the owner's current salon.
export async function confirmBookingDepositPurchase(expectedSalonId: string) {
  const { client, salonId } = await marketPluginContext();
  if (!expectedSalonId || expectedSalonId !== salonId) throw new Error("Select the salon used for this purchase, then try again.");
  const service = marketServiceClient();
  const before = await bookingDepositPurchaseState(salonId);
  const { data: purchase, error } = await service.from("market_card_purchases")
    .select("subscription_id,session_id").eq("salon_id", salonId).eq("plugin_id", "booking-deposit")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error && !["42P01", "PGRST205"].includes(error.code)) throw new Error("Payment confirmation is pending. Please try again.");
  if (purchase && (!before.stripe_subscription || before.stripe_subscription === purchase.subscription_id)) {
    let subscription = purchase.subscription_id;
    if (!subscription && purchase.session_id) {
      const session = await paymentStripe(`checkout/sessions/${purchase.session_id}`);
      if (session.status === "complete") subscription = session.subscription;
    }
    if (typeof subscription === "string") await syncCardSubscription(subscription);
  } else if (before.stripe_subscription || before.stripe_checkout) {
    let subscription = before.stripe_subscription;
    if (!subscription && before.stripe_checkout) {
      const session = await marketStripe(`checkout/sessions/${before.stripe_checkout}`);
      if (session.status === "complete") subscription = session.subscription;
    }
    if (typeof subscription === "string") await syncBookingDepositSubscription(subscription);
  }
  const state = await bookingDepositPurchaseState(salonId);
  if (!state.paid) return false;
  if (!state.installed) {
    const { error: installError } = await client.rpc("booking_deposit_install", { p_salon: salonId, p_installed: true });
    if (installError) throw new Error("Payment is confirmed. Please retry to finish adding Booking Deposit.");
  }
  return true;
}
