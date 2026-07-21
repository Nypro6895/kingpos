import type {
  ServiceBookingReadiness,
  ServiceConfigInput,
  ServiceConfigValidation,
} from "../types/service";

type ReadinessService = {
  is_active: boolean;
  online_booking_enabled: boolean;
};

type ReadinessAssignment = {
  is_active: boolean;
  online_bookable: boolean;
  service_id: string;
  staff_id: string;
};

type ReadinessStaff = {
  id: string;
  is_active: boolean;
  online_booking_enabled: boolean;
  owner_public_enabled: boolean;
  public_profile_visible: boolean;
  staff_public_consent_status: string;
};

export function getServiceBookingReadiness(input: {
  assignments: ReadinessAssignment[];
  service: ReadinessService & { id: string };
  staff: ReadinessStaff[];
}): ServiceBookingReadiness {
  const staffById = new Map(input.staff.map((member) => [member.id, member]));
  const bookingAssignments = input.assignments.filter(
    (assignment) =>
      assignment.service_id === input.service.id &&
      assignment.is_active &&
      assignment.online_bookable,
  );
  const eligibleBookingStaffCount = bookingAssignments.filter((assignment) => {
    const member = staffById.get(assignment.staff_id);

    return (
      member?.is_active === true &&
      member.online_booking_enabled === true &&
      member.owner_public_enabled === true &&
      member.public_profile_visible === true &&
      member.staff_public_consent_status === "granted"
    );
  }).length;
  const reasons: ServiceBookingReadiness["reasons"] = [];

  if (!input.service.is_active) {
    reasons.push({
      code: "service_inactive",
      label: "Service is inactive",
    });
  } else if (!input.service.online_booking_enabled) {
    reasons.push({
      code: "online_booking_disabled",
      label: "Online booking is disabled",
    });
  } else if (bookingAssignments.length === 0) {
    reasons.push({
      code: "no_booking_staff",
      label: "No booking staff selected",
    });
  } else if (eligibleBookingStaffCount === 0) {
    reasons.push({
      code: "no_ready_booking_staff",
      label: "Selected booking staff are not online-ready",
    });
  }

  const ready =
    input.service.is_active &&
    input.service.online_booking_enabled &&
    eligibleBookingStaffCount > 0;

  return {
    bookingStaffCount: bookingAssignments.length,
    eligibleBookingStaffCount,
    needsSetup: input.service.online_booking_enabled && !ready,
    ready,
    reasons,
  };
}

export function validateServiceConfig(
  input: ServiceConfigInput,
): ServiceConfigValidation {
  const fieldErrors: ServiceConfigValidation["fieldErrors"] = {};
  const name = input.name.trim();
  const category = input.category?.trim() ?? "";
  const description = input.description?.trim() ?? "";

  if (!name) {
    fieldErrors.name = "Service name is required.";
  } else if (name.length > 120) {
    fieldErrors.name = "Service name must be 120 characters or fewer.";
  }

  if (category.length > 80) {
    fieldErrors.category = "Category must be 80 characters or fewer.";
  }

  if (description.length > 2_000) {
    fieldErrors.description = "Description must be 2,000 characters or fewer.";
  }

  if (!Number.isFinite(input.basePrice) || input.basePrice < 0) {
    fieldErrors.basePrice = "Price must be zero or greater.";
  }

  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1 ||
    input.durationMinutes > 1_440
  ) {
    fieldErrors.durationMinutes = "Duration must be between 1 and 1,440 minutes.";
  }

  if (!input.isActive && input.onlineBookingEnabled) {
    fieldErrors.onlineBookingEnabled =
      "Activate this service before enabling online booking.";
  }

  if (new Set(input.bookingStaffIds).size !== input.bookingStaffIds.length) {
    fieldErrors.bookingStaffIds = "Booking staff selections must be unique.";
  }

  if (
    new Set(input.addOnServiceIds).size !== input.addOnServiceIds.length ||
    (input.serviceId && input.addOnServiceIds.includes(input.serviceId))
  ) {
    fieldErrors.addOnServiceIds =
      "Booking add-ons must be unique and cannot link to the same service.";
  }

  return {
    fieldErrors,
    valid: Object.keys(fieldErrors).length === 0,
  };
}

export function wouldCreateServiceAddOnCycle(input: {
  addOnIdsByServiceId: Map<string, string[]>;
  addOnServiceId: string;
  parentServiceId: string;
}) {
  if (input.addOnServiceId === input.parentServiceId) {
    return true;
  }

  const visited = new Set<string>();
  const pending = [input.addOnServiceId];

  while (pending.length > 0) {
    const current = pending.pop();

    if (!current || visited.has(current)) {
      continue;
    }

    if (current === input.parentServiceId) {
      return true;
    }

    visited.add(current);
    pending.push(...(input.addOnIdsByServiceId.get(current) ?? []));
  }

  return false;
}
