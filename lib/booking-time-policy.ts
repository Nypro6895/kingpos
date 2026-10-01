import { bookingDate, bookingMinute } from "./portable-booking-layout";
import { portableBookingTime } from "./portable-booking-time";

export type BookingTimePolicy = {
  autoAssignEnabled?: boolean;
  sameDayBookingEnabled: boolean;
  minimumLeadTimeMinutes: number;
  maximumAdvanceWindowDays: number;
  slotIntervalMinutes: number;
};

export const DEFAULT_BOOKING_TIME_POLICY: BookingTimePolicy = {
  sameDayBookingEnabled: false,
  minimumLeadTimeMinutes: 120,
  maximumAdvanceWindowDays: 60,
  slotIntervalMinutes: 15,
};

function localInput(instant: number, timezone: string) {
  const iso = new Date(instant).toISOString();
  const minute = bookingMinute(iso, timezone);
  return `${bookingDate(iso, timezone)}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function validateBookingStart(startAt: string, policy: BookingTimePolicy, timezone: string, now = Date.now()) {
  const start = Date.parse(startAt);
  if (!Number.isFinite(start)) return "Choose a valid appointment time.";
  if (start <= now) return "Choose a future appointment time. Past times cannot be booked.";
  if (!policy.sameDayBookingEnabled && bookingDate(startAt, timezone) <= bookingDate(new Date(now).toISOString(), timezone)) {
    return "Same-day booking is disabled. Choose tomorrow or a later date.";
  }
  if (start < now + policy.minimumLeadTimeMinutes * 60000) return `Allow at least ${policy.minimumLeadTimeMinutes} minutes before the appointment.`;
  if (start > now + policy.maximumAdvanceWindowDays * 86400000) return `Appointments can be booked up to ${policy.maximumAdvanceWindowDays} days ahead.`;
  return null;
}

export function bookingInputBounds(policy: BookingTimePolicy, timezone: string, now = Date.now()) {
  let earliest = Math.ceil((now + Math.max(1, policy.minimumLeadTimeMinutes) * 60000) / 60000) * 60000;
  const today = bookingDate(new Date(now).toISOString(), timezone);
  if (!policy.sameDayBookingEnabled && bookingDate(new Date(earliest).toISOString(), timezone) === today) {
    const tomorrow = new Date(`${today}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const midnight = portableBookingTime(`${tomorrow.toISOString().slice(0, 10)}T00:00`, timezone);
    if (midnight) earliest = Math.max(earliest, Date.parse(midnight));
  }
  return { min: localInput(earliest, timezone), max: localInput(now + policy.maximumAdvanceWindowDays * 86400000, timezone) };
}

// Suggest a policy-valid starting time; availability is a separate scheduling check.
export function defaultBookingStart(date: string, policy: BookingTimePolicy, timezone: string, now = Date.now()) {
  const bounds = bookingInputBounds(policy, timezone, now);
  let candidate = `${date < bounds.min.slice(0, 10) ? bounds.min.slice(0, 10) : date}T09:00`;
  if (candidate < bounds.min) candidate = bounds.min;
  if (candidate > bounds.max) return "";
  let instant = portableBookingTime(candidate, timezone);
  if (!instant) return "";
  const step = Math.max(1, policy.slotIntervalMinutes);
  const remainder = bookingMinute(instant, timezone) % step;
  if (remainder) instant = new Date(Date.parse(instant) + (step - remainder) * 60000).toISOString();
  return validateBookingStart(instant, policy, timezone, now) ? "" : localInput(Date.parse(instant), timezone);
}
