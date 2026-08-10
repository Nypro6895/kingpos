import "server-only";

import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { POS_PAYMENT_METHOD_LABELS } from "@/lib/pos-payments";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { BookingStatus } from "@/types/booking";
import { normalizeBookingStatus } from "@/types/booking";
import type { PosPaymentMethod } from "@/types/pos-payment";
import type {
  PosTicketDiscountType,
  PosTicketTipType,
} from "@/types/pos-ticket";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const POS_DISCOUNT_TYPES = new Set<PosTicketDiscountType>([
  "fixed_amount",
  "percentage",
]);
const POS_TIP_TYPES = new Set<PosTicketTipType>([
  "fixed_amount",
  "percentage",
]);
const POS_PAYMENT_METHODS = new Set<PosPaymentMethod>([
  "cash",
  "credit_card",
  "debit_card",
  "gift_card",
  "other",
]);

type CustomerActivityErrorCode =
  | "database_error"
  | "not_found"
  | "sign_in_required";

export type CustomerActivityResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      code: CustomerActivityErrorCode;
      message: string;
      ok: false;
    };

export type CustomerActivitySalon = {
  coverUrl: string | null;
  id: string;
  imageUrl: string | null;
  name: string;
};

export type CustomerActivityService = {
  id: string | null;
  lineTotal?: number;
  name: string;
  quantity?: number;
  staffName: string | null;
  unitPrice?: number;
};

export type CustomerActivityStatus =
  | "cancelled"
  | "completed"
  | "no_show"
  | "upcoming";

export type CustomerPurchaseActivity = {
  currency: string;
  href: string;
  id: string;
  occurredAt: string;
  salon: CustomerActivitySalon;
  services: CustomerActivityService[];
  status: "completed";
  ticketId: string;
  ticketNumber: string;
  title: string;
  total: number;
  type: "purchase";
};

export type CustomerBookingActivity = {
  bookingId: string;
  currency: string;
  endAt: string;
  href: string;
  id: string;
  occurredAt: string;
  salon: CustomerActivitySalon;
  services: CustomerActivityService[];
  staffName: string | null;
  startAt: string;
  status: CustomerActivityStatus;
  timezone: string;
  title: string;
  total: number;
  type: "booking";
};

export type CustomerActivity =
  | CustomerBookingActivity
  | CustomerPurchaseActivity;

export type CustomerActivityData = {
  history: CustomerActivity[];
  salonCount: number;
  totalCount: number;
  upcoming: CustomerBookingActivity[];
};

export type CustomerActivityReceiptPayment = {
  amount: number;
  createdAt: string;
  id: string | null;
  label: string;
  method: PosPaymentMethod;
};

export type CustomerActivityReceiptService = CustomerActivityService &
  Required<
    Pick<CustomerActivityService, "lineTotal" | "quantity" | "unitPrice">
  >;

export type CustomerActivityReceipt = {
  closedAt: string | null;
  currency: string;
  customerName: string;
  id: string;
  openedAt: string;
  paymentStatus: "paid" | "partial" | "unpaid";
  payments: CustomerActivityReceiptPayment[];
  salon: CustomerActivitySalon & {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    postalCode: string | null;
    state: string | null;
  };
  services: CustomerActivityReceiptService[];
  status: "completed";
  ticketId: string;
  ticketNumber: string;
  totals: ReturnType<typeof calculateTicketTotals>;
};

type RawRecord = Record<string, unknown>;

type RawPayment = {
  amount: number;
  createdAt: string;
  id: string | null;
  method: PosPaymentMethod;
};

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  const numeric = Number(value ?? 0);

  return Number.isFinite(numeric) ? numeric : 0;
}

function readUuid(value: unknown) {
  const text = readString(value);

  return text && UUID_PATTERN.test(text) ? text : null;
}

function cleanUuid(value: string | null | undefined) {
  const text = value?.trim() ?? "";

  return UUID_PATTERN.test(text) ? text : null;
}

