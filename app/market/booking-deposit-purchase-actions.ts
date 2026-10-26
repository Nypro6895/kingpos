"use server";

import { revalidatePath } from "next/cache";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { marketPluginContext } from "@/lib/market-plugins";
import { marketBankBillingState } from "@/lib/market-bank-billing";
import { bookingDepositPayment } from "@/lib/booking-deposit-subscription";
import { bookingDepositPurchaseState, confirmBookingDepositPurchase, BOOKING_DEPOSIT_PRODUCT_PATH } from "@/lib/booking-deposit-market";
import { prepareBookingDepositCheckout } from "@/lib/booking-deposit-checkout";

function settingsPath(salonId: string, confirmed = false) {
  return `${BOOKING_DEPOSIT_PRODUCT_PATH}/settings?salon=${encodeURIComponent(salonId)}${confirmed ? "&confirmed=1" : ""}`;
}

export async function beginBookingDepositCheckoutAction(expectedSalonId?: string) {
  try {
    const context = await getCurrentBusinessContext();
    if (!context.user) return { path: `/login?next=${encodeURIComponent(BOOKING_DEPOSIT_PRODUCT_PATH)}` };
    const { client, salonId } = await marketPluginContext();
    if (!expectedSalonId || salonId !== expectedSalonId) throw new Error("Your salon changed. Reload this page before continuing.");
    const state = await bookingDepositPurchaseState(salonId);
    if (state.paid) {
      if (!state.installed) {
        const { error } = await client.rpc("booking_deposit_install", { p_salon: salonId, p_installed: true });
        if (error) throw new Error("Booking Deposit could not be added. Please try again.");
      }
      revalidatePath("/market");
      return { path: settingsPath(salonId) };
    }
    const billing = await marketBankBillingState(salonId);
    if (billing.settings.version > 0) {
      if (!billing.available) throw new Error(billing.reason || "Payment is unavailable. Please try again later.");
      const result = await prepareBookingDepositCheckout(salonId);
      if (result.url) return { url: result.url };
      if (result.complete) return { path: `${BOOKING_DEPOSIT_PRODUCT_PATH}/payment?salon=${encodeURIComponent(salonId)}` };
      throw new Error("Payment is still being confirmed. Check again in a moment.");
    }
    return { url: await bookingDepositPayment(salonId, context.user.id, false) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Payment could not open. Please try again." };
  }
}

export async function confirmBookingDepositCheckoutAction(salonId: string) {
  try {
    if (!await confirmBookingDepositPurchase(salonId)) return { pending: true };
    revalidatePath("/market");
    revalidatePath("/settings");
    revalidatePath(`${BOOKING_DEPOSIT_PRODUCT_PATH}/settings`);
    return { path: settingsPath(salonId, true) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Payment confirmation is pending. Please try again." };
  }
}
