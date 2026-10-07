import { getCustomerBookingDetail } from "@/lib/customer-bookings";
import { notFound, redirect } from "next/navigation";

export default async function MyBookingDetailPage({ params, searchParams }: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const [{ bookingId }, messages] = await Promise.all([params, searchParams]);
  const result = await getCustomerBookingDetail(bookingId);
  if (!result.ok && result.code === "sign_in_required") redirect(`/login?next=${encodeURIComponent(`/my-bookings/${bookingId}`)}`);
  if (!result.ok || !result.data) notFound();
  const booking = result.data;
  const tab = booking.status === "cancelled" ? "cancelled" : new Date(booking.start_at).getTime() <= Date.now() || booking.historyEvidence?.ticket ? "past" : "upcoming";
  const query = new URLSearchParams({ details: booking.id, tab });
  if (messages.message) query.set("message", messages.message);
  if (messages.error) query.set("error", messages.error);
  redirect(`/my-bookings?${query.toString()}`);
}
