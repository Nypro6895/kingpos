import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BookingDomainError,
  bookingFailureFromUnknown,
  bookingOk,
  type BookingDomainResult,
} from "@/lib/booking-domain/errors";

type StaffServiceAssignmentRow = {
  id: string;
  online_bookable: boolean;
};

export type StaffBookingConflict = {
  booking_id: string;
  booking_line_id: string;
  scheduled_end_at: string;
  scheduled_start_at: string;
  status: string;
};

export async function validateStaffServiceEligibility(input: {
  onlineOnly?: boolean;
  organizationId: string;
  salonId: string;
  serviceId: string;
  staffId: string;
  supabase: SupabaseClient;
}): Promise<BookingDomainResult<{ assignmentId: string }>> {
  try {
    const { data, error } = await input.supabase
      .from("staff_service_assignments")
      .select("id, online_bookable")
      .eq("organization_id", input.organizationId)
      .eq("salon_id", input.salonId)
      .eq("staff_id", input.staffId)
      .eq("service_id", input.serviceId)
      .eq("is_active", true)
      .maybeSingle<StaffServiceAssignmentRow>();

    if (error) {
      throw new BookingDomainError("database_error", error.message);
    }

    if (!data) {
      throw new BookingDomainError(
        "relationship_invalid",
        "Staff is not assigned to perform this service.",
        { field: "staffId" },
      );
    }

    if (input.onlineOnly && !data.online_bookable) {
      throw new BookingDomainError(
        "forbidden",
        "Staff is not online-bookable for this service.",
        { field: "staffId" },
      );
    }

    return bookingOk({ assignmentId: data.id });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function listStaffBookingConflicts(input: {
  bookingIdToIgnore?: string | null;
  bookingLineIdToIgnore?: string | null;
  endAt: string;
  salonId: string;
  staffId: string;
  startAt: string;
  supabase: SupabaseClient;
}): Promise<BookingDomainResult<StaffBookingConflict[]>> {
  try {
    const { data, error } = await input.supabase
      .from("booking_lines")
      .select(
        "id, booking_id, scheduled_start_at, scheduled_end_at, booking:bookings(status)",
      )
      .eq("salon_id", input.salonId)
      .eq("assigned_staff_id", input.staffId)
      .lt("scheduled_start_at", input.endAt)
      .gt("scheduled_end_at", input.startAt);

    if (error) {
      throw new BookingDomainError("database_error", error.message);
    }

    const conflicts = (data ?? [])
      .filter((row) => row.id !== input.bookingLineIdToIgnore)
      .filter((row) => row.booking_id !== input.bookingIdToIgnore)
      .map((row) => {
        const booking = Array.isArray(row.booking) ? row.booking[0] : row.booking;
        return {
          booking_id: row.booking_id as string,
          booking_line_id: row.id as string,
          scheduled_end_at: row.scheduled_end_at as string,
          scheduled_start_at: row.scheduled_start_at as string,
          status: (booking?.status as string | undefined) ?? "confirmed",
        };
      })
      .filter((row) => row.status !== "cancelled" && row.status !== "no_show");

    return bookingOk(conflicts);
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function validateStaffSlotAvailable(input: {
  allowOverride?: boolean;
  endAt: string;
  salonId: string;
  staffId: string;
  startAt: string;
  supabase: SupabaseClient;
}): Promise<BookingDomainResult<{ conflictCount: number }>> {
  const conflicts = await listStaffBookingConflicts(input);

  if (!conflicts.ok) {
    return conflicts;
  }

  if (conflicts.data.length > 0 && !input.allowOverride) {
    return {
      error: {
        code: "availability_conflict",
        message: "Assigned staff already has a booking in this interval.",
      },
      ok: false,
    };
  }

  return bookingOk({ conflictCount: conflicts.data.length });
}
