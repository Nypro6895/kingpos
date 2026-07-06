"use server";

import {
  POS_TICKET_ITEM_SELECT,
  POS_TICKET_PERMISSIONS,
} from "@/lib/pos-tickets";
import { getCurrentBusinessContext } from "@/lib/current-context";
import {
  POS_PAYMENT_METHOD_OPTIONS,
  POS_PAYMENT_SELECT,
} from "@/lib/pos-payments";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { requirePermission } from "@/lib/permissions";
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

function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
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
