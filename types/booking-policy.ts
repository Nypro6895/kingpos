export const BOOKING_POLICY_PLUGIN = "booking-policy";
export const BOOKING_POLICY_MONTHLY_CENTS = 99;
export const BOOKING_POLICY_TEMPLATE = `Please arrive 5–10 minutes before your appointment.
If you need to cancel or reschedule, please contact the salon at least 24 hours in advance.
If you are running late, please call the salon. We may need to adjust your service or reschedule depending on availability.
Please select all services you need when booking. Additional services depend on available time.
Please tell us about any allergies or special requirements before your visit.
Prices shown when booking are estimates. Please confirm the final service and price with the salon before treatment.`;
export type BookingPolicyState = { active: boolean; subscribed: boolean; content: string; published: boolean };