function readCurrency(value: unknown) {
  return readString(value) ?? "USD";
}

function readDiscountType(value: unknown): PosTicketDiscountType {
  const text = readString(value);

  return text && POS_DISCOUNT_TYPES.has(text as PosTicketDiscountType)
    ? (text as PosTicketDiscountType)
    : "fixed_amount";
}

function readTipType(value: unknown): PosTicketTipType {
  const text = readString(value);

  return text && POS_TIP_TYPES.has(text as PosTicketTipType)
    ? (text as PosTicketTipType)
    : "fixed_amount";
}

function readPaymentMethod(value: unknown): PosPaymentMethod {
  const text = readString(value);

  return text && POS_PAYMENT_METHODS.has(text as PosPaymentMethod)
    ? (text as PosPaymentMethod)
    : "other";
}

function parseSalon(value: unknown): CustomerActivitySalon {
  const salon = asRecord(value);
  const name = readString(salon.name) ?? "Reylumi salon";
  const logoUrl = getSalonProfileMediaUrl(readString(salon.logoPath));
  const coverUrl = getSalonProfileMediaUrl(readString(salon.coverPath));

  return {
    coverUrl,
    id: readUuid(salon.id) ?? "",
    imageUrl: logoUrl,
    name,
  };
}

function parseServices(value: unknown): CustomerActivityService[] {
  return asArray(value).map((entry) => {
    const service = asRecord(entry);

    return {
      id: readUuid(service.id),
      lineTotal: readNumber(service.lineTotal),
      name: readString(service.name) ?? "Service",
      quantity: readNumber(service.quantity),
      staffName: readString(service.staffName),
      unitPrice: readNumber(service.unitPrice),
    };
  });
}

function parsePayments(value: unknown): RawPayment[] {
  return asArray(value).map((entry) => {
    const payment = asRecord(entry);
    const method = readPaymentMethod(payment.method);

    return {
      amount: readNumber(payment.amount),
      createdAt: readString(payment.createdAt) ?? "",
      id: readUuid(payment.id),
      method,
    };
  });
}

function uniqueServiceNames(services: CustomerActivityService[]) {
  return [
    ...new Set(
      services
        .map((service) => service.name.trim())
        .filter((name) => name.length > 0),
    ),
  ];
}

function activityTitle(
  services: CustomerActivityService[],
  fallback: string,
) {
  const names = uniqueServiceNames(services);

  if (names.length === 0) {
    return fallback;
  }

  return names.length <= 2
    ? names.join(" / ")
    : `${names.slice(0, 2).join(" / ")} +${names.length - 2}`;
}

function uniqueStaffName(
  services: CustomerActivityService[],
  fallback: string | null,
) {
  const names = [
    ...new Set(
      [
        fallback,
        ...services.map((service) => service.staffName),
      ].filter((name): name is string => Boolean(name)),
    ),
  ];

  if (names.length === 0) {
    return null;
  }

  return names.length === 1 ? names[0] : `${names.length} professionals`;
}

function totalFromTicket(raw: RawRecord, services: CustomerActivityService[]) {
  const payments = parsePayments(raw.payments);

  return calculateTicketTotals({
    discountType: readDiscountType(raw.discountType),
    discountValue: readNumber(raw.discountValue),
    items: services.map((service) => ({
      line_total: service.lineTotal ?? 0,
    })),
    payments,
    taxRate: readNumber(raw.taxRate),
    tipType: readTipType(raw.tipType),
    tipValue: readNumber(raw.tipValue),
  });
}

