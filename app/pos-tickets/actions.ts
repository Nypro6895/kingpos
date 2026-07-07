"use server";

import {
  POS_TICKET_ITEM_SELECT,
  POS_TICKET_PERMISSIONS,
} from "@/lib/pos-tickets";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { POS_DESK_DEFAULTS } from "@/lib/pos-desk";
import { getTurnType } from "@/lib/pos-desk-amounts";
import {
  POS_PAYMENT_METHOD_OPTIONS,
  POS_PAYMENT_SELECT,
} from "@/lib/pos-payments";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { recalculateStaffEarningsForDate } from "@/lib/pos-ticket-staff-earnings";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { PosTicketAuditAction } from "@/types/pos-ticket-audit-log";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readRequiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readOptionalString(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);
  return value || null;
}

function readRequiredNote(formData: FormData, returnPath = "/pos-tickets") {
  const note = readRequiredString(formData, "note");

  if (!note) {
    redirectWithError("Note is required.", undefined, undefined, undefined, returnPath);
  }

  return note;
}

function readReturnPath(formData: FormData) {
  const value = readRequiredString(formData, "return_to");

  if (!value.startsWith("/pos-tickets")) {
    return "/pos-tickets";
  }

  return value;
}

function redirectWithError(
  message: string,
  editId?: string,
  itemEditId?: string,
  paymentTicketId?: string,
  returnPath = "/pos-tickets",
): never {
  const params = new URLSearchParams({ error: message });

  if (editId) {
    params.set("edit", editId);
  }

  if (itemEditId) {
    params.set("itemEdit", itemEditId);
  }

  if (paymentTicketId) {
    params.set("payments", paymentTicketId);
  }

  const separator = returnPath.includes("?") ? "&" : "?";
  redirect(`${returnPath}${separator}${params.toString()}`);
}

function redirectWithCheckoutError(
  message: string,
  ticketId: string,
  returnPath = "/pos-tickets",
): never {
  const params = new URLSearchParams({
    checkout: ticketId,
    error: message,
  });

  const separator = returnPath.includes("?") ? "&" : "?";
  redirect(`${returnPath}${separator}${params.toString()}`);
}

function redirectAfterMutation(returnPath: string): never {
  redirect(returnPath);
}

function readNumber(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);
  return Number(value);
}

function readJsonArray<T>(formData: FormData, key: string): T[] {
  const value = readRequiredString(formData, key);

  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    throw new Error(`${key} must be an array.`);
  }

  return parsed as T[];
}

function getSafeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }

  return fallback;
}

function toCents(value: number | string) {
  const numeric = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numeric)) {
    return Number.NaN;
  }

  return Math.round(numeric * 100);
}

function fromCents(value: number) {
  return value / 100;
}

function normalizePartsInput(parts: Array<{ amount: unknown }> | undefined) {
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts.map((part) => {
    if (!part || typeof part !== "object" || !("amount" in part)) {
      throw new Error("Part amount is required.");
    }

    if (
      part.amount === null ||
      part.amount === undefined ||
      (typeof part.amount === "string" && part.amount.trim() === "")
    ) {
      throw new Error("Part amount is required.");
    }

    const amount = Number(part.amount);

    if (!Number.isFinite(amount)) {
      throw new Error("Part amount is required.");
    }

    if (amount <= 0) {
      throw new Error("Part amount must be greater than 0.");
    }

    return Math.round(amount * 100) / 100;
  });
}

function sumParts(parts: number[]) {
  return Math.round(
    parts.reduce((total, amount) => total + amount, 0) * 100,
  ) / 100;
}

function validatePositiveParts(parts: number[], label: string) {
  if (parts.length === 0) {
    throw new Error(`${label} must include at least one part.`);
  }

  if (parts.some((amount) => !Number.isFinite(amount))) {
    throw new Error("Part amount is required.");
  }

  if (parts.some((amount) => amount <= 0)) {
    throw new Error("Part amount must be greater than 0.");
  }

  if (sumParts(parts) <= 0) {
    throw new Error(`${label} total must be greater than 0.`);
  }
}

function formatDateInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return value.slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function readDateTime(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);

  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

const PAYMENT_METHOD_VALUES = POS_PAYMENT_METHOD_OPTIONS.map(
  (method) => method.value,
);
const DISCOUNT_TYPE_VALUES = ["fixed_amount", "percentage"] as const;
const TIP_TYPE_VALUES = ["fixed_amount", "percentage"] as const;

type ClosedTicketItemUpdateInput = {
  item_id: string;
  parts: Array<{ amount: unknown }>;
  remove: boolean;
  service_id: string | null;
  staff_id: string | null;
};

type ClosedTicketItemPartsInput = {
  item_id: string;
  parts: Array<{ amount: unknown }>;
};

type ClosedTicketAddedItemInput = {
  parts: Array<{ amount: unknown }>;
  service_id: string;
  staff_id: string;
};

type ClosedTicketStaffTipOverrideInput = {
  is_manual: boolean;
  staff_id: string;
  tip_amount: number;
};

type TurnPartInsertRow = {
  amount: number;
  organization_id: string;
  salon_id: string;
  staff_id: string;
  ticket_id: string;
  ticket_item_id: string;
  turn_index: number;
  turn_type: "large" | "small";
  work_date: string;
};

type ExistingTurnPartRow = TurnPartInsertRow & {
  created_at?: string;
  id?: string;
};

async function requirePosTicketMutationContext(editId?: string) {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!context.currentOrganization) {
    redirectWithError("Create an organization before managing POS tickets.", editId);
  }

  if (!context.currentSalon) {
    redirectWithError("Please select a salon first.", editId);
  }

  try {
    await requirePermission(POS_TICKET_PERMISSIONS.manage, context);
  } catch {
    redirectWithError("You do not have permission to manage POS tickets.", editId);
  }

  return {
    supabase,
    context,
    organization: context.currentOrganization,
    salon: context.currentSalon,
    user: context.user,
  };
}

async function requireClosedTicketCorrectionContext(editId?: string) {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!context.currentOrganization) {
    redirectWithError("Create an organization before managing POS tickets.", editId);
  }

  if (!context.currentSalon) {
    redirectWithError("Please select a salon first.", editId);
  }

  const canCorrect =
    (await hasPermission(POS_TICKET_PERMISSIONS.manage, context)) ||
    (await hasPermission(POS_TICKET_PERMISSIONS.void, context));

  if (!canCorrect) {
    redirectWithError("You do not have permission to correct closed POS tickets.", editId);
  }

  return {
    supabase,
    context,
    organization: context.currentOrganization,
    salon: context.currentSalon,
    user: context.user,
  };
}

async function requirePosTicketVoidContext(editId?: string) {
  const context = await requirePosTicketMutationContext(editId);

  try {
    await requirePermission(POS_TICKET_PERMISSIONS.void, context.context);
  } catch {
    redirectWithError("You do not have permission to void or reopen POS tickets.", editId);
  }

  return context;
}

async function writePosTicketAuditLog({
  action,
  note,
  organizationId,
  salonId,
  supabase,
  ticketId,
  userId,
}: {
  action: PosTicketAuditAction;
  note: string;
  organizationId: string;
  salonId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  ticketId: string;
  userId: string;
}) {
  const { error } = await supabase
    .from("pos_ticket_audit_logs")
    .insert({
      action,
      created_by: userId,
      note,
      organization_id: organizationId,
      salon_id: salonId,
      ticket_id: ticketId,
    });

  if (error) {
    throw error;
  }
}

