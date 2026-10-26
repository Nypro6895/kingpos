import "server-only";

export const BOOKING_DOMAIN_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "invalid_context",
  "invalid_input",
  "not_found",
  "conflict",
  "availability_conflict",
  "relationship_invalid",
  "idempotency_conflict",
  "database_error",
] as const;

export type BookingDomainErrorCode =
  (typeof BOOKING_DOMAIN_ERROR_CODES)[number];

export type BookingDomainFailure = {
  code: BookingDomainErrorCode;
  field?: string;
  message: string;
};

export type BookingDomainResult<T> =
  | { data: T; ok: true }
  | { error: BookingDomainFailure; ok: false };

export class BookingDomainError extends Error {
  code: BookingDomainErrorCode;
  field?: string;

  constructor(
    code: BookingDomainErrorCode,
    message: string,
    options?: { field?: string },
  ) {
    super(message);
    this.name = "BookingDomainError";
    this.code = code;
    this.field = options?.field;
  }
}

export function bookingOk<T>(data: T): BookingDomainResult<T> {
  return { data, ok: true };
}

export function bookingFailure(
  code: BookingDomainErrorCode,
  message: string,
  field?: string,
): BookingDomainResult<never> {
  return {
    error: { code, ...(field ? { field } : {}), message },
    ok: false,
  };
}

export function bookingFailureFromUnknown(error: unknown): BookingDomainResult<never> {
  if (error instanceof BookingDomainError) {
    return bookingFailure(error.code, error.message, error.field);
  }

  // PostgREST errors are plain objects, not Error instances. For these raw
  // objects, expose only known business validations rather than SQL details.
  const db = error && typeof error === "object"
    ? error as { code?: string; message?: string } : null;
  if (db?.message === "Professional is unavailable: check service eligibility, working hours, breaks, time off, and overlapping appointments.") {
    return bookingFailure("availability_conflict", db.message, "staffId");
  }
  if (db?.code === "23P01" || db?.message === "This professional was just booked at that time. Choose another available time.") {
    return bookingFailure("availability_conflict", "This time was just booked. Choose another time or professional.", "startLocal");
  }
  if (db?.code === "42501") {
    return bookingFailure("forbidden", "You do not have permission to change this booking.");
  }
  if (db?.message === "The appointment must include this professional's service duration and the salon cleanup buffer.") {
    return bookingFailure("invalid_input", db.message, "startLocal");
  }

  if (error instanceof Error) {
    return bookingFailure("database_error", error.message);
  }

  return bookingFailure("database_error", "Booking domain operation failed.");
}
