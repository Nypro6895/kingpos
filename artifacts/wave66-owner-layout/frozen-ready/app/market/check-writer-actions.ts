"use server";
import { checkWriterContext } from "@/lib/check-writer-server";
import { paymentConfig, paymentStripe } from "@/lib/platform-payment";
export async function manageCheckWriterSubscription() {
  try {
    const ctx = await checkWriterContext();
    const { data, error } = await ctx.service
      .from("check_writer_subscriptions")
      .select("stripe_customer,payment_owner")
      .eq("salon_id", ctx.salonId)
      .maybeSingle();
    if (error || data?.payment_owner !== ctx.user.id || !data?.stripe_customer)
      throw Error("Subscription management is unavailable.");
    const config = await paymentConfig();
    const form = new URLSearchParams({
      customer: data.stripe_customer,
      return_url: "https://reylumi.com/market?q=Check%20Writer",
    });
    if (config.portalConfigurationId)
      form.set("configuration", config.portalConfigurationId);
    const result = await paymentStripe(
      "billing_portal/sessions",
      form,
      undefined,
      config,
    );
    return { url: result.url as string };
  } catch {
    return { error: "Subscription management is unavailable." };
  }
}
