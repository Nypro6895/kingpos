"use server";
import { marketPluginContext } from "@/lib/market-plugins";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { taxCompanyPayment } from "@/lib/tax-company-subscription";
export async function taxCompanyPaymentAction(portal: boolean) {
  try {
    const { salonId } = await marketPluginContext();
    const context = await getCurrentBusinessContext();
    if (!context.user) throw new Error("Please sign in again.");
    return { url: await taxCompanyPayment(salonId, context.user.id, portal === true) };
  } catch (error) { return { error: error instanceof Error ? error.message : "Checkout could not open." }; }
}
