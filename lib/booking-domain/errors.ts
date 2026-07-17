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
    error: { code, field, message },
    ok: false,
  };
}

export function bookingFailureFromUnknown(error: unknown): BookingDomainResult<never> {
  if (error instanceof BookingDomainError) {
    return bookingFailure(error.code, error.message, error.field);
  }

  if (error instanceof Error) {
    return bookingFailure("database_error", error.message);
  }

  return bookingFailure("database_error", "Booking domain operation failed.");
}
