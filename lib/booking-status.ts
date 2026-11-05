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

/** One customer-facing switch; unrelated saves preserve existing access choices. */
export function onlineBookingAccessForSave(settings: SalonOnlineBookingSettings, enabled: boolean) {
  if (enabled === getSalonOnlineBookingStatus(settings).onlineBookingOpen) {
    return {bookingEnabled: settings.booking_enabled, onlineBookingVisible: settings.online_booking_visible, guestBookingEnabled: settings.guest_booking_enabled};
  }
  return enabled
    ? {bookingEnabled: true, onlineBookingVisible: true, guestBookingEnabled: true}
    : {bookingEnabled: settings.booking_enabled, onlineBookingVisible: false, guestBookingEnabled: settings.guest_booking_enabled};
}

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
