import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import {
  BOOKING_LINE_SELECT,
  BOOKING_SELECT,
  BOOKING_STATUS_EVENT_SELECT,
} from "@/lib/bookings";
import { requirePermission } from "@/lib/permissions";
import {
  POS_TICKET_WITH_RELATIONS_SELECT,
} from "@/lib/pos-tickets";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  Booking,
  BookingLine,
  BookingStatus,
  BookingStatusEvent,
} from "@/types/booking";
import type { Customer } from "@/types/customer";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { Staff } from "@/types/staff";

export const CUSTOMER_SELECT =
  "id, location_id, customer_user_id, name, phone, email, notes, staff_notes, internal_notes, source, status, created_by_user_id, updated_by_user_id, created_at, updated_at";

export const CUSTOMER_PERMISSIONS = {
  view: "customers.view",
  manage: "customers.manage",
} as const;

export const CUSTOMER_PAGE_SIZE = 25;

const CUSTOMER_BOOKING_SELECT = `${BOOKING_SELECT}, staff:staff(id, display_name)`;

type CustomerBookingRow = Booking & {
  staff: Pick<Staff, "display_name" | "id"> | null;
};

export type CustomerCrmMetric = {
  active_pos_ticket_count: number;
  appointment_count: number;
  cancelled_count: number;
  completed_count: number;
  customer_id: string;
  finalized_pos_ticket_count: number;
  finalized_spend: number;
  last_visit_at: string | null;
  no_show_count: number;
  upcoming_booking_id: string | null;
  upcoming_start_at: string | null;
};

export type CustomerListItem = Customer & {
  duplicateCandidates: Customer[];
  duplicate_signal: boolean;
  groupedCustomerIds?: string[];
  isWalkingGroup?: boolean;
  metrics: CustomerCrmMetric;
};

export type CustomerListPagination = {
  count: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

export type CustomerBookingSummary = Booking & {
  lines: BookingLine[];
  normalizedStatus: Exclude<BookingStatus, "scheduled">;
  serviceNames: string[];
  staff: Pick<Staff, "display_name" | "id"> | null;
  subtotal: number;
};

export type CustomerTicketSummary = PosTicketWithRelations & {
  totals: ReturnType<typeof calculateTicketTotals>;
};

export type CustomerTimelineItem = {
  href: string | null;
  id: string;
  label: string;
  timestamp: string;
  type: "booking" | "ticket";
};

export type CustomerDetailData = {
  activeTickets: CustomerTicketSummary[];
  bookingHistory: CustomerBookingSummary[];
  customer: Customer;
  duplicateCandidates: Customer[];
  finalizedSpend: number;
  groupedCustomerIds?: string[];
  isWalkingGroup?: boolean;
  timeline: CustomerTimelineItem[];
  tickets: CustomerTicketSummary[];
  upcomingBookings: CustomerBookingSummary[];
};

function requireCurrentSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open customers from a Business workspace.");
  }

  if (!context.currentSalon) {
    throw new Error("Choose a current Salon before managing customers.");
  }

  return context.currentSalon;
}

function defaultMetric(customerId: string): CustomerCrmMetric {
  return {
    active_pos_ticket_count: 0,
    appointment_count: 0,
    cancelled_count: 0,
    completed_count: 0,
    customer_id: customerId,
    finalized_pos_ticket_count: 0,
    finalized_spend: 0,
    last_visit_at: null,
    no_show_count: 0,
    upcoming_booking_id: null,
    upcoming_start_at: null,
  };
}

function normalizeCustomerName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWalkingCustomer(customer: Customer) {
  const walkInNames = new Set([
    "anonymous",
    "guest",
    "guest customer",
    "walk in",
    "walk in customer",
    "walking",
    "walking customer",
    "walkin",
    "walkin customer",
  ]);

  return (
    !customer.phone &&
    !customer.email &&
    !customer.customer_user_id &&
    walkInNames.has(normalizeCustomerName(customer.name))
  );
}

