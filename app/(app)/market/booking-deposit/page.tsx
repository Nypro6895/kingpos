import { withExperiencePage } from "@/components/experience-page";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { marketPluginContext } from "@/lib/market-plugins";
import { bookingDepositPurchaseState } from "@/lib/booking-deposit-market";
import { BookingDepositProduct } from "@/app/market/booking-deposit-product";

export const metadata: Metadata = { title: "Booking Deposit | Reylumi Market", description: "Collect a deposit or full payment when customers book online." };

async function BookingDepositPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  await connection();
  const [context, query] = await Promise.all([getRequestBusinessContext(), searchParams]);
  let installed = false;
  if (context.currentSalon) {
    // The permission-checked read must succeed before reading paid entitlement.
    try {
      const { salonId } = await marketPluginContext();
      const purchase = await bookingDepositPurchaseState(salonId);
      installed = Boolean(purchase.installed && purchase.paid);
    } catch { /* Public product information remains available. Checkout rechecks permissions. */ }
  }
  return <BookingDepositProduct key={context.currentSalon?.id ?? "guest"} salonId={context.currentSalon?.id} installed={installed} cancelled={query.cancelled === "1"} />;
}

export default withExperiencePage(BookingDepositPage);