function mapPurchaseActivity(entry: unknown): CustomerPurchaseActivity | null {
  const raw = asRecord(entry);
  const ticketId = readUuid(raw.ticketId);
  const closedAt = readString(raw.closedAt) ?? readString(raw.openedAt);

  if (!ticketId || !closedAt) {
    return null;
  }

  const services = parseServices(raw.services);
  const totals = totalFromTicket(raw, services);

  return {
    currency: readCurrency(raw.currency),
    href: `/activity/receipts/${ticketId}`,
    id: `purchase-${ticketId}`,
    occurredAt: closedAt,
    salon: parseSalon(raw.salon),
    services,
    status: "completed",
    ticketId,
    ticketNumber: readString(raw.ticketNumber) ?? "Receipt",
    title: activityTitle(services, "Purchase"),
    total: totals.total,
    type: "purchase",
  };
}

function mapBookingStatus(
  rawStatus: string | null,
  startAt: string,
  serverNow: string,
): CustomerActivityStatus {
  const normalized = normalizeBookingStatus(
    (rawStatus ?? "confirmed") as BookingStatus,
  );

  if (normalized === "cancelled") {
    return "cancelled";
  }

  if (normalized === "no_show") {
    return "no_show";
  }

  if (normalized === "completed") {
    return "completed";
  }

  const startMs = new Date(startAt).getTime();
  const nowMs = new Date(serverNow).getTime();

  return Number.isFinite(startMs) && Number.isFinite(nowMs) && startMs >= nowMs
    ? "upcoming"
    : "completed";
}

function mapBookingActivity(
  entry: unknown,
  serverNow: string,
): CustomerBookingActivity | null {
  const raw = asRecord(entry);
  const bookingId = readUuid(raw.bookingId);
  const startAt = readString(raw.startAt);
  const endAt = readString(raw.endAt);

  if (!bookingId || !startAt || !endAt) {
    return null;
  }

  const services = parseServices(raw.services);
  const staffName = uniqueStaffName(services, readString(raw.staffName));

  return {
    bookingId,
    currency: readCurrency(raw.currency),
    endAt,
    href: `/my-bookings/${bookingId}`,
    id: `booking-${bookingId}`,
    occurredAt: startAt,
    salon: parseSalon(raw.salon),
    services,
    staffName,
    startAt,
    status: mapBookingStatus(readString(raw.status), startAt, serverNow),
    timezone: readString(raw.timezone) ?? "America/Chicago",
    title: activityTitle(services, "Appointment"),
    total: services.reduce(
      (total, service) => total + (service.lineTotal ?? 0),
      0,
    ),
    type: "booking",
  };
}

function sortDesc(left: CustomerActivity, right: CustomerActivity) {
  return (
    new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
  );
}

function sortUpcoming(
  left: CustomerBookingActivity,
  right: CustomerBookingActivity,
) {
  return (
    new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
  );
}

function activityFailure(
  code: CustomerActivityErrorCode,
): CustomerActivityResult<never> {
  return {
    code,
    message:
      code === "sign_in_required"
        ? "Sign in to view your activity."
        : "Activity could not be loaded.",
    ok: false,
  };
}

