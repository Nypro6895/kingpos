import type { Customer } from "@/types/customer";
import type { Staff } from "@/types/staff";

export const BOOKING_STATUSES = [
  "scheduled",
  "checked_in",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type Booking = {
  id: string;
  organization_id: string;
  salon_id: string;
  customer_id: string;
  staff_id: string | null;
  start_at: string;
  end_at: string;
  notes: string | null;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
};

export type BookingWithRelations = Booking & {
  customer: Pick<Customer, "id" | "name" | "phone" | "email"> | null;
  staff: Pick<Staff, "id" | "display_name"> | null;
};
