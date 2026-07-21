import "server-only";

import { recalculateStaffEarningsForDate } from "@/lib/pos-ticket-staff-earnings";

type BackfillPosTicketStaffEarningsInput = {
  endDate: string;
  salonId: string;
  startDate: string;
};

function parseLocalDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error("Backfill dates must use YYYY-MM-DD.");
  }

  const [, year, month, day] = match;

  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

function addDays(dateString: string, days: number) {
  const parts = parseLocalDateParts(dateString);

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
    .toISOString()
    .slice(0, 10);
}

export async function backfillPosTicketStaffEarningsForDateRange({
  endDate,
  salonId,
  startDate,
}: BackfillPosTicketStaffEarningsInput) {
  const processedDates: string[] = [];
  let currentDate = startDate;

  while (currentDate <= endDate) {
    await recalculateStaffEarningsForDate(salonId, currentDate);
    processedDates.push(currentDate);
    currentDate = addDays(currentDate, 1);
  }

  return processedDates;
}