function aggregateCustomerMetrics(
  customerId: string,
  metrics: CustomerCrmMetric[],
): CustomerCrmMetric {
  const upcoming = metrics
    .filter((metric) => metric.upcoming_start_at)
    .sort(
      (left, right) =>
        new Date(left.upcoming_start_at ?? 0).getTime() -
        new Date(right.upcoming_start_at ?? 0).getTime(),
    )[0];
  const lastVisit = metrics
    .map((metric) => metric.last_visit_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

  return metrics.reduce(
    (sum, metric) => ({
      active_pos_ticket_count:
        sum.active_pos_ticket_count + metric.active_pos_ticket_count,
      appointment_count: sum.appointment_count + metric.appointment_count,
      cancelled_count: sum.cancelled_count + metric.cancelled_count,
      completed_count: sum.completed_count + metric.completed_count,
      customer_id: sum.customer_id,
      finalized_pos_ticket_count:
        sum.finalized_pos_ticket_count + metric.finalized_pos_ticket_count,
      finalized_spend: sum.finalized_spend + metric.finalized_spend,
      last_visit_at: lastVisit,
      no_show_count: sum.no_show_count + metric.no_show_count,
      upcoming_booking_id:
        upcoming?.upcoming_booking_id ?? sum.upcoming_booking_id,
      upcoming_start_at:
        upcoming?.upcoming_start_at ?? sum.upcoming_start_at,
    }),
    defaultMetric(customerId),
  );
}

function normalizedBookingStatus(status: BookingStatus) {
  return status === "scheduled" ? "confirmed" : status;
}

function numberValue(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function escapeSearch(value: string) {
  return value.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function parsePage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw ?? 1);

  return Number.isInteger(page) && page > 0 ? page : 1;
}

async function loadCustomerMetrics(input: {
  customerIds: string[];
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  if (input.customerIds.length === 0) {
    return new Map<string, CustomerCrmMetric>();
  }

  const { data, error } = await input.supabase.rpc("get_customer_crm_metrics", {
    p_customer_ids: input.customerIds,
    p_salon_id: input.salonId,
  });

  if (error) {
    console.error("Supabase load customer CRM metrics failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: input.salonId,
      customerIds: input.customerIds,
    });
    throw new Error(error.message);
  }

  return new Map(
    ((data ?? []) as CustomerCrmMetric[]).map((metric) => [
      metric.customer_id,
      metric,
    ]),
  );
}

async function loadDuplicateCandidatesForCustomers(input: {
  customers: Customer[];
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  const clauses = [
    ...new Set(
      input.customers
        .flatMap((customer) => [
          customer.phone ? `phone.eq.${customer.phone}` : null,
          customer.email ? `email.eq.${customer.email}` : null,
        ])
        .filter((clause): clause is string => Boolean(clause)),
    ),
  ];

  if (clauses.length === 0) {
    return new Map<string, Customer[]>();
  }

  const { data, error } = await input.supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("location_id", input.salonId)
    .or(clauses.join(","))
    .limit(250)
    .returns<Customer[]>();

  if (error) {
    console.error("Supabase load customer duplicate candidates failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  const candidatePool = data ?? [];

  return new Map(
    input.customers.map((customer) => [
      customer.id,
      candidatePool.filter(
        (candidate) =>
          candidate.id !== customer.id &&
          ((customer.phone && candidate.phone === customer.phone) ||
            (customer.email && candidate.email === customer.email)),
      ),
    ]),
  );
}

async function loadWalkingCustomers(input: {
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  const { data, error } = await input.supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("location_id", input.salonId)
    .is("phone", null)
    .is("email", null)
    .is("customer_user_id", null)
    .limit(500)
    .returns<Customer[]>();

  if (error) {
    console.error("Supabase load walking customers failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return (data ?? []).filter(isWalkingCustomer);
}

export async function getCurrentSalonCustomerList(input: {
  page?: string | string[];
  search?: string;
} = {}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return {
      context,
      customers: [] as CustomerListItem[],
      pagination: {
        count: 0,
        page: 1,
        pageCount: 1,
        pageSize: CUSTOMER_PAGE_SIZE,
      } satisfies CustomerListPagination,
    };
  }

  await requirePermission(CUSTOMER_PERMISSIONS.view, context);

  const salon = requireCurrentSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const trimmedSearch = input.search?.trim();
  const page = parsePage(input.page);
  const from = (page - 1) * CUSTOMER_PAGE_SIZE;
  const to = from + CUSTOMER_PAGE_SIZE - 1;
  let query = supabase
    .from("customers")
    .select(CUSTOMER_SELECT, { count: "exact" })
    .eq("location_id", salon.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (trimmedSearch) {
    const escapedSearch = escapeSearch(trimmedSearch);
    query = query.or(
      `name.ilike.%${escapedSearch}%,phone.ilike.%${escapedSearch}%,email.ilike.%${escapedSearch}%`,
    );
  }

  const { count, data, error } = await query.returns<Customer[]>();

  if (error) {
    console.error("Supabase load customers failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const rowsContainWalking = rows.some(isWalkingCustomer);
  const walkingCustomers = rowsContainWalking
    ? await loadWalkingCustomers({ salonId: salon.id, supabase })
    : [];
  const displayRows = rows.filter((customer) => !isWalkingCustomer(customer));
  const walkingPrimary = walkingCustomers[0] ?? null;
  const customerIds = [
    ...displayRows.map((customer) => customer.id),
    ...walkingCustomers.map((customer) => customer.id),
  ];
  const [metricsByCustomerId, duplicateCandidatesByCustomerId] = await Promise.all([
    loadCustomerMetrics({ customerIds, salonId: salon.id, supabase }),
    loadDuplicateCandidatesForCustomers({
      customers: displayRows,
      salonId: salon.id,
      supabase,
    }),
  ]);

  const customers = displayRows.map<CustomerListItem>((customer) => {
    const duplicateCandidates =
      duplicateCandidatesByCustomerId.get(customer.id) ?? [];

    return {
      ...customer,
      duplicateCandidates,
      duplicate_signal: duplicateCandidates.length > 0,
      metrics: metricsByCustomerId.get(customer.id) ?? defaultMetric(customer.id),
    };
  });

  if (walkingPrimary) {
    const walkingMetrics = walkingCustomers.map(
      (customer) => metricsByCustomerId.get(customer.id) ?? defaultMetric(customer.id),
    );
    const walkingGroupedIds = walkingCustomers.map((customer) => customer.id);
    const walkingItem: CustomerListItem = {
      ...walkingPrimary,
      duplicateCandidates: walkingCustomers.filter(
        (customer) => customer.id !== walkingPrimary.id,
      ),
      duplicate_signal: walkingCustomers.length > 1,
      groupedCustomerIds: walkingGroupedIds,
      isWalkingGroup: true,
      name: "Walking",
      metrics: aggregateCustomerMetrics(walkingPrimary.id, walkingMetrics),
    };

    const firstWalkingIndex = rows.findIndex(isWalkingCustomer);

    customers.splice(Math.max(0, firstWalkingIndex), 0, walkingItem);
  }

  return {
    context,
    customers,
    pagination: {
      count: count ?? rows.length,
      page,
      pageCount: Math.max(1, Math.ceil((count ?? rows.length) / CUSTOMER_PAGE_SIZE)),
      pageSize: CUSTOMER_PAGE_SIZE,
    } satisfies CustomerListPagination,
  };
}

export async function getCurrentSalonCustomers(search?: string) {
  const result = await getCurrentSalonCustomerList({ search });

  return {
    context: result.context,
    customers: result.customers,
  };
}

function groupLinesByBookingId(lines: BookingLine[]) {
  const grouped = new Map<string, BookingLine[]>();

  for (const line of lines) {
    grouped.set(line.booking_id, [...(grouped.get(line.booking_id) ?? []), line]);
  }

  return grouped;
}

function buildBookingSummaries(input: {
  bookings: CustomerBookingRow[];
  lines: BookingLine[];
}) {
  const linesByBookingId = groupLinesByBookingId(input.lines);

  return input.bookings.map<CustomerBookingSummary>((booking) => {
    const lines = linesByBookingId.get(booking.id) ?? [];

    return {
      ...booking,
      lines,
      normalizedStatus: normalizedBookingStatus(booking.status),
      serviceNames: lines
        .map((line) => line.service_name_snapshot)
        .filter((name, index, all) => name && all.indexOf(name) === index),
      subtotal: lines.reduce(
        (total, line) => total + numberValue(line.line_total),
        0,
      ),
    };
  });
}

async function loadBookingSummariesForCustomers(input: {
  customerIds: string[];
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  if (input.customerIds.length === 0) {
    return {
      bookingIds: [],
      bookingHistory: [],
      upcomingBookings: [],
    };
  }

  const [upcomingResult, historyResult] = await Promise.all([
    input.supabase
      .from("bookings")
      .select(CUSTOMER_BOOKING_SELECT)
      .eq("salon_id", input.salonId)
      .in("customer_id", input.customerIds)
      .gte("start_at", new Date().toISOString())
      .not("status", "in", '("cancelled","no_show")')
      .order("start_at", { ascending: true })
      .limit(6)
      .returns<CustomerBookingRow[]>(),
    input.supabase
      .from("bookings")
      .select(CUSTOMER_BOOKING_SELECT)
      .eq("salon_id", input.salonId)
      .in("customer_id", input.customerIds)
      .order("start_at", { ascending: false })
      .limit(30)
      .returns<CustomerBookingRow[]>(),
  ]);

  if (upcomingResult.error || historyResult.error) {
    const error = upcomingResult.error ?? historyResult.error;
    console.error("Supabase load customer bookings failed", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      customerIds: input.customerIds,
      salonId: input.salonId,
    });
    throw new Error(error?.message ?? "Unable to load customer bookings.");
  }

  const bookingsById = new Map<string, CustomerBookingRow>();

  for (const booking of [
    ...(upcomingResult.data ?? []),
    ...(historyResult.data ?? []),
  ]) {
    bookingsById.set(booking.id, booking);
  }

  const bookingIds = [...bookingsById.keys()];
  const linesResult =
    bookingIds.length > 0
      ? await input.supabase
          .from("booking_lines")
          .select(BOOKING_LINE_SELECT)
          .eq("salon_id", input.salonId)
          .in("booking_id", bookingIds)
          .order("display_order", { ascending: true })
          .returns<BookingLine[]>()
      : { data: [] as BookingLine[], error: null };

  if (linesResult.error) {
    console.error("Supabase load customer booking lines failed", {
      code: linesResult.error.code,
      message: linesResult.error.message,
      details: linesResult.error.details,
      hint: linesResult.error.hint,
      customerIds: input.customerIds,
      salonId: input.salonId,
    });
    throw new Error(linesResult.error.message);
  }

  const summariesById = new Map(
    buildBookingSummaries({
      bookings: [...bookingsById.values()],
      lines: linesResult.data ?? [],
    }).map((booking) => [booking.id, booking]),
  );

  return {
    bookingIds,
    bookingHistory: (historyResult.data ?? [])
      .map((booking) => summariesById.get(booking.id))
      .filter((booking): booking is CustomerBookingSummary => Boolean(booking)),
    upcomingBookings: (upcomingResult.data ?? [])
      .map((booking) => summariesById.get(booking.id))
      .filter((booking): booking is CustomerBookingSummary => Boolean(booking)),
  };
}

async function loadBookingEvents(input: {
  bookingIds: string[];
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  if (input.bookingIds.length === 0) {
    return [];
  }

  const { data, error } = await input.supabase
    .from("booking_status_events")
    .select(BOOKING_STATUS_EVENT_SELECT)
    .eq("salon_id", input.salonId)
    .in("booking_id", input.bookingIds)
    .order("created_at", { ascending: false })
    .limit(80)
    .returns<BookingStatusEvent[]>();

  if (error) {
    console.error("Supabase load customer booking events failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      bookingIds: input.bookingIds,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

function ticketWithTotals(ticket: PosTicketWithRelations): CustomerTicketSummary {
  return {
    ...ticket,
    totals: calculateTicketTotals({
      discountType: ticket.discount_type,
      discountValue: ticket.discount_value,
      items: ticket.ticket_items ?? [],
      payments: ticket.payments ?? [],
      taxRate: ticket.tax_rate,
      tipType: ticket.tip_type,
      tipValue: ticket.tip_value,
    }),
  };
}

async function loadCustomerTicketsForCustomers(input: {
  customerIds: string[];
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  if (input.customerIds.length === 0) {
    return [];
  }

  const { data, error } = await input.supabase
    .from("pos_tickets")
    .select(POS_TICKET_WITH_RELATIONS_SELECT)
    .eq("salon_id", input.salonId)
    .in("customer_id", input.customerIds)
    .order("opened_at", { ascending: false })
    .limit(30)
    .returns<PosTicketWithRelations[]>();

  if (error) {
    console.error("Supabase load customer POS tickets failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      customerIds: input.customerIds,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return (data ?? []).map(ticketWithTotals);
}

async function loadDuplicateCandidates(input: {
  customer: Customer;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  const clauses = [
    input.customer.phone ? `phone.eq.${input.customer.phone}` : null,
    input.customer.email ? `email.eq.${input.customer.email}` : null,
  ].filter((clause): clause is string => Boolean(clause));

  if (clauses.length === 0) {
    return [];
  }

  const { data, error } = await input.supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("location_id", input.salonId)
    .neq("id", input.customer.id)
    .or(clauses.join(","))
    .limit(10)
    .returns<Customer[]>();

  if (error) {
    console.error("Supabase load duplicate customer candidates failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      customerId: input.customer.id,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

function buildCustomerTimeline(input: {
  bookingEvents: BookingStatusEvent[];
  bookings: CustomerBookingSummary[];
  tickets: CustomerTicketSummary[];
}) {
  const items: CustomerTimelineItem[] = [];

  for (const booking of input.bookings) {
    items.push({
      href: `/bookings?date=${booking.start_at.slice(0, 10)}&bookingId=${booking.id}`,
      id: `booking-${booking.id}`,
      label: `Appointment ${booking.normalizedStatus.replace(/_/g, " ")}`,
      timestamp: booking.start_at,
      type: "booking",
    });
  }

  for (const event of input.bookingEvents) {
    items.push({
      href: `/bookings?bookingId=${event.booking_id}`,
      id: `booking-event-${event.id}`,
      label: event.event_type.replace(/_/g, " "),
      timestamp: event.created_at,
      type: "booking",
    });
  }

  for (const ticket of input.tickets) {
    items.push({
      href: `/pos-tickets/${ticket.id}`,
      id: `ticket-${ticket.id}`,
      label:
        ticket.status === "closed"
          ? `Ticket paid ${ticket.ticket_number}`
          : `Ticket ${ticket.status} ${ticket.ticket_number}`,
      timestamp: ticket.closed_at ?? ticket.opened_at,
      type: "ticket",
    });
  }

  return items
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
    )
    .slice(0, 60);
}

export async function getCurrentSalonCustomer(customerId: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, customer: null };
  }

  await requirePermission(CUSTOMER_PERMISSIONS.view, context);

  const salon = requireCurrentSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .eq("id", customerId)
    .eq("location_id", salon.id)
    .maybeSingle<Customer>();

  if (error) {
    console.error("Supabase load customer failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      customerId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

    return { context, customer: data ?? null };
}

export async function getCurrentSalonCustomerDetail(
  customerId: string,
  options: { walkingGroup?: boolean } = {},
) {
  const base = await getCurrentSalonCustomer(customerId);

  if (!base.customer) {
    return { context: base.context, data: null };
  }

  const salon = requireCurrentSalon(base.context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const baseCustomer = base.customer;
  const walkingCustomers =
    options.walkingGroup && isWalkingCustomer(baseCustomer)
      ? await loadWalkingCustomers({ salonId: salon.id, supabase })
      : [];
  const groupedCustomerIds =
    walkingCustomers.length > 0
      ? walkingCustomers.map((customer) => customer.id)
      : [baseCustomer.id];
  const displayCustomer =
    walkingCustomers.length > 0
      ? {
          ...baseCustomer,
          name: "Walking",
        }
      : baseCustomer;

  const [bookings, tickets, duplicateCandidates] = await Promise.all([
    loadBookingSummariesForCustomers({
      customerIds: groupedCustomerIds,
      salonId: salon.id,
      supabase,
    }),
    loadCustomerTicketsForCustomers({
      customerIds: groupedCustomerIds,
      salonId: salon.id,
      supabase,
    }),
    walkingCustomers.length > 0
      ? Promise.resolve(
          walkingCustomers.filter((customer) => customer.id !== baseCustomer.id),
        )
      : loadDuplicateCandidates({
          customer: baseCustomer,
          salonId: salon.id,
          supabase,
        }),
  ]);
  const bookingEvents = await loadBookingEvents({
    bookingIds: bookings.bookingIds,
    salonId: salon.id,
    supabase,
  });
  const activeTickets = tickets.filter((ticket) =>
    ["open", "cancelled"].includes(ticket.status),
  );
  const finalizedSpend = tickets
    .filter((ticket) => ticket.status === "closed")
    .reduce((total, ticket) => total + ticket.totals.total, 0);
  const timeline = buildCustomerTimeline({
    bookingEvents,
    bookings: bookings.bookingHistory,
    tickets,
  });

  return {
    context: base.context,
    data: {
      activeTickets,
      bookingHistory: bookings.bookingHistory,
      customer: displayCustomer,
      duplicateCandidates,
      finalizedSpend,
      groupedCustomerIds:
        groupedCustomerIds.length > 1 ? groupedCustomerIds : undefined,
      isWalkingGroup: walkingCustomers.length > 0,
      tickets,
      timeline,
      upcomingBookings: bookings.upcomingBookings,
    } satisfies CustomerDetailData,
  };
}
