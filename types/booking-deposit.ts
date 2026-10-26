export const BOOKING_DEPOSIT_PLUGIN = "booking-deposit";
export const BOOKING_DEPOSIT_MONTHLY_CENTS = 590;
export type BookingDepositSettings = {
  enabled: boolean;
  mode: "fixed" | "percent" | "full";
  value: number;
  checkout: "both" | "embedded" | "hosted";
  testMode?: boolean;
};
export type BookingDepositState = BookingDepositSettings & {
  active: boolean;
  subscribed: boolean;
  connected: boolean;
  installed?: boolean;
};
export const EMPTY_BOOKING_DEPOSIT: BookingDepositState = {
  enabled: false, mode: "fixed", value: 20, checkout: "both",
  active: false, subscribed: false, connected: false,
};
export function bookingDepositCents(totalCents: number, settings: BookingDepositSettings) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isFinite(settings.value) || settings.value <= 0) throw new Error("Invalid payment amount.");
  if (settings.mode === "percent" && settings.value > 100) throw new Error("Deposit percentage must be at most 100.");
  const amount = settings.mode === "full" ? totalCents : settings.mode === "percent" ? Math.round(totalCents * settings.value / 100) : Math.round(settings.value * 100);
  return Math.min(totalCents, amount);
}
