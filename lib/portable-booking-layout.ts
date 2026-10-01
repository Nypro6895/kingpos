// Wall-clock coordinates keep the schedule in the salon's timezone on every device.
export function bookingDate(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function bookingMinute(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  return Number(parts.find(p => p.type === "hour")?.value) * 60
    + Number(parts.find(p => p.type === "minute")?.value);
}

type TimedAppointment = { id: string; startAt: string; endAt: string };

export function bookingDayInterval(item: TimedAppointment, date: string, timeZone: string) {
  const first = bookingDate(item.startAt, timeZone);
  const last = bookingDate(item.endAt, timeZone);
  if (first > date || last < date || Date.parse(item.endAt) <= Date.parse(item.startAt)) return null;
  const start = first < date ? 0 : bookingMinute(item.startAt, timeZone);
  const end = last > date ? 1440 : bookingMinute(item.endAt, timeZone);
  // A repeated DST hour still needs a visible card, while midnight endings do not spill over.
  if (end === 0 && last === date) return null;
  return { start, end: Math.max(start + 1, end) };
}

// Assign lanes per connected overlap group so simultaneous appointments never cover each other.
export function layoutBookingColumn<T extends TimedAppointment>(items: T[], date: string, timeZone: string) {
  const sorted = items.flatMap(item => {
    const interval = bookingDayInterval(item, date, timeZone);
    return interval ? [{ item, ...interval, lane: 0, lanes: 1 }] : [];
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.item.id.localeCompare(b.item.id));
  let group: typeof sorted = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const finish = () => { for (const row of group) row.lanes = laneEnds.length; };
  for (const row of sorted) {
    if (row.start >= groupEnd) {
      finish(); group = []; laneEnds = [];
    }
    let lane = laneEnds.findIndex(end => end <= row.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = row.end;
    row.lane = lane;
    group.push(row);
    groupEnd = Math.max(...laneEnds);
  }
  finish();
  return sorted;
}
