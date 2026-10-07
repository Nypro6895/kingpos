"use server";
import { getCustomerBookingDetail } from "@/lib/customer-bookings";
import { getCustomerActivityReceipt } from "@/lib/customer-activity";

export async function loadHistoryDetailsAction(input: { bookingId?: string; ticketId?: string }) {
  const [bookingResult, receiptResult] = await Promise.all([
    input.bookingId ? getCustomerBookingDetail(input.bookingId) : null,
    input.ticketId ? getCustomerActivityReceipt(input.ticketId) : null,
  ]);
  if (bookingResult && !bookingResult.ok) return { error: bookingResult.message };
  if (receiptResult && !receiptResult.ok) return { error: receiptResult.message };
  const raw = bookingResult?.ok ? bookingResult.data : null;
  let receipt = receiptResult?.ok ? receiptResult.data : null;
  if (raw?.historyEvidence?.ticket && !receipt) {
    const linkedReceipt = await getCustomerActivityReceipt(raw.historyEvidence.ticket.ticketId);
    if (!linkedReceipt.ok) return { error: linkedReceipt.message };
    receipt = linkedReceipt.data;
  }
  if (input.bookingId && !raw || input.ticketId && !receipt) return { error: "History details were not found." };
  if (raw && receipt && raw.historyEvidence?.ticket?.ticketId !== receipt.ticketId) return { error: "These records are no longer linked. Refresh history." };
  // Only customer-facing notes and timeline fields leave the server.
  const booking = raw ? { ...raw, notes: null, internal_notes: null,
    lines: raw.lines?.map(line => ({ ...line, service_note: null })),
    events: undefined,
  } : null;
  return { booking, receipt, error: null };
}
