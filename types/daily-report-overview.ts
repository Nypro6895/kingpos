export type DailyOverviewLine = { name: string; staff: { id: string; name: string }[]; amount: number | null };
export type DailyOverviewVisit = {
  id: string; customerName: string; checkedInAt: string | null; ticketId: string | null;
  ticketNumber: string | null; status: "checked_in" | "submitted" | "open" | "cancelled" | "voided";
  lines: DailyOverviewLine[]; amount: number | null;
};
export type DailyOverviewStaff = {
  id: string; name: string; checkedInAt: string | null; sequence: number | null;
  turns: number; posAmount: number;
};
export type DailyReportOverview = {
  date: string; timeZone: string; updatedAt: string; staff: DailyOverviewStaff[];
  visits: DailyOverviewVisit[]; checkInCount: number; submittedCount: number; notes: string[];
};
