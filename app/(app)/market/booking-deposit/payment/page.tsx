import { withExperiencePage } from "@/components/experience-page";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { BookingDepositPaymentReturn } from "@/app/market/booking-deposit-payment-return";

async function BookingDepositPaymentPage({ searchParams }: { searchParams: Promise<{ salon?: string }> }) {
  await connection();
  const [context, query] = await Promise.all([getRequestBusinessContext(), searchParams]);
  const salonId = typeof query.salon === "string" ? query.salon : "";
  if (!context.user) {
    const next = `/market/booking-deposit/payment?salon=${encodeURIComponent(salonId)}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return <BookingDepositPaymentReturn key={salonId} salonId={salonId} />;
}

export default withExperiencePage(BookingDepositPaymentPage);
