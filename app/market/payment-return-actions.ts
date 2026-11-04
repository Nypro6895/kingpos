"use server";
import { reconcileMarketPaymentReturn } from "@/lib/market-payment-return";

// The return path carries no purchase, provider or salon authority. The original
// authenticated owner context and saved salon purchases decide what to refresh.
export async function reconcileMarketReturnAction(expectedSalonId: string) {
  try {
    await reconcileMarketPaymentReturn(expectedSalonId);
    return { message: "Payment status checked." };
  } catch {
    return { message: "Payment confirmation is pending. Check payment status before paying again." };
  }
}
