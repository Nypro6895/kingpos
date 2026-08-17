import "server-only";

import { isMissingSupabaseColumnError } from "@/lib/supabase/postgrest-errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CustomerDisplayVisit,
  CustomerVisitRequestedService,
  CustomerVisitQueueItem,
  CustomerVisitSource,
  CustomerVisitStatus,
} from "@/types/customer-visit";

type CustomerVisitSupabaseClient = SupabaseClient;

type CustomerVisitQueueRpcRow = {
  appointment_id: string | null;
  appointment_start_at: string | null;
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  checked_in_at: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  id: string;
  requested_services: unknown;
  salon_id: string;
  service_label: string | null;
  source: string;
  status: string;
  ticket_id: string | null;
};

export type CustomerDisplaySubmissionMode = "check_in" | "checkout";

export type CustomerDisplaySubmissionResult =
  | {
      mode: CustomerDisplaySubmissionMode;
      snapshot?: unknown;
      state?: "already_checked_in" | "checked_in";
      visit: CustomerDisplayVisit | null;
      ok: true;
    }
  | {
      code: string;
      message: string;
      mode?: CustomerDisplaySubmissionMode;
      ok: false;
    };

export type CustomerVisitSelectionResult =
  | {
      snapshot: unknown;
      visit: CustomerDisplayVisit | null;
      ok: true;
    }
  | { code: string; message: string; ok: false };

export type CustomerVisitCompletionResult =
  | {
      appointmentId: string | null;
      status: CustomerVisitStatus | null;
      ticketId: string | null;
      visitId: string | null;
      ok: true;
    }
  | { code: string; message: string; ok: false };

const CUSTOMER_VISIT_SOURCES = new Set<CustomerVisitSource>([
  "appointment",
  "customer_screen",
  "walk_in",
]);
const CUSTOMER_VISIT_STATUSES = new Set<CustomerVisitStatus>([
  "cancelled",
  "checkout",
  "completed",
  "in_service",
  "waiting",
]);

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function readSource(value: unknown): CustomerVisitSource {
  const source = readString(value);
  return source && CUSTOMER_VISIT_SOURCES.has(source as CustomerVisitSource)
    ? (source as CustomerVisitSource)
    : "customer_screen";
}

function readStatus(value: unknown): CustomerVisitStatus {
  const status = readString(value);
  return status && CUSTOMER_VISIT_STATUSES.has(status as CustomerVisitStatus)
    ? (status as CustomerVisitStatus)
    : "waiting";
}

function readRequestedService(value: unknown): CustomerVisitRequestedService | null {
  const payload = readObject(value);
  const id = readString(payload.id);
  const name = readString(payload.name);

  if (!id || !name) {
    return null;
  }

  return {
    basePrice: readNumber(payload.basePrice),
    category: readString(payload.category),
    durationMinutes: readNumber(payload.durationMinutes),
    id,
    name,
    sortOrder: Math.max(1, Math.round(readNumber(payload.sortOrder) || 1)),
  };
}

function readRequestedServices(
  value: unknown,
): CustomerVisitRequestedService[] {
  return Array.isArray(value)
    ? value
        .map(readRequestedService)
        .filter(
          (service): service is CustomerVisitRequestedService =>
            Boolean(service),
        )
    : [];
}

function readVisit(value: unknown): CustomerDisplayVisit | null {
  const payload = readObject(value);
  const id = readString(payload.id);
  const customerId = readString(payload.customerId);
  const checkedInAt = readString(payload.checkedInAt);

  if (!id || !customerId || !checkedInAt) {
    return null;
  }

  return {
    appointmentId: readString(payload.appointmentId),
    checkedInAt,
    customerId,
    firstName: readString(payload.firstName),
    id,
    requestedServices: readRequestedServices(payload.requestedServices),
    source: readSource(payload.source),
    status: readStatus(payload.status),
    ticketId: readString(payload.ticketId),
  };
}

function readErrorResult(value: unknown, fallbackMessage: string) {
  const payload = readObject(value);
  const mode: CustomerDisplaySubmissionMode | undefined =
    payload.mode === "checkout" || payload.mode === "check_in"
      ? payload.mode
      : undefined;

  return {
    code: readString(payload.code) ?? "unknown",
    message: readString(payload.message) ?? fallbackMessage,
    mode,
    ok: false as const,
  };
}

function mapQueueRow(row: CustomerVisitQueueRpcRow): CustomerVisitQueueItem {
  return {
    appointmentId: row.appointment_id,
    appointmentStartAt: row.appointment_start_at,
    assignedStaffId: row.assigned_staff_id,
    assignedStaffName: row.assigned_staff_name,
    checkedInAt: row.checked_in_at,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    id: row.id,
    requestedServices: readRequestedServices(row.requested_services),
    salonId: row.salon_id,
    serviceLabel: row.service_label,
    source: readSource(row.source),
    status: readStatus(row.status),
    ticketId: row.ticket_id,
  };
}

