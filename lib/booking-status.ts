import type { BookingSettings } from "@/types/booking";

export type SalonOnlineBookingSettings = Pick<
  BookingSettings,
  "booking_enabled" | "guest_booking_enabled" | "online_booking_visible"
>;

export type SalonOnlineBookingState =
  | "active"
  | "booking_off"
  | "guest_off"
  | "hidden"
  | "missing";

export type SalonOnlineBookingStatus = {
  bookingEnabled: boolean;
  guestBookingEnabled: boolean;
  onlineBookingOpen: boolean;
  onlineBookingVisible: boolean;
  state: SalonOnlineBookingState;
};

export function getSalonOnlineBookingStatus(
  settings: Partial<SalonOnlineBookingSettings> | null | undefined,
): SalonOnlineBookingStatus {
  const bookingEnabled = settings?.booking_enabled === true;
  const onlineBookingVisible = settings?.online_booking_visible === true;
  const guestBookingEnabled = settings?.guest_booking_enabled === true;
  const onlineBookingOpen =
    bookingEnabled && onlineBookingVisible && guestBookingEnabled;
  const state: SalonOnlineBookingState = !settings
    ? "missing"
    : !bookingEnabled
      ? "booking_off"
      : !onlineBookingVisible
        ? "hidden"
        : !guestBookingEnabled
          ? "guest_off"
          : "active";

  return {
    bookingEnabled,
    guestBookingEnabled,
    onlineBookingOpen,
    onlineBookingVisible,
    state,
  };
}
