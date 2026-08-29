export type CustomerVisitSource =
  | "appointment"
  | "customer_screen"
  | "walk_in";

export type CustomerVisitStatus =
  | "cancelled"
  | "checkout"
  | "completed"
  | "in_service"
  | "waiting";

export type CustomerVisitRequestedService = {
  basePrice: number;
  category: string | null;
  durationMinutes: number;
  id: string;
  name: string;
  sortOrder: number;
};

export type CustomerVisitQueueItem = {
  appointmentId: string | null;
  appointmentStartAt: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  checkedInAt: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  id: string;
  requestedServices: CustomerVisitRequestedService[];
  salonId: string;
  serviceLabel: string | null;
  source: CustomerVisitSource;
  status: CustomerVisitStatus;
  ticketId: string | null;
};

export type CustomerDisplayVisit = {
  appointmentId: string | null;
  checkedInAt: string;
  customerId: string;
  firstName: string | null;
  id: string;
  requestedServices: CustomerVisitRequestedService[];
  source: CustomerVisitSource;
  status: CustomerVisitStatus;
  ticketId: string | null;
};