export async function getCustomerActivity(input?: {
  limit?: number;
}): Promise<CustomerActivityResult<CustomerActivityData>> {
  const [user, supabase] = await Promise.all([
    getCurrentKingUser(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!user || !supabase) {
    return activityFailure("sign_in_required");
  }

  const limit = Math.min(Math.max(input?.limit ?? 40, 1), 100);
  const { data, error } = await supabase.rpc("get_customer_activity", {
    p_limit: limit,
  });

  if (error) {
    console.error("Supabase load customer activity failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      userId: user.id,
    });
    return activityFailure("database_error");
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    return activityFailure(
      readString(payload.code) === "sign_in_required"
        ? "sign_in_required"
        : "database_error",
    );
  }

  const serverNow = readString(payload.serverNow) ?? new Date().toISOString();
  const purchases = asArray(payload.purchases)
    .map(mapPurchaseActivity)
    .filter((activity): activity is CustomerPurchaseActivity =>
      Boolean(activity),
    );
  const bookings = asArray(payload.bookings)
    .map((booking) => mapBookingActivity(booking, serverNow))
    .filter((activity): activity is CustomerBookingActivity =>
      Boolean(activity),
    );
  const upcoming = bookings
    .filter((booking) => booking.status === "upcoming")
    .sort(sortUpcoming);
  const history = [
    ...purchases,
    ...bookings.filter((booking) => booking.status !== "upcoming"),
  ].sort(sortDesc);
  const salonCount = new Set(
    [...upcoming, ...history]
      .map((activity) => activity.salon.id)
      .filter(Boolean),
  ).size;

  return {
    data: {
      history,
      salonCount,
      totalCount: upcoming.length + history.length,
      upcoming,
    },
    ok: true,
  };
}

function paymentStatus(totals: ReturnType<typeof calculateTicketTotals>) {
  const totalCents = Math.round(totals.total * 100);
  const paidCents = Math.round(totals.paid * 100);

  if (paidCents <= 0) {
    return "unpaid" as const;
  }

  return totalCents > 0 && paidCents >= totalCents
    ? ("paid" as const)
    : ("partial" as const);
}

function mapReceipt(entry: unknown): CustomerActivityReceipt | null {
  const raw = asRecord(entry);
  const salonRaw = asRecord(raw.salon);
  const customerRaw = asRecord(raw.customer);
  const ticketId = readUuid(raw.ticketId);
  const openedAt = readString(raw.openedAt);
  const services = parseServices(raw.services).map((service) => ({
    ...service,
    lineTotal: service.lineTotal ?? 0,
    quantity: service.quantity ?? 1,
    unitPrice: service.unitPrice ?? 0,
  }));
  const payments = parsePayments(raw.payments);
  const totals = totalFromTicket(raw, services);

  if (!ticketId || !openedAt) {
    return null;
  }

  return {
    closedAt: readString(raw.closedAt),
    currency: readCurrency(raw.currency),
    customerName: readString(customerRaw.name) ?? "Customer",
    id: ticketId,
    openedAt,
    paymentStatus: paymentStatus(totals),
    payments: payments.map((payment) => ({
      amount: payment.amount,
      createdAt: payment.createdAt,
      id: payment.id,
      label: POS_PAYMENT_METHOD_LABELS[payment.method],
      method: payment.method,
    })),
    salon: {
      ...parseSalon(raw.salon),
      addressLine1: readString(salonRaw.addressLine1),
      addressLine2: readString(salonRaw.addressLine2),
      city: readString(salonRaw.city),
      country: readString(salonRaw.country),
      phone: readString(salonRaw.phone),
      postalCode: readString(salonRaw.postalCode),
      state: readString(salonRaw.state),
    },
    services,
    status: "completed",
    ticketId,
    ticketNumber: readString(raw.ticketNumber) ?? "Receipt",
    totals,
  };
}

export async function getCustomerActivityReceipt(
  ticketId: string,
): Promise<CustomerActivityResult<CustomerActivityReceipt | null>> {
  const cleanTicketId = cleanUuid(ticketId);

  if (!cleanTicketId) {
    return {
      code: "not_found",
      message: "Receipt was not found.",
      ok: false,
    };
  }

  const [user, supabase] = await Promise.all([
    getCurrentKingUser(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!user || !supabase) {
    return {
      code: "sign_in_required",
      message: "Sign in to view this receipt.",
      ok: false,
    };
  }

  const { data, error } = await supabase.rpc("get_customer_activity_receipt", {
    p_ticket_id: cleanTicketId,
  });

  if (error) {
    console.error("Supabase load customer activity receipt failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      ticketId: cleanTicketId,
      userId: user.id,
    });
    return {
      code: "database_error",
      message: "Receipt could not be loaded.",
      ok: false,
    };
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    const code = readString(payload.code);

    return {
      code: code === "sign_in_required" ? "sign_in_required" : "not_found",
      message:
        code === "sign_in_required"
          ? "Sign in to view this receipt."
          : "Receipt was not found.",
      ok: false,
    };
  }

  return {
    data: mapReceipt(payload.ticket),
    ok: true,
  };
}
