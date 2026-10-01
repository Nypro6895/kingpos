// Interpret the appointment in the salon's timezone, independent of the kiosk.
export function portableBookingTime(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const desired = match.slice(1).map(Number);
  const wallClock = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (instant: number) => {
    const values = format.formatToParts(new Date(instant));
    return ["year", "month", "day", "hour", "minute"].map(key => Number(values.find(part => part.type === key)?.value));
  };
  let instant = wallClock;
  for (let i = 0; i < 3; i++) {
    const p = parts(instant);
    const difference = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]) - wallClock;
    instant -= difference;
  }
  return parts(instant).every((part, index) => part === desired[index]) ? new Date(instant).toISOString() : null;
}