async function loadClosedCorrectionSnapshot({
  organizationId,
  salonId,
  supabase,
  ticketId,
}: {
  organizationId: string;
  salonId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  ticketId: string;
}) {
  const [{ data: ticket, error: ticketError }, { data: earnings, error: earningsError }] =
    await Promise.all([
      supabase
        .from("pos_tickets")
        .select(
          "id, organization_id, salon_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at, ticket_items:pos_ticket_items(id, organization_id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, is_removed, removed_at, removed_by, removal_reason, created_at, updated_at, service:services(id, name, category, base_price, duration_minutes), assigned_staff:staff(id, display_name, job_title), turn_parts:pos_ticket_item_turn_parts(id, ticket_id, ticket_item_id, staff_id, amount, turn_type, turn_index, work_date, created_at))",
        )
        .eq("id", ticketId)
        .eq("organization_id", organizationId)
        .eq("salon_id", salonId)
        .maybeSingle(),
      supabase
        .from("pos_ticket_staff_earnings")
        .select(
          "id, ticket_id, staff_id, work_date, service_total, tip_amount, tip_is_manual, manual_tip_amount, big_turn_count, small_turn_count, first_big_turn_sequence, last_big_turn_sequence, first_small_turn_sequence, last_small_turn_sequence, total_earning, locked_at, payroll_batch_id",
        )
        .eq("organization_id", organizationId)
        .eq("salon_id", salonId)
        .eq("ticket_id", ticketId),
    ]);

  if (ticketError) {
    throw ticketError;
  }

  if (earningsError) {
    throw earningsError;
  }

  return {
    earnings: earnings ?? [],
    ticket,
  };
}

async function assertWorkDateIsUnlocked({
  organizationId,
  salonId,
  supabase,
  workDate,
}: {
  organizationId: string;
  salonId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  workDate: string;
}) {
  const { data, error } = await supabase
    .from("pos_ticket_staff_earnings")
    .select("id, locked_at, payroll_batch_id")
    .eq("organization_id", organizationId)
    .eq("salon_id", salonId)
    .eq("work_date", workDate)
    .returns<Array<{ id: string; locked_at: string | null; payroll_batch_id: string | null }>>();

  if (error) {
    throw error;
  }

  if ((data ?? []).some((row) => row.locked_at || row.payroll_batch_id)) {
    throw new Error("This work date has locked payroll earnings and cannot be corrected.");
  }
}

function buildTurnPartRows({
  itemId,
  organizationId,
  parts,
  salonId,
  staffId,
  ticketId,
  workDate,
}: {
  itemId: string;
  organizationId: string;
  parts: number[];
  salonId: string;
  staffId: string | null;
  ticketId: string;
  workDate: string;
}): TurnPartInsertRow[] {
  if (!staffId) {
    return [];
  }

  return parts.filter((amount) => amount > 0).map((amount, index) => ({
    amount,
    organization_id: organizationId,
    salon_id: salonId,
    staff_id: staffId,
    ticket_id: ticketId,
    ticket_item_id: itemId,
    turn_index: index + 1,
    turn_type: getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold),
    work_date: workDate,
  }));
}

function assertTurnPartRows(rows: TurnPartInsertRow[], allowEmpty = false) {
  if (!allowEmpty && rows.length === 0) {
    throw new Error("Part amount is required.");
  }

  for (const row of rows) {
    if (
      !row.organization_id ||
      !row.salon_id ||
      !row.ticket_id ||
      !row.ticket_item_id ||
      !row.staff_id
    ) {
      throw new Error("Unable to rebuild turn parts: missing required row scope.");
    }

    if (!Number.isFinite(row.amount)) {
      throw new Error("Part amount is required.");
    }

    if (row.amount <= 0) {
      throw new Error("Part amount must be greater than 0.");
    }

    if (!Number.isInteger(row.turn_index) || row.turn_index <= 0) {
      throw new Error("Unable to rebuild turn parts: invalid part order.");
    }

    if (row.turn_type !== "large" && row.turn_type !== "small") {
      throw new Error("Unable to rebuild turn parts: invalid turn type.");
    }
  }
}

function restoreTurnPartRows(rows: ExistingTurnPartRow[]) {
  return rows
    .filter((row) => row.staff_id && row.amount > 0)
    .map<TurnPartInsertRow>((row) => ({
      amount: row.amount,
      organization_id: row.organization_id,
      salon_id: row.salon_id,
      staff_id: row.staff_id,
      ticket_id: row.ticket_id,
      ticket_item_id: row.ticket_item_id,
      turn_index: row.turn_index,
      turn_type: row.turn_type,
      work_date: row.work_date,
    }));
}

async function rebuildCorrectionTurnParts({
  itemId,
  organizationId,
  parts,
  salonId,
  staffId,
  supabase,
  ticketId,
  workDate,
}: {
  itemId: string;
  organizationId: string;
  parts: number[];
  salonId: string;
  staffId: string | null;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  ticketId: string;
  workDate: string;
}) {
  const turnRows = buildTurnPartRows({
    itemId,
    organizationId,
    parts,
    salonId,
    staffId,
    ticketId,
    workDate,
  });
  assertTurnPartRows(turnRows, !staffId && parts.length === 0);

  const { data: existingRows, error: existingError } = await supabase
    .from("pos_ticket_item_turn_parts")
    .select(
      "organization_id, salon_id, ticket_id, ticket_item_id, staff_id, amount, turn_type, turn_index, work_date",
    )
    .eq("ticket_item_id", itemId)
    .eq("organization_id", organizationId)
    .eq("salon_id", salonId)
    .returns<ExistingTurnPartRow[]>();

  if (existingError) {
    throw new Error(
      `Unable to rebuild turn parts: ${getSafeErrorMessage(existingError, "load failed")}`,
    );
  }

  const { error: deleteError } = await supabase
    .from("pos_ticket_item_turn_parts")
    .delete()
    .eq("ticket_item_id", itemId)
    .eq("organization_id", organizationId)
    .eq("salon_id", salonId);

  if (deleteError) {
    throw new Error(
      `Unable to rebuild turn parts: ${getSafeErrorMessage(deleteError, "delete failed")}`,
    );
  }

  if (turnRows.length === 0) {
    return;
  }

  const { error: insertError } = await supabase
    .from("pos_ticket_item_turn_parts")
    .insert(turnRows);

  if (insertError) {
    const restoreRows = restoreTurnPartRows(existingRows ?? []);

    if (restoreRows.length > 0) {
      const { error: restoreError } = await supabase
        .from("pos_ticket_item_turn_parts")
        .insert(restoreRows);

      if (restoreError) {
        throw new Error(
          `Unable to rebuild turn parts: ${getSafeErrorMessage(
            insertError,
            "insert failed",
          )}; restore failed: ${getSafeErrorMessage(restoreError, "restore failed")}`,
        );
      }
    }

    throw new Error(
      `Unable to rebuild turn parts: ${getSafeErrorMessage(insertError, "insert failed")}`,
    );
  }
}

async function validateCustomerRelationship(customerId: string, editId?: string) {
  const { supabase, salon } = await requirePosTicketMutationContext(editId);

  const { data: customer, error } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("location_id", salon.id)
    .maybeSingle<{ id: string }>();

  if (error || !customer) {
    redirectWithError("Customer is required.", editId);
  }
}

async function validateOpenTicketRelationship(
  ticketId: string,
  editId?: string,
  returnPath = "/pos-tickets",
) {
  const { supabase, salon } = await requirePosTicketMutationContext(editId);

  const { data: ticket, error } = await supabase
    .from("pos_tickets")
    .select("id, status")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; status: string }>();

  if (error || !ticket) {
    redirectWithError("POS Ticket is required.", editId, undefined, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", editId, undefined, undefined, returnPath);
  }
}

