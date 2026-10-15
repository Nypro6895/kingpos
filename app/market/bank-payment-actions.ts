"use server";

import { revalidatePath } from "next/cache";
import { marketPluginContext } from "@/lib/market-plugins";
import { prepareMarketBankPurchase } from "@/lib/market-payments";
import { marketBankBillingError, marketBankBillingState, normalizeMarketBankBillingState, normalizeMarketBankOrder } from "@/lib/market-bank-billing";
import type { MarketBankPaymentActionResult } from "@/types/market-bank-billing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function refreshMarketBankBilling() {
  return marketBankBillingState();
}

export async function createMarketBankOrder(pluginId: string, requestId: string): Promise<MarketBankPaymentActionResult> {
  if (typeof pluginId !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(pluginId)
    || typeof requestId !== "string" || !UUID.test(requestId)) return { error: "Please refresh Market and try again." };
  try {
    const { client, salonId } = await marketPluginContext();
    await prepareMarketBankPurchase(salonId, pluginId);
    // The authenticated RPC authorizes ownership and freezes the current price and bank.
    const { data, error } = await client.rpc("market_billing_create_order", {
      p_salon: salonId, p_plugin: pluginId, p_request: requestId,
    });
    if (error) return { error: marketBankBillingError(error) };
    const order = normalizeMarketBankOrder(data);
    if (!order || order.salon_id !== salonId || order.plugin_id !== pluginId) {
      return { error: "The payment order could not be loaded. Refresh before trying again." };
    }
    revalidatePath("/market");
    return { order, state: await marketBankBillingState(salonId) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The payment order could not be created." };
  }
}

export async function cancelMarketBankOrder(orderId: string): Promise<MarketBankPaymentActionResult> {
  if (typeof orderId !== "string" || !UUID.test(orderId)) return { error: "Please select a valid payment order." };
  try {
    const { client, salonId } = await marketPluginContext();
    const { data: ownerData, error: ownerError } = await client.rpc("market_billing_owner_state", { p_salon: salonId });
    if (ownerError) return { error: marketBankBillingError(ownerError) };
    const ownerState = normalizeMarketBankBillingState(ownerData, salonId);
    if (!ownerState.available || !ownerState.orders.some(order => order.id === orderId)) {
      return { error: "This invoice is not available in your current salon. Refresh Market and try again." };
    }
    // The RPC locks the order and rejects cancellation after any receipt of money.
    const { data, error } = await client.rpc("market_billing_cancel_order", { p_order: orderId });
    if (error) return { error: marketBankBillingError(error) };
    const order = normalizeMarketBankOrder(data);
    if (!order || order.salon_id !== salonId) return { error: "The payment order could not be loaded. Please refresh." };
    revalidatePath("/market");
    revalidatePath(`/market/orders/${order.id}`);
    return { order, state: await marketBankBillingState(salonId) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The payment order could not be cancelled." };
  }
}
