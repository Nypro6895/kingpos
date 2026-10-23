import { cookies } from "next/headers";
import { marketPluginContext } from "@/lib/market-plugins";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { marketServiceClient } from "@/lib/market-payments";
import { depositStripe } from "@/lib/booking-deposit";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";

export async function GET(request: Request) {
  const jar = await cookies();
  const stored = jar.get("booking-stripe-state")?.value;
  jar.delete("booking-stripe-state");
  try {
    const state = JSON.parse(stored ?? "null"), params = new URL(request.url).searchParams;
    const scope = await marketPluginContext(), context = await getCurrentBusinessContext();
    if (!state || state.nonce !== params.get("state") || state.expires < Date.now() || state.salonId !== scope.salonId || state.owner !== context.user?.id) throw new Error("Invalid connection request.");
    const code = params.get("code"), secret = process.env.BOOKING_STRIPE_SECRET_KEY;
    if (!code || !secret) throw new Error("Stripe connection was cancelled.");
    const response = await fetch("https://connect.stripe.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_secret: secret }), cache: "no-store", signal: AbortSignal.timeout(20000) });
    const connected = await response.json();
    if (!response.ok || !/^acct_[a-zA-Z0-9]+$/.test(connected.stripe_user_id ?? "") || connected.scope !== "read_write") throw new Error("Stripe could not connect.");
    const account = await depositStripe(`accounts/${connected.stripe_user_id}`);
    if (!account.charges_enabled || !account.payouts_enabled || account.controller?.fees?.payer === "application") throw new Error("Use a Stripe account that receives payments and pays its own processing fees.");
    const { error } = await marketServiceClient().from("booking_deposit_subscriptions").upsert({ salon_id: scope.salonId, stripe_account: connected.stripe_user_id, enabled: false }, { onConflict: "salon_id" });
    if (error) throw new Error("Stripe connection could not be saved.");
    return Response.redirect(new URL("/market?bookingStripe=connected", REYLUMI_METADATA_BASE));
  } catch { return Response.redirect(new URL("/market?bookingStripe=failed", REYLUMI_METADATA_BASE)); }
}