async function validateOpenPaymentTicket(
  ticketId: string,
  amount: number,
  returnPath = "/pos-tickets",
) {
  const { supabase, salon } = await requirePosTicketMutationContext(undefined);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, status, discount_type, discount_value, tax_rate, tip_type, tip_value")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      status: string;
      discount_type: "fixed_amount" | "percentage";
      discount_value: number;
      tax_rate: number;
      tip_type: "fixed_amount" | "percentage";
      tip_value: number;
    }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, ticketId, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError(
      "Payments can only be added to Open tickets.",
      undefined,
      undefined,
      ticketId,
      returnPath,
    );
  }

  const [{ data: items, error: itemsError }, { data: payments, error: paymentsError }] =
    await Promise.all([
      supabase
        .from("pos_ticket_items")
        .select("line_total")
        .eq("pos_ticket_id", ticketId)
        .eq("salon_id", salon.id)
        .returns<{ line_total: number }[]>(),
      supabase
        .from("pos_payments")
        .select("amount")
        .eq("ticket_id", ticketId)
        .eq("salon_id", salon.id)
        .returns<{ amount: number }[]>(),
    ]);

  if (itemsError) {
    redirectWithError(itemsError.message, undefined, undefined, ticketId, returnPath);
  }

  if (paymentsError) {
    redirectWithError(paymentsError.message, undefined, undefined, ticketId, returnPath);
  }

  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: items ?? [],
    payments: payments ?? [],
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });

  if (toCents(amount) > toCents(totals.remaining)) {
    redirectWithError(
      "Payment amount cannot exceed remaining balance.",
      undefined,
      undefined,
      ticketId,
      returnPath,
    );
  }
}

async function validatePaymentRelationship(
  paymentId: string,
  returnPath = "/pos-tickets",
) {
  const { supabase, salon } = await requirePosTicketMutationContext(undefined);

  const { data: payment, error } = await supabase
    .from("pos_payments")
    .select("id, ticket_id, ticket:pos_tickets(id, status)")
    .eq("id", paymentId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      ticket_id: string;
      ticket: { id: string; status: string } | null;
    }>();

  if (error || !payment) {
    redirectWithError("Payment id is required.", undefined, undefined, undefined, returnPath);
  }

  if (payment.ticket?.status !== "open") {
    redirectWithError(
      "Payments can only be deleted while the ticket is Open.",
      undefined,
      undefined,
      payment.ticket_id,
      returnPath,
    );
  }

  return payment;
}

async function validateOpenTicketItemRelationship(
  itemId: string,
  returnPath = "/pos-tickets",
) {
  const { supabase, salon } = await requirePosTicketMutationContext();

  const { data: item, error: itemError } = await supabase
    .from("pos_ticket_items")
    .select("id, pos_ticket_id")
    .eq("id", itemId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; pos_ticket_id: string }>();

  if (itemError || !item) {
    redirectWithError("Ticket item id is required.", undefined, itemId, undefined, returnPath);
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, status")
    .eq("id", item.pos_ticket_id)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; status: string }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, itemId, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", undefined, itemId, undefined, returnPath);
  }
}

async function validateCheckoutTicket(ticketId: string, returnPath = "/pos-tickets") {
  const { supabase, salon } = await requirePosTicketMutationContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, status, discount_type, discount_value, tax_rate, tip_type, tip_value")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      status: string;
      discount_type: "fixed_amount" | "percentage";
      discount_value: number;
      tax_rate: number;
      tip_type: "fixed_amount" | "percentage";
      tip_value: number;
    }>();

  if (ticketError || !ticket) {
    redirectWithCheckoutError("POS Ticket is required.", ticketId, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithCheckoutError("Only Open tickets can be checked out.", ticketId, returnPath);
  }

  const [{ data: items, error: itemsError }, { data: payments, error: paymentsError }] =
    await Promise.all([
      supabase
        .from("pos_ticket_items")
        .select("line_total")
        .eq("pos_ticket_id", ticketId)
        .eq("salon_id", salon.id)
        .returns<{ line_total: number }[]>(),
      supabase
        .from("pos_payments")
        .select("amount")
        .eq("ticket_id", ticketId)
        .eq("salon_id", salon.id)
        .returns<{ amount: number }[]>(),
    ]);

  if (itemsError) {
    redirectWithCheckoutError(itemsError.message, ticketId, returnPath);
  }

  if (paymentsError) {
    redirectWithCheckoutError(paymentsError.message, ticketId, returnPath);
  }

  if (!items?.length) {
    redirectWithCheckoutError(
      "Ticket must have at least one Ticket Item.",
      ticketId,
      returnPath,
    );
  }

  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items,
    payments: payments ?? [],
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });
  const totalCents = toCents(totals.total);
  const paidCents = toCents(totals.paid);
  const remainingCents = toCents(totals.remaining);

  if (totalCents <= 0) {
    redirectWithCheckoutError(
      "Ticket Total must be greater than 0 before checkout.",
      ticketId,
      returnPath,
    );
  }

  if (paidCents > totalCents || remainingCents < 0) {
    redirectWithCheckoutError("Paid Total cannot exceed Total.", ticketId, returnPath);
  }

  if (paidCents < totalCents || remainingCents > 0) {
    redirectWithCheckoutError(
      "Ticket must be fully paid before checkout.",
      ticketId,
      returnPath,
    );
  }
}

async function validateServiceRelationship(serviceId: string, editId?: string) {
  const { supabase, salon } = await requirePosTicketMutationContext(editId);

  const { data: service, error } = await supabase
    .from("services")
    .select("id")
    .eq("id", serviceId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string }>();

  if (error || !service) {
    redirectWithError("Service is required.", editId);
  }
}

async function validateStaffRelationship(staffId: string, itemEditId?: string) {
  const { supabase, salon } = await requirePosTicketMutationContext();

  const { data: staff, error } = await supabase
    .from("staff")
    .select("id")
    .eq("id", staffId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string }>();

  if (error || !staff) {
    redirectWithError("Assigned Staff must belong to the current salon.", undefined, itemEditId);
  }
}

function validateCreateInput(formData: FormData) {
  const customerId = readRequiredString(formData, "customer_id");
  const openedAt = readDateTime(formData, "opened_at");
  const closedAt = readDateTime(formData, "closed_at");

  if (!customerId) {
    redirectWithError("Customer is required.");
  }

  if (!openedAt) {
    redirectWithError("opened_at is required.");
  }

  if (closedAt && new Date(closedAt).getTime() < new Date(openedAt).getTime()) {
    redirectWithError("closed_at must not be earlier than opened_at.");
  }

  return {
    customerId,
    openedAt,
    closedAt: closedAt || null,
    notes: readOptionalString(formData, "notes"),
  };
}

export async function createPosTicket(formData: FormData) {
  const { supabase, context, organization, salon, user } =
    await requirePosTicketMutationContext();
  const input = validateCreateInput(formData);

  await validateCustomerRelationship(input.customerId);

  const { error } = await supabase
    .from("pos_tickets")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      customer_id: input.customerId,
      opened_at: input.openedAt,
      closed_at: input.closedAt,
      notes: input.notes,
      status: "open",
    })
    .select("id")
    .single();

  if (error) {
    console.error("Supabase create POS ticket failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message);
  }

  revalidatePath("/pos-tickets");
  redirect("/pos-tickets");
}

