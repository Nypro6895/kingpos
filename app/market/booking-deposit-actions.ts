"use server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { marketPluginContext } from "@/lib/market-plugins";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { bookingDepositState } from "@/lib/booking-deposit";
import { bookingDepositPayment } from "@/lib/booking-deposit-subscription";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";
import type { BookingDepositSettings, BookingDepositState } from "@/types/booking-deposit";
import { withSettingsTarget } from "@/lib/settings-target-context";
import { runWithReadContext } from "@/lib/read-context-scope";

type DepositResult = { state?: BookingDepositState; error?: string };
type RedirectResult = { url?: string; error?: string };

export async function loadBookingDepositAction(salonId?: string): Promise<DepositResult> {
  try { return await runWithReadContext(() => withSettingsTarget(salonId, async () => { const scope = await marketPluginContext(); return { state: await bookingDepositState(scope.salonId) }; }, "manage")); }
  catch (error) { return { error: error instanceof Error ? error.message : "Settings could not load." }; }
}
export async function saveBookingDepositAction(settings: BookingDepositSettings, salonId?: string): Promise<DepositResult> {
  try {
    if (!settings || typeof settings.enabled !== "boolean" || !["fixed", "percent", "full"].includes(settings.mode) || !["both", "embedded", "hosted"].includes(settings.checkout) || !Number.isFinite(settings.value) || settings.value <= 0 || settings.value > 999999 || (settings.mode === "percent" && settings.value > 100)) throw new Error("Enter a valid deposit amount or percentage.");
    return await withSettingsTarget(salonId, async () => {
    const { client, salonId: currentSalon } = await marketPluginContext();
    if (salonId && salonId !== currentSalon) throw new Error("Choose this salon first.");
    if (settings.enabled) { const state = await bookingDepositState(currentSalon); if (!state.testMode && !state.connected) throw new Error("Connect a Stripe account ready to receive payments first."); }
    const { error } = await client.rpc("booking_deposit_save", { p_salon: currentSalon, p_enabled: settings.enabled, p_mode: settings.mode, p_value: settings.value, p_checkout: settings.checkout });
    if (error) throw new Error(error.message);
    revalidatePath("/market"); revalidatePath("/settings"); revalidatePath(`/book/${currentSalon}`);
    return { state: await bookingDepositState(currentSalon) };
    }, "manage");
  } catch (error) { return { error: error instanceof Error ? error.message : "Settings could not save." }; }
}
export async function installBookingDepositAction(installed: boolean, salonId?: string): Promise<DepositResult> {
  try {
    return await withSettingsTarget(salonId, async () => {
    const { client, salonId: currentSalon } = await marketPluginContext();
    if (salonId && salonId !== currentSalon) throw new Error("Choose this salon first.");
    const { error } = await client.rpc("booking_deposit_install", { p_salon: currentSalon, p_installed: installed === true });
    if (error) throw new Error("The plugin could not be updated. Please retry.");
    revalidatePath("/market"); revalidatePath("/settings"); revalidatePath(`/book/${currentSalon}`);
    return { state: await bookingDepositState(currentSalon) };
    }, "manage");
  } catch (error) { return { error: error instanceof Error ? error.message : "The plugin could not be updated." }; }
}
export async function bookingDepositBillingAction(portal: boolean, targetSalonId?: string): Promise<RedirectResult> {
  try { return await withSettingsTarget(targetSalonId, async () => { const { salonId } = await marketPluginContext(); const context = await getCurrentBusinessContext();
    if (!context.user) throw new Error("Please sign in again.");
    return { url: await bookingDepositPayment(salonId, context.user.id, portal === true) };
    }, "manage");
  } catch (error) { return { error: error instanceof Error ? error.message : "Billing could not open." }; }
}
export async function connectBookingStripeAction(targetSalonId?: string): Promise<RedirectResult> {
  try {
    return await withSettingsTarget(targetSalonId, async () => {
    const { salonId } = await marketPluginContext();
    const context = await getCurrentBusinessContext();
    if (!context.user || !process.env.BOOKING_STRIPE_CONNECT_CLIENT_ID || !process.env.BOOKING_STRIPE_SECRET_KEY) throw new Error("Stripe Connect is not configured yet.");
    const nonce = randomUUID();
    (await cookies()).set("booking-stripe-state", JSON.stringify({ nonce, salonId, owner: context.user.id, expires: Date.now() + 600000 }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
    const url = new URL("https://connect.stripe.com/oauth/authorize");
    url.search = new URLSearchParams({ client_id: process.env.BOOKING_STRIPE_CONNECT_CLIENT_ID, response_type: "code", scope: "read_write", state: nonce,
      redirect_uri: new URL("/api/booking-payment/connect", REYLUMI_METADATA_BASE).href }).toString();
    return { url: url.href };
    }, "manage");
  } catch (error) { return { error: error instanceof Error ? error.message : "Stripe could not connect." }; }
}
