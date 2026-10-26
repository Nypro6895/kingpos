import type { HistoryTicket } from "@/lib/booking-history";

export type PersonalQrVisit = {
  visitId: string; salonId: string; salonName: string; checkedInAt: string;
  queueNumber: number | null; status: string; ticketId: string | null;
  receipt: HistoryTicket | null;
  requestedServices: { id: string; name: string }[];
  lines: { id: string; serviceName: string; staffName: string; amount: number }[];
  workingStaff: string[];
  ready: { at: string; staffName: string | null; chair: string | null } | null;
};
export type PersonalQrWorkspace = {
  userId: string; code: string; expiresAt: string; updatedAt: string; visits: PersonalQrVisit[];
};
export type PersonalQrCatalog = {
  salonId: string; salonName: string;
  services: { id: string; name: string; category?: string; base_price?: number }[];
};
export type PersonalStaffPreview = {
  userId: string; name: string; phoneHint: string | null; emailHint: string | null;
  status: "available" | "connected" | "pending";
};