export async function updatePosTicketNotes(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");

  if (!ticketId) {
    redirectWithError("Ticket id is required.");
  }

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext(ticketId);
  const notes = readOptionalString(formData, "notes");

  await validateOpenTicketRelationship(ticketId, ticketId);

  const { error } = await supabase
    .from("pos_tickets")
    .update({ notes })
    .eq("id", ticketId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket notes failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, ticketId);
  }

  revalidatePath("/pos-tickets");
  redirect("/pos-tickets");
}

export async function updatePosTicketDiscount(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);
  const discountType = readRequiredString(formData, "discount_type");
  const discountValue = readNumber(formData, "discount_value");

  if (!ticketId) {
    redirectWithError("Ticket id is required.", undefined, undefined, undefined, returnPath);
  }

  if (
    !DISCOUNT_TYPE_VALUES.includes(
      discountType as (typeof DISCOUNT_TYPE_VALUES)[number],
    )
  ) {
    redirectWithError("Discount Type is required.", undefined, undefined, undefined, returnPath);
  }

  if (!Number.isFinite(discountValue) || discountValue < 0) {
    redirectWithError("Discount cannot be negative.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, organization_id, status")
    .eq("id", ticketId)
    .eq("organization_id", context.currentOrganization?.id)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      status: string;
    }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", undefined, undefined, undefined, returnPath);
  }

  const { data: items, error: itemsError } = await supabase
    .from("pos_ticket_items")
    .select("line_total")
    .eq("pos_ticket_id", ticketId)
    .eq("organization_id", ticket.organization_id)
    .eq("salon_id", salon.id)
    .returns<{ line_total: number }[]>();

  if (itemsError) {
    redirectWithError(itemsError.message, undefined, undefined, undefined, returnPath);
  }

  const totals = calculateTicketTotals({ items: items ?? [] });

  if (totals.subtotal === 0 && discountValue !== 0) {
    redirectWithError("Discount must be zero when Subtotal is 0.", undefined, undefined, undefined, returnPath);
  }

  if (discountType === "fixed_amount" && discountValue > totals.subtotal) {
    redirectWithError("Fixed Amount discount must not exceed Subtotal.", undefined, undefined, undefined, returnPath);
  }

  if (discountType === "percentage" && discountValue > 100) {
    redirectWithError("Percentage discount must be between 0 and 100.", undefined, undefined, undefined, returnPath);
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({
      discount_type: discountType,
      discount_value: discountValue,
    })
    .eq("id", ticketId)
    .eq("organization_id", ticket.organization_id)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket discount failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function updatePosTicketTaxRate(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);
  const taxRate = readNumber(formData, "tax_rate");

  if (!ticketId) {
    redirectWithError("Ticket id is required.", undefined, undefined, undefined, returnPath);
  }

  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    redirectWithError("Tax Rate must be between 0 and 100.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, organization_id, status")
    .eq("id", ticketId)
    .eq("organization_id", context.currentOrganization?.id)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      status: string;
    }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", undefined, undefined, undefined, returnPath);
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({ tax_rate: taxRate })
    .eq("id", ticketId)
    .eq("organization_id", ticket.organization_id)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket tax rate failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function updatePosTicketTip(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);
  const tipType = readRequiredString(formData, "tip_type");
  const tipValue = readNumber(formData, "tip_value");

  if (!ticketId) {
    redirectWithError("Ticket id is required.", undefined, undefined, undefined, returnPath);
  }

  if (
    !TIP_TYPE_VALUES.includes(
      tipType as (typeof TIP_TYPE_VALUES)[number],
    )
  ) {
    redirectWithError("Tip Type is required.", undefined, undefined, undefined, returnPath);
  }

  if (!Number.isFinite(tipValue) || tipValue < 0) {
    redirectWithError("Tip cannot be negative.", undefined, undefined, undefined, returnPath);
  }

  if (tipType === "percentage" && tipValue > 100) {
    redirectWithError("Percentage Tip must be between 0 and 100.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, organization_id, status")
    .eq("id", ticketId)
    .eq("organization_id", context.currentOrganization?.id)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      status: string;
    }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", undefined, undefined, undefined, returnPath);
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({
      tip_type: tipType,
      tip_value: tipValue,
    })
    .eq("id", ticketId)
    .eq("organization_id", ticket.organization_id)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket tip failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function closePosTicket(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);

  if (!ticketId) {
    redirectWithError("Ticket id is required.");
  }

  const { supabase, context, organization, salon, user } =
    await requirePosTicketMutationContext(ticketId);

  await validateCheckoutTicket(ticketId, returnPath);

  const { error } = await supabase
    .from("pos_tickets")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", ticketId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase close POS ticket failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithCheckoutError(error.message, ticketId, returnPath);
  }

  try {
    await writePosTicketAuditLog({
      action: "ticket_checked_out",
      note: "Ticket checked out.",
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      ticketId,
      userId: user.id,
    });
  } catch (auditError) {
    const message =
      auditError instanceof Error ? auditError.message : "Unable to write audit log.";
    console.error("Supabase POS ticket checkout audit log failed", {
      message,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithCheckoutError(message, ticketId, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function cancelPosTicket(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);
  const note = readRequiredNote(formData, returnPath);

  if (!ticketId) {
    redirectWithError("Ticket id is required.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, organization, salon, user } =
    await requirePosTicketMutationContext(ticketId);

  await validateOpenTicketRelationship(ticketId, ticketId);

  const { error } = await supabase
    .from("pos_tickets")
    .update({ status: "cancelled" })
    .eq("id", ticketId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase cancel POS ticket failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, ticketId);
  }

  try {
    await writePosTicketAuditLog({
      action: "ticket_cancelled",
      note,
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      ticketId,
      userId: user.id,
    });
  } catch (auditError) {
    const message =
      auditError instanceof Error ? auditError.message : "Unable to write audit log.";
    console.error("Supabase POS ticket cancel audit log failed", {
      message,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function voidPosTicket(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);
  const note = readRequiredNote(formData, returnPath);

  if (!ticketId) {
    redirectWithError("Ticket id is required.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, organization, salon, user } =
    await requirePosTicketVoidContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, status")
    .eq("id", ticketId)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; status: string }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "closed") {
    redirectWithError("Only Closed tickets can be voided.", undefined, undefined, undefined, returnPath);
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({ status: "voided" })
    .eq("id", ticketId)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase void POS ticket failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  try {
    await writePosTicketAuditLog({
      action: "ticket_voided",
      note,
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      ticketId,
      userId: user.id,
    });
  } catch (auditError) {
    const message =
      auditError instanceof Error ? auditError.message : "Unable to write audit log.";
    console.error("Supabase POS ticket void audit log failed", {
      message,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function reopenPosTicket(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);
  const note = readRequiredNote(formData, returnPath);

  if (!ticketId) {
    redirectWithError("Ticket id is required.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, organization, salon, user } =
    await requirePosTicketVoidContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, status")
    .eq("id", ticketId)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; status: string }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "closed") {
    redirectWithError("Only Closed tickets can be reopened.", undefined, undefined, undefined, returnPath);
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({ status: "open", closed_at: null })
    .eq("id", ticketId)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase reopen POS ticket failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  try {
    await writePosTicketAuditLog({
      action: "ticket_reopened",
      note,
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      ticketId,
      userId: user.id,
    });
  } catch (auditError) {
    const message =
      auditError instanceof Error ? auditError.message : "Unable to write audit log.";
    console.error("Supabase POS ticket reopen audit log failed", {
      message,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function addPosTicketItem(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const serviceId = readRequiredString(formData, "service_id");
  const returnPath = readReturnPath(formData);

  if (!ticketId) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (!serviceId) {
    redirectWithError("Service is required.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, organization, salon, user } =
    await requirePosTicketMutationContext();

  await validateOpenTicketRelationship(ticketId, undefined, returnPath);
  await validateServiceRelationship(serviceId);

  const { error } = await supabase
    .from("pos_ticket_items")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      pos_ticket_id: ticketId,
      service_id: serviceId,
    })
    .select(POS_TICKET_ITEM_SELECT)
    .single();

  if (error) {
    console.error("Supabase create POS ticket item failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      serviceId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function correctClosedPosTicket(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const itemId = readRequiredString(formData, "item_id");
  const returnPath = readReturnPath(formData);
  const reason = readRequiredString(formData, "correction_reason");
  const serviceId = readOptionalString(formData, "service_id");
  const assignedStaffId = readOptionalString(formData, "assigned_staff_id");
  const quantity = readNumber(formData, "quantity");
  const unitPrice = readNumber(formData, "unit_price");
  const removeItem = formData.get("remove_item") === "on";

  if (!ticketId) {
    redirectWithError("Ticket id is required.", ticketId, itemId, undefined, returnPath);
  }

  if (!itemId) {
    redirectWithError("Ticket item id is required.", ticketId, itemId, undefined, returnPath);
  }

  if (!reason) {
    redirectWithError("Correction reason is required.", ticketId, itemId, undefined, returnPath);
  }

  if (!removeItem && (!Number.isFinite(quantity) || quantity <= 0)) {
    redirectWithError("Quantity must be greater than 0.", ticketId, itemId, undefined, returnPath);
  }

  if (!removeItem && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
    redirectWithError("Unit Price must be greater than or equal to 0.", ticketId, itemId, undefined, returnPath);
  }

  const { supabase, organization, salon, user } =
    await requireClosedTicketCorrectionContext(ticketId);

  try {
    const { data: item, error: itemError } = await supabase
      .from("pos_ticket_items")
      .select("id, organization_id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, is_removed, created_at")
      .eq("id", itemId)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .eq("pos_ticket_id", ticketId)
      .maybeSingle<{
        assigned_staff_id: string | null;
        created_at: string;
        id: string;
        is_removed: boolean;
        line_total: number;
        notes: string | null;
        organization_id: string;
        pos_ticket_id: string;
        quantity: number;
        salon_id: string;
        service_id: string | null;
        unit_price: number;
      }>();

    if (itemError) {
      throw itemError;
    }

    if (!item || item.is_removed) {
      throw new Error("Active ticket item is required.");
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("pos_tickets")
      .select("id, organization_id, salon_id, opened_at, status")
      .eq("id", ticketId)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .maybeSingle<{
        id: string;
        opened_at: string;
        organization_id: string;
        salon_id: string;
        status: string;
      }>();

    if (ticketError) {
      throw ticketError;
    }

    if (!ticket) {
      throw new Error("POS Ticket is required.");
    }

    if (ticket.status !== "closed") {
      throw new Error("Only closed tickets can be corrected with this action.");
    }

    if (serviceId) {
      const { data: service, error: serviceError } = await supabase
        .from("services")
        .select("id")
        .eq("id", serviceId)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id)
        .maybeSingle<{ id: string }>();

      if (serviceError) {
        throw serviceError;
      }

      if (!service) {
        throw new Error("Service must belong to the current salon.");
      }
    }

    if (assignedStaffId) {
      const { data: staff, error: staffError } = await supabase
        .from("staff")
        .select("id")
        .eq("id", assignedStaffId)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id)
        .maybeSingle<{ id: string }>();

      if (staffError) {
        throw staffError;
      }

      if (!staff) {
        throw new Error("Assigned Staff must belong to the current salon.");
      }
    }

    const workDate = formatDateInTimeZone(ticket.opened_at, user.timezone);
    await assertWorkDateIsUnlocked({
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      workDate,
    });

    const beforeSnapshot = await loadClosedCorrectionSnapshot({
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      ticketId,
    });

    let action: "item_corrected" | "item_removed" | "item_replaced" = "item_corrected";
    let replacementItemId: string | null = null;
    const serviceChanged = serviceId !== item.service_id;

    if (removeItem || serviceChanged) {
      action = removeItem ? "item_removed" : "item_replaced";
      const { error: removeError } = await supabase
        .from("pos_ticket_items")
        .update({
          is_removed: true,
          removal_reason: reason,
          removed_at: new Date().toISOString(),
          removed_by: user.id,
        })
        .eq("id", item.id)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id);

      if (removeError) {
        throw removeError;
      }

      await rebuildCorrectionTurnParts({
        itemId: item.id,
        organizationId: organization.id,
        parts: [],
        salonId: salon.id,
        staffId: null,
        supabase,
        ticketId,
        workDate,
      });

      if (!removeItem) {
        const { data: replacement, error: replacementError } = await supabase
          .from("pos_ticket_items")
          .insert({
            assigned_staff_id: assignedStaffId,
            notes: item.notes,
            organization_id: organization.id,
            pos_ticket_id: ticketId,
            quantity,
            salon_id: salon.id,
            service_id: serviceId,
            unit_price: unitPrice,
          })
          .select("id")
          .single<{ id: string }>();

        if (replacementError) {
          throw replacementError;
        }

        replacementItemId = replacement.id;
        await rebuildCorrectionTurnParts({
          itemId: replacement.id,
          organizationId: organization.id,
          parts: Array.from({ length: Math.max(1, Math.round(quantity)) }, () => unitPrice),
          salonId: salon.id,
          staffId: assignedStaffId,
          supabase,
          ticketId,
          workDate,
        });
      }
    } else {
      const { error: updateError } = await supabase
        .from("pos_ticket_items")
        .update({
          assigned_staff_id: assignedStaffId,
          quantity,
          unit_price: unitPrice,
        })
        .eq("id", item.id)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id);

      if (updateError) {
        throw updateError;
      }

      await rebuildCorrectionTurnParts({
        itemId: item.id,
        organizationId: organization.id,
        parts: Array.from({ length: Math.max(1, Math.round(quantity)) }, () => unitPrice),
        salonId: salon.id,
        staffId: assignedStaffId,
        supabase,
        ticketId,
        workDate,
      });
    }

    await recalculateStaffEarningsForDate(salon.id, workDate);

    const afterSnapshot = await loadClosedCorrectionSnapshot({
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      ticketId,
    });

    const { error: adjustmentError } = await supabase
      .from("pos_ticket_adjustments")
      .insert({
        action,
        after_snapshot: afterSnapshot,
        before_snapshot: beforeSnapshot,
        created_by: user.id,
        organization_id: organization.id,
        reason,
        replacement_ticket_item_id: replacementItemId,
        salon_id: salon.id,
        ticket_id: ticketId,
        ticket_item_id: item.id,
      });

    if (adjustmentError) {
      throw adjustmentError;
    }
  } catch (error) {
    const message = getSafeErrorMessage(
      error,
      "Unable to correct closed ticket.",
    );
    console.error("Supabase correct closed POS ticket failed", {
      message,
      itemId,
      salonId: salon.id,
      ticketId,
      userId: user.id,
    });
    redirectWithError(message, ticketId, itemId, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath("/staff/today");
  revalidatePath("/staff/my-work");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function correctClosedPosTicketInline(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);
  const reason = readRequiredString(formData, "correction_reason");

  if (!ticketId) {
    redirectWithError("Ticket id is required.", undefined, undefined, undefined, returnPath);
  }

  if (!reason) {
    redirectWithError("Correction reason is required.", ticketId, undefined, undefined, returnPath);
  }

  const { supabase, organization, salon, user } =
    await requireClosedTicketCorrectionContext(ticketId);

  try {
    const itemUpdates = readJsonArray<ClosedTicketItemUpdateInput>(
      formData,
      "item_updates",
    );
    const itemParts = readJsonArray<ClosedTicketItemPartsInput>(
      formData,
      "item_parts",
    );
    const addedItems = readJsonArray<ClosedTicketAddedItemInput>(
      formData,
      "added_items",
    );
    const staffTipOverrides = readJsonArray<ClosedTicketStaffTipOverrideInput>(
      formData,
      "staff_tip_overrides",
    );
    const tipTotal = readNumber(formData, "tip_total");

    if (!Number.isFinite(tipTotal) || tipTotal < 0) {
      throw new Error("Total tip must be zero or greater.");
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("pos_tickets")
      .select("id, organization_id, salon_id, opened_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value")
      .eq("id", ticketId)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .maybeSingle<{
        discount_type: "fixed_amount" | "percentage";
        discount_value: number;
        id: string;
        opened_at: string;
        organization_id: string;
        salon_id: string;
        status: string;
        tax_rate: number;
        tip_type: "fixed_amount" | "percentage";
        tip_value: number;
      }>();

    if (ticketError) {
      throw ticketError;
    }

    if (!ticket) {
      throw new Error("POS Ticket is required.");
    }

    if (ticket.status !== "closed") {
      throw new Error("Only closed tickets can be corrected with this action.");
    }

    const workDate = formatDateInTimeZone(ticket.opened_at, user.timezone);
    await assertWorkDateIsUnlocked({
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      workDate,
    });

    const { data: currentItems, error: itemsError } = await supabase
      .from("pos_ticket_items")
      .select("id, organization_id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, is_removed, created_at")
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .eq("pos_ticket_id", ticketId)
      .eq("is_removed", false)
      .returns<
        Array<{
          assigned_staff_id: string | null;
          created_at: string;
          id: string;
          is_removed: boolean;
          line_total: number;
          notes: string | null;
          organization_id: string;
          pos_ticket_id: string;
          quantity: number;
          salon_id: string;
          service_id: string | null;
          unit_price: number;
        }>
      >();

    if (itemsError) {
      throw itemsError;
    }

    const currentItemIds = (currentItems ?? []).map((item) => item.id);
    const currentPartsByItemId = new Map<string, number[]>();

    if (currentItemIds.length > 0) {
      const { data: currentParts, error: currentPartsError } = await supabase
        .from("pos_ticket_item_turn_parts")
        .select("ticket_item_id, amount, turn_index, created_at, id")
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id)
        .in("ticket_item_id", currentItemIds)
        .returns<
          Array<{
            amount: number;
            created_at: string;
            id: string;
            ticket_item_id: string;
            turn_index: number;
          }>
        >();

      if (currentPartsError) {
        throw currentPartsError;
      }

      for (const part of [...(currentParts ?? [])].sort(
        (left, right) =>
          left.turn_index - right.turn_index ||
          new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
          left.id.localeCompare(right.id),
      )) {
        currentPartsByItemId.set(part.ticket_item_id, [
          ...(currentPartsByItemId.get(part.ticket_item_id) ?? []),
          part.amount,
        ]);
      }
    }

    const currentItemById = new Map((currentItems ?? []).map((item) => [item.id, item]));
    const updateIds = new Set<string>();
    const submittedItemPartsById = new Map<string, number[]>();
    const submittedItemPartIds = new Set<string>();
    const normalizedUpdateParts = new Map<string, number[]>();
    const normalizedAddedParts = new Map<number, number[]>();

    for (const itemPart of itemParts) {
      if (!itemPart.item_id || submittedItemPartIds.has(itemPart.item_id)) {
        throw new Error("Each active line must include one unique parts payload.");
      }

      if (!currentItemById.has(itemPart.item_id)) {
        throw new Error("Submitted line parts must belong to the selected ticket.");
      }

      const parts = normalizePartsInput(itemPart.parts);
      validatePositiveParts(parts, "Active line");
      submittedItemPartsById.set(itemPart.item_id, parts);
      submittedItemPartIds.add(itemPart.item_id);
    }

    for (const update of itemUpdates) {
      if (!update.item_id || updateIds.has(update.item_id)) {
        throw new Error("Each correction line must reference a unique item.");
      }

      if (!currentItemById.has(update.item_id)) {
        throw new Error("Corrected item must belong to the selected ticket.");
      }

      updateIds.add(update.item_id);

      if (!update.remove) {
        const parts =
          normalizePartsInput(update.parts).length > 0
            ? normalizePartsInput(update.parts)
            : submittedItemPartsById.get(update.item_id) ?? [];
        normalizedUpdateParts.set(update.item_id, parts);

        if (!update.service_id || !update.staff_id) {
          throw new Error("Active lines require staff and service.");
        }

        validatePositiveParts(parts, "Corrected line");
      }
    }

    for (const [index, addedItem] of addedItems.entries()) {
      const parts = normalizePartsInput(addedItem.parts);
      normalizedAddedParts.set(index, parts);

      if (!addedItem.service_id || !addedItem.staff_id) {
        throw new Error("Active lines require staff and service.");
      }

      validatePositiveParts(parts, "Added line");
    }

    const serviceIds = Array.from(
      new Set([
        ...itemUpdates
          .filter((update) => !update.remove && update.service_id)
          .map((update) => update.service_id as string),
        ...addedItems.map((item) => item.service_id),
      ]),
    );
    const staffIds = Array.from(
      new Set([
        ...itemUpdates
          .filter((update) => !update.remove && update.staff_id)
          .map((update) => update.staff_id as string),
        ...addedItems.map((item) => item.staff_id),
        ...staffTipOverrides.map((override) => override.staff_id),
      ]),
    );

    if (serviceIds.length > 0) {
      const { data: serviceRows, error: serviceError } = await supabase
        .from("services")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id)
        .in("id", serviceIds)
        .returns<Array<{ id: string }>>();

      if (serviceError) {
        throw serviceError;
      }

      if ((serviceRows ?? []).length !== serviceIds.length) {
        throw new Error("All corrected services must belong to the current salon.");
      }
    }

    if (staffIds.length > 0) {
      const { data: staffRows, error: staffError } = await supabase
        .from("staff")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id)
        .in("id", staffIds)
        .returns<Array<{ id: string }>>();

      if (staffError) {
        throw staffError;
      }

      if ((staffRows ?? []).length !== staffIds.length) {
        throw new Error("All corrected staff must belong to the current salon.");
      }
    }

    const finalItems = new Map<
      string,
      { line_total: number; staff_id: string }
    >();

    for (const item of currentItems ?? []) {
      const existingParts =
        submittedItemPartsById.get(item.id) ?? currentPartsByItemId.get(item.id);
      finalItems.set(item.id, {
        line_total: existingParts?.length ? sumParts(existingParts) : item.line_total,
        staff_id: item.assigned_staff_id ?? "",
      });
    }

    for (const update of itemUpdates) {
      if (update.remove) {
        finalItems.delete(update.item_id);
      } else {
        const parts = normalizedUpdateParts.get(update.item_id) ?? [];
        finalItems.set(update.item_id, {
          line_total: sumParts(parts),
          staff_id: update.staff_id ?? "",
        });
      }
    }

    for (const [index, item] of addedItems.entries()) {
      const parts = normalizedAddedParts.get(index) ?? [];
      finalItems.set(`added-${index}`, {
        line_total: sumParts(parts),
        staff_id: item.staff_id,
      });
    }

    const finalStaffIdsWithRepeats = Array.from(finalItems.values())
      .map((item) => item.staff_id)
      .filter(Boolean);
    const duplicateStaffId = finalStaffIdsWithRepeats.find(
      (staffId, index) => finalStaffIdsWithRepeats.indexOf(staffId) !== index,
    );

    if (duplicateStaffId) {
      throw new Error("Each staff member can appear only once on a ticket.");
    }

    const finalStaffIds = Array.from(
      new Set(finalStaffIdsWithRepeats),
    );
    const finalStaffIdSet = new Set(finalStaffIds);
    const manualOverrides = staffTipOverrides.filter((override) => override.is_manual);
    const manualOverrideStaffIds = new Set(
      manualOverrides.map((override) => override.staff_id),
    );
    const overrideStaffIds = new Set<string>();

    for (const override of staffTipOverrides) {
      if (!override.staff_id || overrideStaffIds.has(override.staff_id)) {
        throw new Error("Each staff tip override must reference one unique staff member.");
      }

      overrideStaffIds.add(override.staff_id);

      if (!finalStaffIdSet.has(override.staff_id)) {
        throw new Error("Staff tip overrides must belong to staff with active ticket services.");
      }

      if (!Number.isFinite(override.tip_amount) || override.tip_amount < 0) {
        throw new Error("Staff tip amounts must be zero or greater.");
      }
    }

    const manualTipCents = manualOverrides.reduce(
      (total, override) => total + toCents(override.tip_amount),
      0,
    );
    const tipTotalCents = toCents(tipTotal);

    if (!Number.isFinite(tipTotalCents)) {
      throw new Error("Total tip must be zero or greater.");
    }

    if (manualTipCents > tipTotalCents) {
      throw new Error("Manual staff tips cannot exceed total tip.");
    }

    if (
      finalStaffIds.length > 0 &&
      manualOverrides.length === finalStaffIds.length &&
      manualTipCents !== tipTotalCents
    ) {
      throw new Error("Manual staff tips must equal total tip when all staff tips are manual.");
    }

    const currentTotals = calculateTicketTotals({
      discountType: ticket.discount_type,
      discountValue: ticket.discount_value,
      items: (currentItems ?? []).map((item) => {
        const existingParts =
          submittedItemPartsById.get(item.id) ?? currentPartsByItemId.get(item.id);

        return {
          line_total: existingParts?.length ? sumParts(existingParts) : item.line_total,
        };
      }),
      taxRate: ticket.tax_rate,
      tipType: ticket.tip_type,
      tipValue: ticket.tip_value,
    });
    const hasTipChange = toCents(currentTotals.tip_amount) !== tipTotalCents;
    const hasManualTipChange = staffTipOverrides.length > 0;

    if (itemUpdates.length === 0 && addedItems.length === 0 && !hasTipChange && !hasManualTipChange) {
      throw new Error("Make at least one correction before saving.");
    }

    const beforeSnapshot = await loadClosedCorrectionSnapshot({
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      ticketId,
    });
    const now = new Date().toISOString();
    const replacementItemIds: string[] = [];
    const shouldRefreshUnchangedParts = hasTipChange || hasManualTipChange;

    for (const update of itemUpdates) {
      const currentItem = currentItemById.get(update.item_id);

      if (!currentItem) {
        continue;
      }

      const serviceChanged = update.service_id !== currentItem.service_id;

      if (serviceChanged && !update.remove) {
        const parts = normalizedUpdateParts.get(update.item_id) ?? [];
        const lineTotal = sumParts(parts);
        const { data: replacement, error: replacementError } = await supabase
          .from("pos_ticket_items")
          .insert({
            assigned_staff_id: update.staff_id,
            notes: currentItem.notes,
            organization_id: organization.id,
            pos_ticket_id: ticketId,
            quantity: 1,
            salon_id: salon.id,
            service_id: update.service_id,
            unit_price: lineTotal,
          })
          .select("id")
          .single<{ id: string }>();

        if (replacementError) {
          throw replacementError;
        }

        await rebuildCorrectionTurnParts({
          itemId: replacement.id,
          organizationId: organization.id,
          parts,
          salonId: salon.id,
          staffId: update.staff_id,
          supabase,
          ticketId,
          workDate,
        });

        const { error: removeError } = await supabase
          .from("pos_ticket_items")
          .update({
            is_removed: true,
            removal_reason: reason,
            removed_at: now,
            removed_by: user.id,
          })
          .eq("id", currentItem.id)
          .eq("organization_id", organization.id)
          .eq("salon_id", salon.id);

        if (removeError) {
          throw removeError;
        }

        await rebuildCorrectionTurnParts({
          itemId: currentItem.id,
          organizationId: organization.id,
          parts: [],
          salonId: salon.id,
          staffId: null,
          supabase,
          ticketId,
          workDate,
        });

        replacementItemIds.push(replacement.id);
      } else if (update.remove) {
        const { error: removeError } = await supabase
          .from("pos_ticket_items")
          .update({
            is_removed: true,
            removal_reason: reason,
            removed_at: now,
            removed_by: user.id,
          })
          .eq("id", currentItem.id)
          .eq("organization_id", organization.id)
          .eq("salon_id", salon.id);

        if (removeError) {
          throw removeError;
        }

        await rebuildCorrectionTurnParts({
          itemId: currentItem.id,
          organizationId: organization.id,
          parts: [],
          salonId: salon.id,
          staffId: null,
          supabase,
          ticketId,
          workDate,
        });
      } else {
        const parts = normalizedUpdateParts.get(update.item_id) ?? [];
        const lineTotal = sumParts(parts);
        const { error: updateError } = await supabase
          .from("pos_ticket_items")
          .update({
            assigned_staff_id: update.staff_id,
            quantity: 1,
            unit_price: lineTotal,
          })
          .eq("id", currentItem.id)
          .eq("organization_id", organization.id)
          .eq("salon_id", salon.id);

        if (updateError) {
          throw updateError;
        }

        await rebuildCorrectionTurnParts({
          itemId: currentItem.id,
          organizationId: organization.id,
          parts,
          salonId: salon.id,
          staffId: update.staff_id,
          supabase,
          ticketId,
          workDate,
        });
      }
    }

    if (shouldRefreshUnchangedParts) {
      for (const currentItem of currentItems ?? []) {
        if (updateIds.has(currentItem.id)) {
          continue;
        }

        const parts = submittedItemPartsById.get(currentItem.id);

        if (!parts) {
          continue;
        }

        const lineTotal = sumParts(parts);
        const { error: unchangedUpdateError } = await supabase
          .from("pos_ticket_items")
          .update({
            quantity: 1,
            unit_price: lineTotal,
          })
          .eq("id", currentItem.id)
          .eq("organization_id", organization.id)
          .eq("salon_id", salon.id);

        if (unchangedUpdateError) {
          throw unchangedUpdateError;
        }

        await rebuildCorrectionTurnParts({
          itemId: currentItem.id,
          organizationId: organization.id,
          parts,
          salonId: salon.id,
          staffId: currentItem.assigned_staff_id,
          supabase,
          ticketId,
          workDate,
        });
      }
    }

    for (const [index, addedItem] of addedItems.entries()) {
      const parts = normalizedAddedParts.get(index) ?? [];
      const lineTotal = sumParts(parts);
      const { data: insertedItem, error: insertError } = await supabase
        .from("pos_ticket_items")
        .insert({
          assigned_staff_id: addedItem.staff_id,
          organization_id: organization.id,
          pos_ticket_id: ticketId,
          quantity: 1,
          salon_id: salon.id,
          service_id: addedItem.service_id,
          unit_price: lineTotal,
        })
        .select("id")
        .single<{ id: string }>();

      if (insertError) {
        throw insertError;
      }

      replacementItemIds.push(insertedItem.id);
      await rebuildCorrectionTurnParts({
        itemId: insertedItem.id,
        organizationId: organization.id,
        parts,
        salonId: salon.id,
        staffId: addedItem.staff_id,
        supabase,
        ticketId,
        workDate,
      });
    }

    const { error: tipError } = await supabase
      .from("pos_tickets")
      .update({
        tip_type: "fixed_amount",
        tip_value: tipTotal,
      })
      .eq("id", ticketId)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id);

    if (tipError) {
      throw tipError;
    }

    if (hasTipChange) {
      const autoStaffIds = finalStaffIds.filter(
        (staffId) => !manualOverrideStaffIds.has(staffId),
      );

      if (autoStaffIds.length > 0) {
        const { error: clearAutoTipsError } = await supabase
          .from("pos_ticket_staff_earnings")
          .update({
            manual_tip_amount: null,
            tip_is_manual: false,
          })
          .eq("organization_id", organization.id)
          .eq("salon_id", salon.id)
          .eq("ticket_id", ticketId)
          .in("staff_id", autoStaffIds);

        if (clearAutoTipsError) {
          throw clearAutoTipsError;
        }
      }
    }

    for (const override of staffTipOverrides) {
      if (override.is_manual) {
        const manualTipAmount = fromCents(toCents(override.tip_amount));
        const { error: manualTipError } = await supabase
          .from("pos_ticket_staff_earnings")
          .upsert(
            {
              big_turn_count: 0,
              bonus_amount: 0,
              calculation_version: 1,
              commission_amount: 0,
              deduction_amount: 0,
              first_big_turn_sequence: null,
              first_small_turn_sequence: null,
              last_big_turn_sequence: null,
              last_small_turn_sequence: null,
              manual_tip_amount: manualTipAmount,
              organization_id: organization.id,
              salon_id: salon.id,
              service_total: 0,
              small_turn_count: 0,
              staff_id: override.staff_id,
              ticket_id: ticketId,
              tip_amount: manualTipAmount,
              tip_is_manual: true,
              total_earning: manualTipAmount,
              work_date: workDate,
            },
            { onConflict: "ticket_id,staff_id" },
          );

        if (manualTipError) {
          throw manualTipError;
        }
      } else {
        const { error: clearManualError } = await supabase
          .from("pos_ticket_staff_earnings")
          .update({
            manual_tip_amount: null,
            tip_is_manual: false,
          })
          .eq("organization_id", organization.id)
          .eq("salon_id", salon.id)
          .eq("ticket_id", ticketId)
          .eq("staff_id", override.staff_id);

        if (clearManualError) {
          throw clearManualError;
        }
      }
    }

    await recalculateStaffEarningsForDate(salon.id, workDate);

    const afterSnapshot = await loadClosedCorrectionSnapshot({
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
      ticketId,
    });

    const { error: adjustmentError } = await supabase
      .from("pos_ticket_adjustments")
      .insert({
        action: "item_corrected",
        after_snapshot: afterSnapshot,
        before_snapshot: beforeSnapshot,
        created_by: user.id,
        organization_id: organization.id,
        reason,
        replacement_ticket_item_id: replacementItemIds[0] ?? null,
        salon_id: salon.id,
        ticket_id: ticketId,
        ticket_item_id: itemUpdates[0]?.item_id ?? null,
      });

    if (adjustmentError) {
      throw adjustmentError;
    }
  } catch (error) {
    const message = getSafeErrorMessage(
      error,
      "Unable to correct closed ticket.",
    );
    console.error("Supabase inline correct closed POS ticket failed", {
      message,
      salonId: salon.id,
      ticketId,
      userId: user.id,
    });
    redirectWithError(message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath("/staff/today");
  revalidatePath("/staff/my-work");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function updatePosTicketItem(formData: FormData) {
  const itemId = readRequiredString(formData, "item_id");
  const returnPath = readReturnPath(formData);

  if (!itemId) {
    redirectWithError("Ticket item id is required.", undefined, undefined, undefined, returnPath);
  }

  const quantity = readNumber(formData, "quantity");
  const unitPrice = readNumber(formData, "unit_price");

  if (!Number.isFinite(quantity) || quantity <= 0) {
    redirectWithError("Quantity must be greater than 0.", undefined, itemId, undefined, returnPath);
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    redirectWithError(
      "Unit Price must be greater than or equal to 0.",
      undefined,
      itemId,
      undefined,
      returnPath,
    );
  }

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext(undefined);
  const notes = readOptionalString(formData, "notes");

  await validateOpenTicketItemRelationship(itemId, returnPath);

  const { error } = await supabase
    .from("pos_ticket_items")
    .update({
      quantity,
      unit_price: unitPrice,
      notes,
    })
    .eq("id", itemId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket item failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      itemId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, itemId, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function updatePosTicketItemStaff(formData: FormData) {
  const itemId = readRequiredString(formData, "item_id");
  const returnPath = readReturnPath(formData);

  if (!itemId) {
    redirectWithError("Ticket item id is required.", undefined, undefined, undefined, returnPath);
  }

  const assignedStaffId = readOptionalString(formData, "assigned_staff_id");
  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext();

  await validateOpenTicketItemRelationship(itemId, returnPath);

  if (assignedStaffId) {
    await validateStaffRelationship(assignedStaffId, itemId);
  }

  const { error } = await supabase
    .from("pos_ticket_items")
    .update({ assigned_staff_id: assignedStaffId })
    .eq("id", itemId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket item assigned staff failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      itemId,
      assignedStaffId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, itemId);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function deletePosTicketItem(formData: FormData) {
  const itemId = readRequiredString(formData, "item_id");
  const returnPath = readReturnPath(formData);

  if (!itemId) {
    redirectWithError("Ticket item id is required.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext();

  await validateOpenTicketItemRelationship(itemId);

  const { error } = await supabase
    .from("pos_ticket_items")
    .delete()
    .eq("id", itemId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase delete POS ticket item failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      itemId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function addPosPayment(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const amount = readNumber(formData, "amount");
  const paymentMethod = readRequiredString(formData, "payment_method");
  const returnPath = readReturnPath(formData);

  if (!ticketId) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    redirectWithError("Amount must be greater than 0.", undefined, undefined, ticketId, returnPath);
  }

  if (
    !PAYMENT_METHOD_VALUES.includes(
      paymentMethod as (typeof PAYMENT_METHOD_VALUES)[number],
    )
  ) {
    redirectWithError("Payment Method is required.", undefined, undefined, ticketId, returnPath);
  }

  const { supabase, context, organization, salon, user } =
    await requirePosTicketMutationContext();
  const note = readOptionalString(formData, "note");

  await validateOpenPaymentTicket(ticketId, amount, returnPath);

  const { error } = await supabase
    .from("pos_payments")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      ticket_id: ticketId,
      payment_method: paymentMethod,
      amount,
      note,
      created_by: user.id,
    })
    .select(POS_PAYMENT_SELECT)
    .single();

  if (error) {
    console.error("Supabase create POS payment failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, ticketId, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}

export async function deletePosPayment(formData: FormData) {
  const paymentId = readRequiredString(formData, "payment_id");
  const returnPath = readReturnPath(formData);

  if (!paymentId) {
    redirectWithError("Payment id is required.", undefined, undefined, undefined, returnPath);
  }

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext();
  const payment = await validatePaymentRelationship(paymentId, returnPath);

  const { error } = await supabase
    .from("pos_payments")
    .delete()
    .eq("id", paymentId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase delete POS payment failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      paymentId,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, payment.ticket_id, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}