export async function updateCustomerVisitRequestedServices(input: {
  serviceIds: string[];
  supabase: CustomerVisitSupabaseClient;
  token: string;
  visitId: string;
}): Promise<CustomerDisplaySubmissionResult> {
  const { data, error } = await input.supabase.rpc(
    "update_customer_visit_requested_services",
    {
      p_service_ids: input.serviceIds,
      p_token: input.token,
      p_visit_id: input.visitId,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload = readObject(data);

  if (payload.ok !== true) {
    return readErrorResult(
      payload,
      "Unable to save service request. Please ask the front desk.",
    );
  }

  return {
    mode: "check_in",
    ok: true,
    state: "checked_in",
    visit: readVisit(payload.visit),
  };
}

export async function getCustomerVisitQueueForSalon(input: {
  limit?: number;
  salonId: string;
  supabase: CustomerVisitSupabaseClient;
}) {
  const { data, error } = await input.supabase.rpc("get_customer_visit_queue", {
    p_limit: input.limit ?? 25,
    p_salon_id: input.salonId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CustomerVisitQueueRpcRow[]).map(mapQueueRow);
}

export async function getCustomerVisitQueueForSalonOrEmpty(input: {
  limit?: number;
  salonId: string;
  supabase: CustomerVisitSupabaseClient;
}) {
  try {
    return await getCustomerVisitQueueForSalon(input);
  } catch (error) {
    if (isMissingSupabaseColumnError(error)) {
      return [];
    }

    throw error;
  }
}

export async function resolveCustomerDisplaySubmission(input: {
  customerName?: string | null;
  phone: string;
  requestId?: string | null;
  supabase: CustomerVisitSupabaseClient;
  token: string;
}): Promise<CustomerDisplaySubmissionResult> {
  const { data, error } = await input.supabase.rpc(
    "resolve_customer_display_submission",
    {
      p_customer_name: input.customerName ?? null,
      p_phone: input.phone,
      p_request_id: input.requestId ?? null,
      p_token: input.token,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload = readObject(data);

  if (payload.ok !== true) {
    return readErrorResult(
      payload,
      "Unable to continue. Please ask the front desk.",
    );
  }

  const mode =
    payload.mode === "checkout" || payload.mode === "check_in"
      ? payload.mode
      : "check_in";

  return {
    mode,
    ok: true,
    snapshot: payload.snapshot,
    state:
      payload.state === "already_checked_in" || payload.state === "checked_in"
        ? payload.state
        : undefined,
    visit: readVisit(payload.visit),
  };
}

export async function selectCustomerVisitForLiveDraft(input: {
  supabase: CustomerVisitSupabaseClient;
  token: string;
  visitId: string;
}): Promise<CustomerVisitSelectionResult> {
  const { data, error } = await input.supabase.rpc(
    "select_customer_visit_for_live_draft",
    {
      p_token: input.token,
      p_visit_id: input.visitId,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload = readObject(data);

  if (payload.ok !== true) {
    return readErrorResult(payload, "Unable to select waiting client.");
  }

  return {
    ok: true,
    snapshot: payload.snapshot,
    visit: readVisit(payload.visit),
  };
}

export async function cancelCustomerVisit(input: {
  reason?: string | null;
  supabase: CustomerVisitSupabaseClient;
  visitId: string;
}) {
  const { data, error } = await input.supabase.rpc("cancel_customer_visit", {
    p_reason: input.reason ?? null,
    p_visit_id: input.visitId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const payload = readObject(data);

  if (payload.ok !== true) {
    return readErrorResult(payload, "Unable to remove waiting client.");
  }

  return {
    ok: true as const,
    status: readStatus(payload.status),
    visitId: readString(payload.visitId),
  };
}

export async function completeCustomerVisitForTicket(input: {
  customerId: string;
  preferredVisitId?: string | null;
  salonId: string;
  supabase: CustomerVisitSupabaseClient;
  ticketId: string;
}): Promise<CustomerVisitCompletionResult> {
  const { data, error } = await input.supabase.rpc(
    "complete_customer_visit_for_ticket",
    {
      p_customer_id: input.customerId,
      p_preferred_visit_id: input.preferredVisitId ?? null,
      p_salon_id: input.salonId,
      p_ticket_id: input.ticketId,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload = readObject(data);

  if (payload.ok !== true) {
    return readErrorResult(payload, "Unable to complete customer visit.");
  }

  return {
    appointmentId: readString(payload.appointmentId),
    ok: true,
    status: payload.status ? readStatus(payload.status) : null,
    ticketId: readString(payload.ticketId),
    visitId: readString(payload.visitId),
  };
}
