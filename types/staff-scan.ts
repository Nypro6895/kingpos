import type { RelayTicket } from "./service-relay";

export type ScanService = { id: string; name: string; price: number };
export type ScanWaitingCustomer = {
  visitId: string; customerName: string; queueNumber: number; checkedInAt: string;
  status: string; workingStaffName: string | null;
  requestedServices: { id: string; name: string }[];
};
export type StaffScanWorkspace = {
  enabled: boolean; staffId: string; current: RelayTicket[];
  waiting: ScanWaitingCustomer[]; services: ScanService[];
};
export type ScanEntryLine = { id: string; serviceId: string; amount: string };
export type ScanDeskLine = ScanEntryLine & { staffId: string };
export type HoldPosDraftInput = { note?: string; requestId: string; customerId: string; visitId?: string | null; lines: ScanDeskLine[]; tip: number; discount: number };
export type HeldTicketLink = { visitId: string; revision: number };
export type HeldVisitState = { visitId: string; revision: number | null; status: string; ticketId: string | null; completed: boolean; cancelled: boolean };
export type UpdatePosHeldTicketInput = HeldTicketLink & { note?: string; lines: ScanDeskLine[]; tip: number; discount: number; finalize: boolean };
