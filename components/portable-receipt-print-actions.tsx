"use client";
import { useRef } from "react";
import type { PortableTicketRow } from "@/app/pos/portable/actions";
import { useReceiptContext } from "./receipt-print-context";
import { ReceiptPrintActions } from "./receipt-print-actions";
import { portableTicketPrintReceipt } from "@/lib/portable-receipt-print";
import { receiptDevicePrintAuthority } from "@/lib/provisional-receipt-print";
import { portableBusinessDate } from "@/lib/portable-business-day";

export function PortableReceiptPrintActions({ ticket }: { ticket: PortableTicketRow }) {
  const context = useReceiptContext(), usesSavedSnapshot = useRef(false);
  if (!context || ticket.status !== "closed") return null;
  let receipt;
  try { receipt = portableTicketPrintReceipt(ticket, context.brand.salonName); } catch { return <p className="px-3 text-xs text-zinc-500">Reconnect and reload this saved ticket to prepare its receipt.</p>; }
  const loadReceipt = async () => {
    usesSavedSnapshot.current = false;
    if (navigator.onLine) {
      const date = portableBusinessDate(context.timezone, Date.parse(ticket.openedAt));
      let response: Response | undefined;
      try { response = await fetch("/api/pos/portable/tickets?date=" + encodeURIComponent(date), { cache: "no-store", signal: AbortSignal.timeout(12000) }); } catch { /* Native admission below is the only offline fallback. */ }
      if (response && response.status < 500) {
        if (!response.ok) throw new Error("Reconnect and reopen the saved ticket before printing.");
        const data = await response.json(), current = Array.isArray(data.tickets) ? data.tickets.find((t: PortableTicketRow) => t.id === ticket.id) : null;
        if (!current || current.status !== "closed") throw new Error("This ticket changed. Reload Tickets before printing.");
        return portableTicketPrintReceipt(current, context.brand.salonName);
      }
    }
    // Only the existing admitted resource snapshot may be used offline; no new
    // financial cache or browser-storage fallback is introduced for printing.
    if (!(await receiptDevicePrintAuthority(context.scope))) throw new Error("Reconnect and unlock POS before printing this saved receipt.");
    usesSavedSnapshot.current = true;
    return portableTicketPrintReceipt(ticket, context.brand.salonName);
  };
  const validatePrint = async () => { if (usesSavedSnapshot.current && !(await receiptDevicePrintAuthority(context.scope))) throw new Error("Reconnect and unlock POS before printing this saved receipt."); };
  return <div className="px-3 pb-2"><ReceiptPrintActions receipt={receipt} receiptId={ticket.id} loadReceipt={loadReceipt} validatePrint={validatePrint} /></div>;
}
