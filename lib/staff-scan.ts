import type { RelayTicket } from "@/types/service-relay";
import type { ScanEntryLine } from "@/types/staff-scan";

export function validScanLines(lines: ScanEntryLine[]) {
  return lines.length > 0 && lines.length <= 30 && lines.every(line =>
    Boolean(line.serviceId) && /^\d+(\.\d{1,2})?$/.test(line.amount) && Number(line.amount) > 0);
}

/** Only accept our two check-in QR formats; never navigate a scanned URL. */
export function parseStaffScanCode(code: string): { visitId: string } | { passToken: string } | null {
  const uuid = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
  const receipt = new RegExp(`^reylumi:checkin:${uuid}$`, "i").exec(code.trim());
  if (receipt) return { visitId: receipt[1] };
  try {
    const url = new URL(code.trim());
    if (url.protocol !== "https:" || !["reylumi.com", "www.reylumi.com"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) return null;
    const pass = new RegExp(`^/visit/${uuid}/?$`, "i").exec(url.pathname);
    return pass ? { passToken: pass[1] } : null;
  } catch { return null; }
}

export function scanOffer(ticket: RelayTicket, staffId: string) {
  return ticket.offers.find(offer => offer.staffId === staffId && offer.status === "working")
    ?? [...ticket.offers].reverse().find(offer => offer.staffId === staffId && offer.status === "done");
}
