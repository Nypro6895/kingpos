import "server-only";
import { marketPluginContext } from "@/lib/market-plugins";
import { marketServiceClient } from "@/lib/market-payments";
import { paymentStripe } from "@/lib/platform-payment";
import { syncCardSubscription } from "@/lib/market-card";
import { CARD_PLUGINS } from "@/lib/market-card-rules";

export type MarketReturnReconciliationResult = { checked: number; failed: number };

// Redirect parameters are navigation hints. Reconcile only saved purchases for
// the authenticated owner's current salon using authoritative provider state.
export async function reconcileMarketPaymentReturn(expectedSalonId: string): Promise<MarketReturnReconciliationResult> {
  const { salonId } = await marketPluginContext();
  if (salonId !== expectedSalonId) throw new Error("Your salon changed. Reopen Market.");
  const { data, error } = await marketServiceClient().from("market_card_purchases")
    .select("plugin_id,subscription_id,session_id").eq("salon_id", salonId)
    .in("plugin_id", [...CARD_PLUGINS]).order("created_at", { ascending: false }).limit(12);
  if (error) throw new Error("Payment confirmation is pending.");
  const seen = new Set<string>();
  const latest = (data ?? []).filter(row => {
    if (seen.has(row.plugin_id)) return false;
    seen.add(row.plugin_id); return true;
  });
  const outcomes = await Promise.allSettled(latest.map(async row => {
    let subscription = row.subscription_id;
    if (!subscription && row.session_id) {
      const session = await paymentStripe(`checkout/sessions/${row.session_id}`);
      if (session.status === "complete") subscription = session.subscription;
    }
    if (typeof subscription === "string") await syncCardSubscription(subscription);
  }));
  // A failed sibling must not hide successful reconciliation, or turn an
  // unavailable confirmation into a completed status check for the caller.
  const failed = outcomes.filter(result => result.status === "rejected").length;
  return { checked: outcomes.length - failed, failed };
}
