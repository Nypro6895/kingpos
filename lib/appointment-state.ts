/** Derived display state; never writes an appointment merely because time passed. */
export function appointmentState(status: string, startAt: string, now = Date.now()): string {
  const normalized = status === "scheduled" ? "confirmed" : status;
  return ["pending", "confirmed"].includes(normalized) && Date.parse(startAt) < now ? "overdue" : normalized;
}
export function appointmentSummary(bookings: Array<{status: string; start_at: string}>, now: number) {
  const counts = {completed: 0, inService: 0, upcoming: 0, overdue: 0, arrived: 0, cancelled: 0};
  for (const booking of bookings) {
    const state = appointmentState(booking.status, booking.start_at, now);
    if (state === "completed") counts.completed++;
    else if (state === "in_service") counts.inService++;
    else if (state === "checked_in") counts.arrived++;
    else if (["cancelled", "no_show"].includes(state)) counts.cancelled++;
    else if (state === "overdue") counts.overdue++;
    else counts.upcoming++;
  }
  return counts;
}
