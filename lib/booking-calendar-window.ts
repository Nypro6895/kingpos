export type BookingOpeningHours = {
  date: string;
  source: "salon" | "staff" | "unavailable";
  intervals: { start: number; end: number }[];
};

/** Include exceptional appointments even when the salon is closed. */
export function bookingCalendarWindow(hours: BookingOpeningHours | undefined, date: string, appointments: {start: number; end: number}[], currentMinute: number | null = null) {
  const current = hours?.date === date && hours.source !== "unavailable";
  const intervals = current ? hours.intervals : [];
  const closed = !!current && intervals.length === 0;
  const starts = [...intervals.map(row => row.start), ...appointments.map(row => row.start)];
  const ends = [...intervals.map(row => row.end), ...appointments.map(row => row.end)];
  // Keep today's clock visible before opening and after closing, with room to scroll.
  if (currentMinute !== null) {
    starts.push(Math.max(0, currentMinute - 60));
    ends.push(Math.min(1440, currentMinute + 60));
  }
  const start = Math.max(0, Math.floor((starts.length ? Math.min(...starts) : 8 * 60) / 30) * 30);
  const end = Math.min(1440, Math.max(start + 60, Math.ceil((ends.length ? Math.max(...ends) : 18 * 60) / 30) * 30));
  return {start, end, closed, intervals, known: !!current,
    outside: !!current && appointments.some(row => !intervals.some(window => row.start >= window.start && row.end <= window.end))};
}
