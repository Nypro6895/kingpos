import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BookingDomainError,
  bookingFailureFromUnknown,
  bookingOk,
  type BookingDomainResult,
} from "@/lib/booking-domain/errors";
import type {
  BookingDomainLineInput,
  CanonicalBookingRpcLine,
} from "@/lib/booking-domain/types";
import type { Service } from "@/types/service";

const SERVICE_SELECT =
  "id, salon_id, name, category, base_price, duration_minutes, description, is_active, online_booking_enabled, created_at, updated_at";

function uniqueValues(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function deriveBookingLineSnapshots(input: {
  lines: BookingDomainLineInput[];
  salonId: string;
  supabase: SupabaseClient;
}): Promise<BookingDomainResult<CanonicalBookingRpcLine[]>> {
  try {
    if (input.lines.length === 0) {
      throw new BookingDomainError(
        "invalid_input",
        "At least one booking line is required.",
        { field: "lines" },
      );
    }

    const serviceIds = uniqueValues(input.lines.map((line) => line.serviceId));
    const servicesById = new Map<string, Service>();

    if (serviceIds.length > 0) {
      const { data, error } = await input.supabase
        .from("services")
        .select(SERVICE_SELECT)
        .eq("salon_id", input.salonId)
        .eq("is_active", true)
        .in("id", serviceIds)
        .returns<Service[]>();

      if (error) {
        throw new BookingDomainError("database_error", error.message);
      }

      for (const service of data ?? []) {
        servicesById.set(service.id, service);
      }
    }

    const rpcLines = input.lines.map((line, index): CanonicalBookingRpcLine => {
      const service = line.serviceId ? servicesById.get(line.serviceId) : null;

      if (line.serviceId && !service) {
        throw new BookingDomainError(
          "relationship_invalid",
          "Booking service must be active for this salon.",
          { field: "serviceId" },
        );
      }

      if (!service && !line.serviceNameSnapshot?.trim()) {
        throw new BookingDomainError(
          "invalid_input",
          "Custom booking lines require a service name snapshot.",
          { field: "serviceNameSnapshot" },
        );
      }

      const durationMinutes = service?.duration_minutes ?? line.durationMinutes;

      if (!durationMinutes || durationMinutes <= 0) {
        throw new BookingDomainError(
          "invalid_input",
          "Booking line duration must be positive.",
          { field: "durationMinutes" },
        );
      }

      return {
        assigned_staff_id: line.assignedStaffId ?? null,
        cleanup_buffer_minutes: Math.max(0, line.cleanupBufferMinutes ?? 0),
        display_order: line.displayOrder ?? index,
        duration_minutes: durationMinutes,
        line_type: line.lineType ?? "service",
        parent_booking_line_id: line.parentBookingLineId ?? null,
        quantity: line.quantity ?? 1,
        scheduled_end_at: line.scheduledEndAt ?? null,
        scheduled_start_at: line.scheduledStartAt ?? null,
        service_category_snapshot:
          service?.category ?? line.serviceCategorySnapshot ?? null,
        service_description_snapshot:
          service?.description ?? line.serviceDescriptionSnapshot ?? null,
        service_id: line.serviceId ?? null,
        service_name_snapshot:
          service?.name ?? line.serviceNameSnapshot?.trim() ?? "Custom service",
        unit_price: service?.base_price ?? line.unitPrice ?? 0,
      };
    });

    return bookingOk(rpcLines);
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}
