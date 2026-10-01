import type { PortableBookAppointment } from "@/app/pos/portable/actions";
export const PORTABLE_BOOKING_TICKET = "kingpos:booking-ticket";
export type BookingTicketRequest = { appointment: PortableBookAppointment; respond: (error?: string) => void };
export function openBookingInPortablePos(appointment: PortableBookAppointment) {
  let response: string | undefined = "POS is not ready. Open the POS tab and try again.";
  window.dispatchEvent(new CustomEvent<BookingTicketRequest>(PORTABLE_BOOKING_TICKET, {
    detail: { appointment, respond: error => { response = error; } },
  }));
  if (response) throw new Error(response);
  window.history.pushState(null, "", "/pos/portable");
}
