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
