// Matches get_salon_business_date: midnight in the salon timezone, not 24 hours.
export function portableBusinessDate(timezone: string, at: string | number = Date.now()) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function attendanceIsCurrent(snapshotDay: string, currentDay: string) {
  return Boolean(currentDay) && snapshotDay === currentDay;
}
