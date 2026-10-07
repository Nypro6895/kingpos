import { listCustomerBookings } from "@/lib/customer-bookings";
import Link from "next/link";

export async function BeautyAppointment() {
  const result = await listCustomerBookings({ scope: "upcoming", limit: 1 });
  if (!result.ok) return <p className="text-sm text-text-secondary">Appointment could not be loaded. <Link href="/my-bookings" className="text-brand-teal">Open bookings</Link></p>;
  const booking = result.data[0];
  return <section className="relative rounded-2xl border border-border-subtle bg-surface p-4" aria-label="Your next appointment">
    <span role="img" className="absolute right-3 top-3 text-text-secondary" title="Only you can see your appointment" aria-label="Only you can see your appointment"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg></span>
    <p className="text-xs font-semibold text-text-secondary">Next appointment</p>
    {booking ? <>
      <h2 className="mt-2 pr-6 text-lg font-semibold">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: booking.salon_timezone_snapshot }).format(new Date(booking.start_at))}</h2>
      <p className="mt-1 text-sm text-text-secondary">{booking.salon?.displayName ?? "Salon appointment"}</p>
      <p className="mt-1 text-xs text-text-secondary">{booking.lines?.filter(line => line.line_type === "service").map(line => line.service_name_snapshot).join(" · ")}</p>
      <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs capitalize text-brand-teal">{booking.status.replaceAll("_", " ")}</span><Link className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-teal" href={`/my-bookings/${booking.id}`}>View booking →</Link></div>
    </> : <p className="mt-2 text-sm text-text-secondary">No upcoming appointments. <Link href="/my-bookings" className="text-brand-teal">View bookings</Link></p>}
  </section>;
}
