import { withExperiencePage } from "@/components/experience-page";
import { BookingPaymentStatus } from "@/components/booking-payment-status";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Booking payment | Reylumi", robots: { index: false, follow: false }, referrer: "no-referrer" };
async function BookingPaymentPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ cancelled?: string }> }) {
  const { token } = await params, query = await searchParams;
  return <main className="mx-auto grid max-w-xl gap-4 p-6"><h1 className="text-2xl font-semibold">Booking payment</h1>{query.cancelled ? <p>Checkout closed. Your appointment will be submitted only after a successful payment.</p> : null}<BookingPaymentStatus token={token} /></main>;
}

export default withExperiencePage(BookingPaymentPage);
