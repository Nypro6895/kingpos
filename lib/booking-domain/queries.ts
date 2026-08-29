import "server-only";

import { BOOKING_SELECT } from "@/lib/bookings";
import {
  bookingFailureFromUnknown,
  bookingOk,
  type BookingDomainResult,
} from "@/lib/booking-domain/errors";
import type {
  BookingDomainDetail,
  StaffBookingProjection,
} from "@/lib/booking-domain/types";
import {
  getCurrentBusinessContext,
  getCurrentStaffBusinessContext,
  isSalonManageContext,
  isSalonStaffContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { BookingWithRelations } from "@/types/booking";

export async function listOwnerBookings(): Promise<
  BookingDomainResult<BookingWithRelations[]>
> {
  try {
    const context = await getCurrentBusinessContext();

    if (!context.user) {
      return { error: { code: "unauthenticated", message: "Sign in required." }, ok: false };
    }

    if (!isSalonManageContext(context) || !context.currentSalon) {
      return {
        error: {
          code: "invalid_context",
          message: "Open bookings from a Business workspace.",
        },
        ok: false,
      };
    }

    await requirePermission("booking.view", context);

    const supabase = await createAuthenticatedSupabaseServerClient();

    if (!supabase) {
      return {
        error: {
          code: "database_error",
          message: "Supabase environment variables are missing.",
        },
        ok: false,
      };
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(
        `${BOOKING_SELECT}, customer:customers(id, name, phone, email), staff:staff(id, display_name)`,
      )
      .eq("salon_id", context.currentSalon.id)
      .order("start_at", { ascending: true })
      .returns<BookingWithRelations[]>();

    if (error) {
      throw error;
    }

    return bookingOk(data ?? []);
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function listStaffScopedBookings(): Promise<
  BookingDomainResult<StaffBookingProjection[]>
> {
  try {
    const context = await getCurrentStaffBusinessContext();

    if (!context.user) {
      return { error: { code: "unauthenticated", message: "Sign in required." }, ok: false };
    }

    if (!isSalonStaffContext(context) || !context.currentStaffSalon) {
      return {
        error: {
          code: "invalid_context",
          message: "Open staff bookings from a Staff workspace.",
        },
        ok: false,
      };
    }

    const supabase = await createAuthenticatedSupabaseServerClient();

    if (!supabase) {
      return {
        error: {
          code: "database_error",
          message: "Supabase environment variables are missing.",
        },
        ok: false,
      };
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, salon_id, customer_id, staff_id, start_at, end_at, status, source, confirmation_status, booking_lines(id, assigned_staff_id, service_name_snapshot, duration_minutes, scheduled_start_at, scheduled_end_at)",
      )
      .eq("salon_id", context.currentStaffSalon.id)
      .order("start_at", { ascending: true })
      .returns<StaffBookingProjection[]>();

    if (error) {
      throw error;
    }

    return bookingOk(data ?? []);
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function getBookingDetail(
  bookingId: string,
): Promise<BookingDomainResult<BookingDomainDetail | null>> {
  try {
    const supabase = await createAuthenticatedSupabaseServerClient();

    if (!supabase) {
      return {
        error: {
          code: "database_error",
          message: "Supabase environment variables are missing.",
        },
        ok: false,
      };
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(
        `${BOOKING_SELECT}, booking_lines(*), booking_status_events(*)`,
      )
      .eq("id", bookingId)
      .maybeSingle<BookingDomainDetail>();

    if (error) {
      throw error;
    }

    return bookingOk(data ?? null);
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}
