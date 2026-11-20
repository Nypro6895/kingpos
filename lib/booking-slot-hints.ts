import type { BookingWorkspaceFilters, BookingWorkspaceItem, BookingWorkspaceOptions, BookingWorkspaceRange } from "./bookings";

type Line = { serviceId: string; staffId: string };
const effective = (row: { effective_start_date: string | null; effective_end_date: string | null }, date: string) =>
  (!row.effective_start_date || row.effective_start_date <= date) && (!row.effective_end_date || row.effective_end_date >= date);

export function bookingHintCalendarDates(range: BookingWorkspaceRange, filters: BookingWorkspaceFilters) {
  // A filtered calendar intentionally omits reservations; it cannot be used to
  // infer that the absent appointments leave a professional free.
  return filters.query || filters.serviceId || filters.source || filters.staffId || filters.status ? [] : range.days.map(day => day.date);
}

export function bookingHintStaff(options: BookingWorkspaceOptions, serviceId: string, date: string) {
  const service = options.services.find(row => row.id === serviceId && row.is_active);
  if (!service) return [];
  return options.staff.filter(staff => staff.is_active && staff.salon_id === service.salon_id && options.assignments.some(row =>
    row.is_active && row.salon_id === service.salon_id && row.staff_id === staff.id && row.service_id === serviceId && effective(row, date)));
}

/** Suggestions from the loaded calendar, not an authorization or reservation.
 * The canonical server validator remains responsible for fresh/concurrent data. */
export function generateBookingSlotHints(input: {
  bookings: BookingWorkspaceItem[]; date: string; loadedDates: readonly string[]; lines: Line[]; options: BookingWorkspaceOptions;
  slotIntervalMinutes: number; cleanupBufferMinutes: number; timezone: string;
  toUTC: (date: string, time: string, timezone: string) => string;
  toLocal: (instant: string, timezone: string) => string;
}) {
  const { date, options, timezone } = input;
  if (!input.loadedDates.includes(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(input.slotIntervalMinutes) || input.slotIntervalMinutes < 1 || input.slotIntervalMinutes > 240
    || !input.lines.length || input.lines.length > 20 || input.lines.some(line => !line.staffId || !bookingHintStaff(options, line.serviceId, date).some(staff => staff.id === line.staffId))) return [];
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  const rulesFor = (staffId: string, type: "working" | "break") => options.availabilityRules.filter(row => row.is_active && row.rule_type === type && row.day_of_week === day
    && (!row.staff_id || row.staff_id === staffId) && effective(row, date));
  const workingFor = (staffId: string) => {
    const rules = rulesFor(staffId, "working"), own = rules.filter(row => row.staff_id === staffId);
    // Staff-specific working hours replace shared hours for that effective day.
    return own.length ? own : rules.filter(row => row.staff_id === null);
  };
  const span = (row: { starts_at_local: string; ends_at_local: string }) => [
    Date.parse(input.toUTC(date, row.starts_at_local.slice(0, 5), timezone)), Date.parse(input.toUTC(date, row.ends_at_local.slice(0, 5), timezone)),
  ];
  const overlap = (a: number, b: number, c: number, d: number) => a < d && b > c;
  const staffIds = [...new Set(input.lines.map(line => line.staffId))];
  const working = new Map(staffIds.map(id => [id, workingFor(id).map(span)]));
  const breaks = new Map(staffIds.map(id => [id, rulesFor(id, "break").map(span)]));
  const reservations = new Map(staffIds.map(id => [id, [] as number[][]]));
  for (const block of options.timeBlocks) if (block.is_active !== false && !block.cancelled_at) {
    for (const id of staffIds) if (!block.staff_id || block.staff_id === id) reservations.get(id)!.push([Date.parse(block.starts_at), Date.parse(block.ends_at)]);
  }
  for (const booking of input.bookings) if (!["cancelled", "no_show"].includes(booking.normalizedStatus)) {
    for (const row of booking.lines) if (row.assigned_staff_id && reservations.has(row.assigned_staff_id) && !["cancelled", "no_show"].includes(row.line_status)
      && row.scheduled_start_at && row.scheduled_end_at) reservations.get(row.assigned_staff_id)!.push([Date.parse(row.scheduled_start_at), Date.parse(row.scheduled_end_at)]);
  }
  const midnight = Date.parse(input.toUTC(date, "23:59", timezone)) + 60_000;
  const minutesFor = (line: Line) => {
    const service = options.services.find(row => row.id === line.serviceId)!;
    const assignment = options.assignments.find(row => row.is_active && row.staff_id === line.staffId && row.service_id === line.serviceId && effective(row, date));
    return Number(assignment?.custom_duration_minutes ?? service.duration_minutes) + Math.max(0, input.cleanupBufferMinutes);
  };
  const durations = input.lines.map(minutesFor);
  if (durations.some(value => !Number.isFinite(value) || value <= 0 || value > 1440)) return [];
  const hints = new Set<string>();
  for (const [begin, finish] of working.get(input.lines[0].staffId)!) {
    if (!Number.isFinite(begin) || !Number.isFinite(finish) || finish <= begin || finish - begin > 86_400_000) continue;
    for (let start = begin; start < finish && hints.size < 200; start += input.slotIntervalMinutes * 60_000) {
      let cursor = start;
      const fits = input.lines.every((line, index) => {
        const end = cursor + durations[index] * 60_000, from = cursor; cursor = end;
        if (end >= midnight) return false;
        if (!working.get(line.staffId)!.some(([a, b]) => a <= from && b >= end)) return false;
        if (breaks.get(line.staffId)!.some(([a, b]) => overlap(a, b, from, end))) return false;
        return !reservations.get(line.staffId)!.some(([a, b]) => overlap(a, b, from, end));
      });
      if (fits) hints.add(input.toLocal(new Date(start).toISOString(), timezone));
    }
  }
  return [...hints].sort();
}
