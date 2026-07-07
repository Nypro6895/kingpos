"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { POS_DESK_DEFAULTS } from "@/lib/pos-desk";
import { getTurnType, parsePosAmountInput } from "@/lib/pos-desk-amounts";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { buildTicketReceipt } from "@/lib/pos-ticket-receipt";
import { recalculateStaffEarningsForDate } from "@/lib/pos-ticket-staff-earnings";
import { POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { getTodayDate } from "@/lib/staff-workdays";
import type {
  PosDeskCustomer,
  PosDisplayChannelView,
  PosDisplayCustomerMessage,
  PosDisplayReceiptPayload,
  PosDeskSessionLine,
  PosDeskSessionLineInput,
  PosDeskSessionView,
  PosDeskSubmitInput,
  PosDeskSubmitLine,
  PosLiveDraftCustomer,
  PosLiveDraftReceiptLine,
  PosLiveDraftView,
} from "@/types/pos-desk";
import type { PosPayment } from "@/types/pos-payment";
import type { PosTicket } from "@/types/pos-ticket";
import type { PosTicketItemWithRelations } from "@/types/pos-ticket-item";

type ActionResult<T> =
  | { data: T; error?: never; ok: true }
  | { data?: never; error: string; ok: false };

type PosDeskActionResult =
  | { error: string; ok: false; ticketId?: never; ticketNumber?: never }
  | { error?: never; ok: true; ticketId: string; ticketNumber: string };

const SESSION_SELECT = `
  id,
  organization_id,
  salon_id,
  customer_id,
  customer_display_token,
  status,
  customer_lookup_value,
  customer_name_snapshot,
  note,
  tip_amount,
  customer_confirmed_at,
  last_activity_at,
  expires_at,
  submitted_ticket_id,
  created_by,
  created_at,
  updated_at
`;

const SESSION_LINE_SELECT = `
  id,
  staff_id,
  service_id,
  service_label,
  amount,
  amount_input,
  amount_parts,
  turn_large_count,
  turn_small_count,
  sort_order
`;

type RawSessionLine = {
  amount: number;
  amount_input: string;
  amount_parts: number[] | unknown;
  id: string;
  service_id: string | null;
  service_label: string;
  sort_order: number;
  staff_id: string;
  turn_large_count: number;
  turn_small_count: number;
};

type RawSession = {
  customer_confirmed_at: string | null;
  customer_display_token: string;
  customer_id: string | null;
  customer_lookup_value: string | null;
  customer_name_snapshot: string | null;
  expires_at: string;
  id: string;
  note: string | null;
  salon_id: string;
  status: PosDeskSessionView["status"];
  submitted_ticket_id: string | null;
  tip_amount: number;
  updated_at: string;
};

type RawDisplayChannel = {
  customer_message: PosDisplayCustomerMessage | null;
  customer_message_version: number;
  id: string;
  pos_message: PosDisplayReceiptPayload | null;
  pos_message_version: number;
  salon_id: string;
  status: PosDisplayChannelView["status"];
  token: string;
  updated_at: string;
};

type RawLiveDraft = {
  customer: PosLiveDraftCustomer | null;
  id: string;
  selected_staff_id: string | null;
  salon_id: string;
  staff_lines: PosLiveDraftReceiptLine[] | null;
  status: PosLiveDraftView["status"];
  subtotal: number;
  tip: number;
  token: string;
  total: number;
  updated_at: string;
  version: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cleanOptional(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeAmountParts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((part) => Number(part)).filter((part) => Number.isFinite(part));
}

function toSessionView(
  raw: RawSession,
  lines: PosDeskSessionLine[],
  salonName?: string | null,
): PosDeskSessionView {
  return {
    customer_confirmed_at: raw.customer_confirmed_at,
    customer_display_token: raw.customer_display_token,
    customer_id: raw.customer_id,
    customer_lookup_value: raw.customer_lookup_value,
    customer_name_snapshot: raw.customer_name_snapshot,
    expires_at: raw.expires_at,
    id: raw.id,
    lines,
    note: raw.note,
    salon_id: raw.salon_id,
    salon_name: salonName ?? null,
    status: raw.status,
    submitted_ticket_id: raw.submitted_ticket_id,
    tip_amount: Number(raw.tip_amount),
    updated_at: raw.updated_at,
  };
}

function toDisplayChannelView(raw: RawDisplayChannel): PosDisplayChannelView {
  return {
    customer_message: raw.customer_message,
    customer_message_version: Number(raw.customer_message_version),
    id: raw.id,
    pos_message: raw.pos_message,
    pos_message_version: Number(raw.pos_message_version),
    salon_id: raw.salon_id,
    status: raw.status,
    token: raw.token,
    updated_at: raw.updated_at,
  };
}

function normalizeLiveDraftStaffLines(
  lines: PosLiveDraftReceiptLine[] | null,
): PosLiveDraftReceiptLine[] {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines
    .map((line, index) => ({
      amount: roundMoney(Number(line.amount) || 0),
      amountInput: line.amountInput ?? String(Number(line.amount) || ""),
      amountParts: Array.isArray(line.amountParts)
        ? line.amountParts.map((part) => Number(part)).filter(Number.isFinite)
        : [],
      id: line.id || `line-${index + 1}`,
      label: line.label || `Service ${index + 1}`,
      serviceId: line.serviceId ?? null,
      sortOrder: Number(line.sortOrder ?? index + 1),
      staffId: line.staffId,
      staffName: line.staffName || "Assigned staff",
    }))
    .filter((line) => Boolean(line.staffId));
}

function toLiveDraftView(raw: RawLiveDraft): PosLiveDraftView {
  return {
    customer: raw.customer,
    id: raw.id,
    selected_staff_id: raw.selected_staff_id,
    salon_id: raw.salon_id,
    staff_lines: normalizeLiveDraftStaffLines(raw.staff_lines),
    status: raw.status,
    subtotal: Number(raw.subtotal ?? 0),
    tip: Number(raw.tip ?? 0),
    token: raw.token,
    total: Number(raw.total ?? 0),
    updated_at: raw.updated_at,
    version: Number(raw.version),
  };
}

async function requirePosDeskMutationContext() {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!context.currentOrganization) {
    throw new Error("Create an organization before using POS Desk.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  await requirePermission(POS_TICKET_PERMISSIONS.manage, context);

  return {
    context,
    organization: context.currentOrganization,
    salon: context.currentSalon,
    supabase,
    user: context.user,
  };
}

function getCustomerInsertFromLookup(lookup: string | null, name: string | null) {
  const normalizedName = name ?? lookup ?? "Walk-in Customer";
  const isEmail = lookup?.includes("@") ?? false;
  const isPhone = lookup ? /[0-9]/.test(lookup) && !isEmail : false;

  return {
    email: isEmail ? lookup : null,
    name: normalizedName,
    phone: isPhone ? lookup : null,
  };
}

async function findOrCreateDeskCustomer(input: {
  customerId: string | null;
  customerLookup: string | null;
  customerName: string | null;
}) {
  const { organization, salon, supabase } = await requirePosDeskMutationContext();

  if (input.customerId) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone, email")
      .eq("id", input.customerId)
      .eq("location_id", salon.id)
      .maybeSingle<PosDeskCustomer>();

    if (error || !data) {
      throw new Error("Selected customer must belong to the current salon.");
    }

    return data;
  }

  const lookup = cleanOptional(input.customerLookup);

  if (lookup) {
    const escaped = lookup.replaceAll("%", "\\%").replaceAll("_", "\\_");
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone, email")
      .eq("location_id", salon.id)
      .eq("status", "active")
      .or(`phone.eq.${escaped},email.eq.${escaped},name.ilike.${escaped}`)
      .limit(1)
      .maybeSingle<PosDeskCustomer>();

    if (error) {
      throw new Error(error.message);
    }

    if (data) {
      return data;
    }
  }

  const insert = getCustomerInsertFromLookup(lookup, cleanOptional(input.customerName));
  const { data, error } = await supabase
    .from("customers")
    .insert({
      email: insert.email,
      location_id: salon.id,
      name: insert.name,
      notes: "Created from POS Desk quick add.",
      phone: insert.phone,
      status: "active",
    })
    .select("id, name, phone, email")
    .single<PosDeskCustomer>();

  if (error) {
    console.error("Supabase POS desk quick customer create failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      organizationId: organization.id,
      salonId: salon.id,
    });
    throw new Error(error.message);
  }

  return data;
}

async function loadSessionLinesForPos(input: {
  salonId: string;
  sessionId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  const { data, error } = await input.supabase
    .from("pos_desk_session_lines")
    .select(SESSION_LINE_SELECT)
    .eq("session_id", input.sessionId)
    .eq("salon_id", input.salonId)
    .order("sort_order", { ascending: true })
    .returns<RawSessionLine[]>();

  if (error) {
    throw new Error(error.message);
  }

  const rawLines = data ?? [];
  const staffIds = Array.from(new Set(rawLines.map((line) => line.staff_id)));
  const staffNames = new Map<string, string>();

  if (staffIds.length > 0) {
    const { data: staffRows, error: staffError } = await input.supabase
      .from("staff")
      .select("id, display_name")
      .in("id", staffIds)
      .eq("salon_id", input.salonId)
      .returns<Array<{ display_name: string; id: string }>>();

    if (staffError) {
      throw new Error(staffError.message);
    }

    for (const row of staffRows ?? []) {
      staffNames.set(row.id, row.display_name);
    }
  }

  return rawLines
    .map<PosDeskSessionLine>((line) => ({
      amount: Number(line.amount),
      amount_input: line.amount_input,
      amount_parts: normalizeAmountParts(line.amount_parts),
      id: line.id,
      service_id: line.service_id,
      service_label: line.service_label,
      sort_order: line.sort_order,
      staff_id: line.staff_id,
      staff_name: staffNames.get(line.staff_id) ?? null,
      turn_large_count: line.turn_large_count,
      turn_small_count: line.turn_small_count,
    }))
    .sort((left, right) => left.sort_order - right.sort_order);
}

async function loadPosDeskSessionForPos(sessionId: string) {
  const { salon, supabase } = await requirePosDeskMutationContext();

  const { data, error } = await supabase
    .from("pos_desk_sessions")
    .select(SESSION_SELECT)
    .eq("id", sessionId)
    .eq("salon_id", salon.id)
    .maybeSingle<RawSession>();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  if (data.status === "active" && new Date(data.expires_at).getTime() <= Date.now()) {
    const { data: expired, error: expireError } = await supabase
      .from("pos_desk_sessions")
      .update({ status: "expired", last_activity_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("salon_id", salon.id)
      .select(SESSION_SELECT)
      .single<RawSession>();

    if (expireError) {
      throw new Error(expireError.message);
    }

    const expiredLines = await loadSessionLinesForPos({
      salonId: salon.id,
      sessionId: expired.id,
      supabase,
    });

    return toSessionView(expired, expiredLines, salon.name);
  }

  const lines = await loadSessionLinesForPos({
    salonId: salon.id,
    sessionId: data.id,
    supabase,
  });

  return toSessionView(data, lines, salon.name);
}

async function requireActiveSession(sessionId: string) {
  const session = await loadPosDeskSessionForPos(sessionId);

  if (!session) {
    throw new Error("POS session is required.");
  }

  if (session.status !== "active") {
    throw new Error("Only active POS sessions can be edited.");
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new Error("POS session expired. Start a new session.");
  }

  return session;
}

async function requirePendingConfirmedSession(sessionId: string) {
  const session = await loadPosDeskSessionForPos(sessionId);

  if (!session) {
    throw new Error("POS session is required.");
  }

  if (session.status !== "active" && session.status !== "pending_confirmation") {
    throw new Error("Send the receipt to the customer before completing checkout.");
  }

  if (session.lines.length === 0) {
    throw new Error("Send the receipt to the customer before completing checkout.");
  }

  if (!session.customer_confirmed_at) {
    throw new Error("Waiting for customer confirmation.");
  }

  return session;
}

async function touchSession(sessionId: string) {
  const { salon, supabase } = await requirePosDeskMutationContext();
  const now = new Date();
  const { error } = await supabase
    .from("pos_desk_sessions")
    .update({
      expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      last_activity_at: now.toISOString(),
    })
    .eq("id", sessionId)
    .eq("salon_id", salon.id)
    .eq("status", "active");

  if (error) {
    throw new Error(error.message);
  }
}

function validateSubmitLines(lines: PosDeskSubmitLine[]) {
  if (lines.length === 0) {
    throw new Error("Add at least one receipt line before submit.");
  }

  for (const line of lines) {
    if (!line.staffId) {
      throw new Error("Every receipt line needs assigned staff.");
    }

    if (!Number.isFinite(line.total) || line.total <= 0) {
      throw new Error("Every receipt line needs a positive amount.");
    }

    if (line.amountParts.length === 0) {
      throw new Error("Every receipt line needs amount parts.");
    }
  }
}

async function validateSubmitLineScope(input: {
  lines: PosDeskSubmitLine[];
  organizationId: string;
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  const staffIds = Array.from(new Set(input.lines.map((line) => line.staffId)));
  const serviceIds = Array.from(
    new Set(
      input.lines
        .map((line) => cleanOptional(line.serviceId))
        .filter((serviceId): serviceId is string => Boolean(serviceId)),
    ),
  );

  const { data: staffRows, error: staffError } = await input.supabase
    .from("staff")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("salon_id", input.salonId)
    .in("id", staffIds)
    .returns<Array<{ id: string }>>();

  if (staffError) {
    throw new Error(staffError.message);
  }

  if ((staffRows ?? []).length !== staffIds.length) {
    throw new Error("Assigned staff must belong to the current salon.");
  }

  if (serviceIds.length === 0) {
    return;
  }

  const { data: serviceRows, error: serviceError } = await input.supabase
    .from("services")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("salon_id", input.salonId)
    .in("id", serviceIds)
    .returns<Array<{ id: string }>>();

  if (serviceError) {
    throw new Error(serviceError.message);
  }

  if ((serviceRows ?? []).length !== serviceIds.length) {
    throw new Error("Selected services must belong to the current salon.");
  }
}

async function createTicketFromSubmitInput(
  input: PosDeskSubmitInput,
  sessionId?: string | null,
): Promise<PosDeskActionResult> {
  try {
    const { context, organization, salon, supabase, user } =
      await requirePosDeskMutationContext();
    validateSubmitLines(input.lines);
    await validateSubmitLineScope({
      lines: input.lines,
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
    });

    const customer = await findOrCreateDeskCustomer({
      customerId: cleanOptional(input.customerId),
      customerLookup: cleanOptional(input.customerLookup),
      customerName: cleanOptional(input.customerName),
    });
    const discountType: PosTicket["discount_type"] =
      input.discountType === "percentage" ? "percentage" : "fixed_amount";
    const discountValue = roundMoney(input.discountValue ?? 0);

    if (discountValue < 0) {
      throw new Error("Discount must be zero or greater.");
    }

    if (discountType === "percentage" && discountValue > 100) {
      throw new Error("Percentage discount must be between 0 and 100.");
    }

    const tipAmount = roundMoney(input.tipAmount ?? 0);
    const now = new Date().toISOString();
    const workDate = getTodayDate(context.user?.timezone);
    const { data: ticket, error: ticketError } = await supabase
      .from("pos_tickets")
      .insert({
        customer_id: customer.id,
        notes: cleanOptional(input.note),
        opened_at: now,
        organization_id: organization.id,
        salon_id: salon.id,
        status: "open",
        tax_rate: POS_DESK_DEFAULTS.taxEnabled ? 0 : 0,
        tip_type: "fixed_amount",
        tip_value: tipAmount,
      })
      .select("id, organization_id, salon_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at")
      .single<PosTicket>();

    if (ticketError) {
      throw new Error(ticketError.message);
    }

    const insertedItems: PosTicketItemWithRelations[] = [];

    for (const line of input.lines) {
      const { data: item, error: itemError } = await supabase
        .from("pos_ticket_items")
        .insert({
          assigned_staff_id: line.staffId,
          notes: `${line.serviceLabel} | Parts: ${line.amountInput}`,
          organization_id: organization.id,
          pos_ticket_id: ticket.id,
          quantity: 1,
          salon_id: salon.id,
          service_id: cleanOptional(line.serviceId),
          unit_price: line.total,
        })
        .select("id, organization_id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, created_at, updated_at, service:services(id, name, category, base_price, duration_minutes), assigned_staff:staff(id, display_name, job_title)")
        .single<PosTicketItemWithRelations>();

      if (itemError) {
        throw new Error(itemError.message);
      }

      insertedItems.push(item);

      const turnRows = line.amountParts.map((amount, partIndex) => ({
        amount,
        organization_id: organization.id,
        salon_id: salon.id,
        staff_id: line.staffId,
        ticket_id: ticket.id,
        ticket_item_id: item.id,
        turn_index: partIndex + 1,
        turn_type: getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold),
        work_date: workDate,
      }));

      const { error: turnError } = await supabase
        .from("pos_ticket_item_turn_parts")
        .insert(turnRows);

      if (turnError) {
        throw new Error(turnError.message);
      }
    }

    if (discountValue > 0 || discountType !== "fixed_amount") {
      const { error: discountError } = await supabase
        .from("pos_tickets")
        .update({
          discount_type: discountType,
          discount_value: discountValue,
        })
        .eq("id", ticket.id)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id);

      if (discountError) {
        throw new Error(discountError.message);
      }
    }

    const ticketWithDiscount = {
      ...ticket,
      discount_type: discountType,
      discount_value: discountValue,
    };

    const totals = calculateTicketTotals({
      discountType,
      discountValue,
      items: insertedItems,
      tipType: "fixed_amount",
      tipValue: tipAmount,
    });

    if (totals.total <= 0) {
      throw new Error("Receipt total must be greater than 0.");
    }

    const { data: payment, error: paymentError } = await supabase
      .from("pos_payments")
      .insert({
        amount: totals.total,
        created_by: user.id,
        note: "Record-only POS desk payment. Payment processor connection comes later.",
        organization_id: organization.id,
        payment_method: "other",
        salon_id: salon.id,
        ticket_id: ticket.id,
      })
      .select("id, organization_id, salon_id, ticket_id, payment_method, amount, note, created_by, created_at")
      .single<PosPayment>();

    if (paymentError) {
      throw new Error(paymentError.message);
    }

    const finalTotals = calculateTicketTotals({
      discountType,
      discountValue,
      items: insertedItems,
      payments: [payment],
      tipType: "fixed_amount",
      tipValue: tipAmount,
    });

    buildTicketReceipt({
      customer,
      items: insertedItems,
      payments: [payment],
      salon,
      ticket: ticketWithDiscount,
      totals: finalTotals,
    });

    const { error: closeError } = await supabase
      .from("pos_tickets")
      .update({ closed_at: new Date().toISOString(), status: "closed" })
      .eq("id", ticket.id)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id);

    if (closeError) {
      throw new Error(closeError.message);
    }

    const { error: auditError } = await supabase
      .from("pos_ticket_audit_logs")
      .insert({
        action: "ticket_checked_out",
        created_by: user.id,
        note: "Ticket checked out from POS Desk.",
        organization_id: organization.id,
        salon_id: salon.id,
        ticket_id: ticket.id,
      });

    if (auditError) {
      throw new Error(auditError.message);
    }

    if (sessionId) {
      const { error: sessionError } = await supabase
        .from("pos_desk_sessions")
        .update({
          customer_id: customer.id,
          customer_lookup_value: cleanOptional(input.customerLookup),
          customer_name_snapshot: customer.name,
          last_activity_at: new Date().toISOString(),
          note: cleanOptional(input.note),
          status: "submitted",
          submitted_ticket_id: ticket.id,
          tip_amount: tipAmount,
        })
        .eq("id", sessionId)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id);

      if (sessionError) {
        throw new Error(sessionError.message);
      }
    }

    await recalculateStaffEarningsForDate(salon.id, workDate);

    revalidatePath("/pos");
    revalidatePath("/pos-tickets");
    revalidatePath("/staff/today");
    revalidatePath("/staff/my-work");

    return { ok: true, ticketId: ticket.id, ticketNumber: ticket.ticket_number };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to submit POS receipt.",
      ok: false,
    };
  }
}

export async function getPosDeskSession(
  sessionId: string,
): Promise<ActionResult<PosDeskSessionView | null>> {
  try {
    return { data: await loadPosDeskSessionForPos(sessionId), ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to load POS session.",
      ok: false,
    };
  }
}

export async function createPosDeskSession(): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { organization, salon, supabase, user } = await requirePosDeskMutationContext();
    const now = new Date();
    const { data, error } = await supabase
      .from("pos_desk_sessions")
      .insert({
        created_by: user.id,
        customer_display_token: randomUUID().replaceAll("-", ""),
        expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        organization_id: organization.id,
        salon_id: salon.id,
        status: "active",
      })
      .select("id")
      .single<{ id: string }>();

    if (error) {
      throw new Error(error.message);
    }

    const session = await loadPosDeskSessionForPos(data.id);

    if (!session) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: session, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to create POS session.",
      ok: false,
    };
  }
}

export async function searchPosDeskCustomers(search: string) {
  const { salon, supabase } = await requirePosDeskMutationContext();
  const trimmed = search.trim();

  if (!trimmed) {
    return [];
  }

  const escaped = trimmed.replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .eq("location_id", salon.id)
    .eq("status", "active")
    .or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<PosDeskCustomer[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function getOrCreatePosLiveDraft(): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const { organization, salon, supabase } = await requirePosDeskMutationContext();
    const select =
      "id, salon_id, token, customer, staff_lines, selected_staff_id, tip, subtotal, total, status, version, updated_at";

    const existing = await supabase
      .from("pos_live_drafts")
      .select(select)
      .eq("salon_id", salon.id)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<RawLiveDraft>();

    if (existing.error) {
      throw new Error(existing.error.message);
    }

    if (existing.data) {
      return { data: toLiveDraftView(existing.data), ok: true };
    }

    const inserted = await supabase
      .from("pos_live_drafts")
      .insert({
        organization_id: organization.id,
        receipt: {},
        salon_id: salon.id,
        staff_lines: [],
        subtotal: 0,
        tip: 0,
        token: randomUUID().replaceAll("-", ""),
        total: 0,
      })
      .select(select)
      .single<RawLiveDraft>();

    if (inserted.error) {
      throw new Error(inserted.error.message);
    }

    return { data: toLiveDraftView(inserted.data), ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to create live draft.",
      ok: false,
    };
  }
}

export async function getPosLiveDraft(
  token: string,
): Promise<ActionResult<PosLiveDraftView | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc("get_pos_live_draft_by_token", {
      p_token: token,
    });

    if (error) {
      throw new Error(error.message);
    }

    const rows = data as RawLiveDraft[] | null;

    return { data: rows?.[0] ? toLiveDraftView(rows[0]) : null, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to load live draft.",
      ok: false,
    };
  }
}

export async function updatePosActiveDraft(input: {
  selectedStaffId: string | null;
  staffLines: PosLiveDraftReceiptLine[];
  subtotal: number;
  tip: number;
  token: string;
  total: number;
}): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    const { data: existing, error: existingError } = await supabase
      .from("pos_live_drafts")
      .select("id, version")
      .eq("token", input.token)
      .eq("salon_id", salon.id)
      .single<{ id: string; version: number }>();

    if (existingError) {
      throw new Error(existingError.message);
    }

    const { data, error } = await supabase
      .from("pos_live_drafts")
      .update({
        selected_staff_id: input.selectedStaffId,
        staff_lines: normalizeLiveDraftStaffLines(input.staffLines),
        status: "draft",
        subtotal: roundMoney(input.subtotal),
        tip: roundMoney(input.tip),
        total: roundMoney(input.total),
        version: Number(existing.version) + 1,
      })
      .eq("id", existing.id)
      .select("id, salon_id, token, customer, staff_lines, selected_staff_id, tip, subtotal, total, status, version, updated_at")
      .single<RawLiveDraft>();

    if (error) {
      throw new Error(error.message);
    }

    return { data: toLiveDraftView(data), ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update live receipt.",
      ok: false,
    };
  }
}

export async function updatePosLiveDraftCustomer(input: {
  customer: PosLiveDraftCustomer | null;
  token: string;
}): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    const { data: existing, error: existingError } = await supabase
      .from("pos_live_drafts")
      .select("id, version")
      .eq("token", input.token)
      .eq("salon_id", salon.id)
      .single<{ id: string; version: number }>();

    if (existingError) {
      throw new Error(existingError.message);
    }

    const { data, error } = await supabase
      .from("pos_live_drafts")
      .update({
        customer: input.customer,
        version: Number(existing.version) + 1,
      })
      .eq("id", existing.id)
      .select("id, salon_id, token, customer, staff_lines, selected_staff_id, tip, subtotal, total, status, version, updated_at")
      .single<RawLiveDraft>();

    if (error) {
      throw new Error(error.message);
    }

    return { data: toLiveDraftView(data), ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update live customer.",
      ok: false,
    };
  }
}

export async function createPosDeskCustomer(input: {
  email?: string | null;
  name: string;
  phone?: string | null;
}): Promise<ActionResult<PosDeskCustomer>> {
  try {
    const { context, salon, supabase, user } =
      await requirePosDeskMutationContext();
    const name = cleanOptional(input.name);

    if (!name) {
      throw new Error("Customer name is required.");
    }

    const { data, error } = await supabase
      .from("customers")
      .insert({
        email: cleanOptional(input.email),
        location_id: salon.id,
        name,
        notes: "Created from POS Desk quick add.",
        phone: cleanOptional(input.phone),
        status: "active",
      })
      .select("id, name, phone, email")
      .single<PosDeskCustomer>();

    if (error) {
      console.error("Supabase POS desk customer create failed", {
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
        organizationId: context.currentOrganization?.id,
        salonId: salon.id,
        userId: user.id,
      });
      throw new Error(error.message);
    }

    revalidatePath("/customers");
    revalidatePath("/pos");

    return { data, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to create customer.",
      ok: false,
    };
  }
}

export async function updateLiveDraftCustomerByPhone(input: {
  phone: string;
  token: string;
}): Promise<ActionResult<PosLiveDraftCustomer>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "upsert_pos_live_draft_customer_by_phone",
      {
        p_phone: input.phone,
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return { data: data as PosLiveDraftCustomer, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to save customer.",
      ok: false,
    };
  }
}

export async function findLiveDraftCustomerByPhone(input: {
  phone: string;
  token: string;
}): Promise<ActionResult<PosLiveDraftCustomer | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "find_pos_live_draft_customer_by_phone",
      {
        p_phone: input.phone,
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return { data: null, ok: true };
    }

    return { data: data as PosLiveDraftCustomer, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to find customer.",
      ok: false,
    };
  }
}

export async function createLiveDraftCustomer(input: {
  name: string;
  phone: string;
  token: string;
}): Promise<ActionResult<PosLiveDraftCustomer>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "create_pos_live_draft_customer_by_phone",
      {
        p_name: input.name,
        p_phone: input.phone,
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return { data: data as PosLiveDraftCustomer, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to create customer.",
      ok: false,
    };
  }
}

export async function updatePosDeskSessionCustomer(input: {
  customerId?: string | null;
  customerLookup?: string | null;
  customerName?: string | null;
  sessionId: string;
}): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    await requireActiveSession(input.sessionId);
    const lookup = cleanOptional(input.customerLookup);
    const name = cleanOptional(input.customerName);
    let customerId = cleanOptional(input.customerId);
    let customerNameSnapshot = name;

    if (!customerId && (lookup || name)) {
      const customer = await findOrCreateDeskCustomer({
        customerId: null,
        customerLookup: lookup,
        customerName: name,
      });
      customerId = customer.id;
      customerNameSnapshot = customer.name;
    }

    const { error } = await supabase
      .from("pos_desk_sessions")
      .update({
        customer_id: customerId,
        customer_lookup_value: lookup,
        customer_name_snapshot: customerNameSnapshot,
      })
      .eq("id", input.sessionId)
      .eq("salon_id", salon.id);

    if (error) {
      throw new Error(error.message);
    }

    await touchSession(input.sessionId);
    const session = await loadPosDeskSessionForPos(input.sessionId);

    if (!session) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: session, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update customer.",
      ok: false,
    };
  }
}

export async function updatePosDeskSessionNote(input: {
  note: string;
  sessionId: string;
}): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    await requireActiveSession(input.sessionId);

    const { error } = await supabase
      .from("pos_desk_sessions")
      .update({ note: cleanOptional(input.note) })
      .eq("id", input.sessionId)
      .eq("salon_id", salon.id);

    if (error) {
      throw new Error(error.message);
    }

    await touchSession(input.sessionId);
    const session = await loadPosDeskSessionForPos(input.sessionId);

    if (!session) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: session, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update note.",
      ok: false,
    };
  }
}

export async function updateSessionTip(input: {
  sessionId: string;
  tipAmount: number;
}): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    await requireActiveSession(input.sessionId);

    if (!Number.isFinite(input.tipAmount) || input.tipAmount < 0) {
      throw new Error("Tip must be zero or greater.");
    }

    const { error } = await supabase
      .from("pos_desk_sessions")
      .update({ tip_amount: roundMoney(input.tipAmount) })
      .eq("id", input.sessionId)
      .eq("salon_id", salon.id);

    if (error) {
      throw new Error(error.message);
    }

    await touchSession(input.sessionId);
    const session = await loadPosDeskSessionForPos(input.sessionId);

    if (!session) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: session, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update tip.",
      ok: false,
    };
  }
}

export async function addOrUpdateSessionLine(
  input: PosDeskSessionLineInput,
): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { organization, salon, supabase } = await requirePosDeskMutationContext();
    const session = await requireActiveSession(input.sessionId);
    const parsed = parsePosAmountInput(input.amountInput);

    if (!parsed.isValid) {
      throw new Error(parsed.error);
    }

    if (!input.staffId) {
      throw new Error("Select assigned staff.");
    }

    const serviceLabel =
      cleanOptional(input.serviceLabel) ?? `Service ${session.lines.length + 1}`;
    const turnLargeCount = parsed.parts.filter(
      (part) => getTurnType(part, POS_DESK_DEFAULTS.largeTurnThreshold) === "large",
    ).length;
    const turnSmallCount = parsed.parts.length - turnLargeCount;

    const row = {
      amount: parsed.total,
      amount_input: input.amountInput,
      amount_parts: parsed.parts,
      organization_id: organization.id,
      salon_id: salon.id,
      service_id: cleanOptional(input.serviceId),
      service_label: serviceLabel,
      session_id: input.sessionId,
      staff_id: input.staffId,
      turn_large_count: turnLargeCount,
      turn_small_count: turnSmallCount,
    };

    if (input.lineId) {
      const { error } = await supabase
        .from("pos_desk_session_lines")
        .update(row)
        .eq("id", input.lineId)
        .eq("session_id", input.sessionId)
        .eq("salon_id", salon.id);

      if (error) {
        throw new Error(error.message);
      }
    } else {
      const nextSortOrder =
        session.lines.reduce((max, line) => Math.max(max, line.sort_order), 0) + 1;
      const { error } = await supabase
        .from("pos_desk_session_lines")
        .insert({ ...row, sort_order: nextSortOrder });

      if (error) {
        throw new Error(error.message);
      }
    }

    const updated = await loadPosDeskSessionForPos(input.sessionId);

    if (!updated) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: updated, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to save receipt line.",
      ok: false,
    };
  }
}

export async function syncPosDeskSessionFromLocal(input: {
  customerId?: string | null;
  customerLookup?: string | null;
  customerName?: string | null;
  lines: PosDeskSubmitLine[];
  note?: string | null;
  sessionId: string;
  tipAmount?: number;
}): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { organization, salon, supabase } = await requirePosDeskMutationContext();
    const existingSession = await requireActiveSession(input.sessionId);

    if (input.lines.length > 0) {
      validateSubmitLines(input.lines);
      await validateSubmitLineScope({
        lines: input.lines,
        organizationId: organization.id,
        salonId: salon.id,
        supabase,
      });
    }

    const lookup = cleanOptional(input.customerLookup) ?? existingSession.customer_lookup_value;
    const name = cleanOptional(input.customerName) ?? existingSession.customer_name_snapshot;
    const customerId = cleanOptional(input.customerId) ?? existingSession.customer_id;
    let customerNameSnapshot = name;

    if (customerId) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .eq("id", customerId)
        .eq("location_id", salon.id)
        .maybeSingle<{ id: string; name: string }>();

      if (error || !data) {
        throw new Error("Selected customer must belong to the current salon.");
      }

      customerNameSnapshot = data.name;
    }

    const { error: updateSessionError } = await supabase
      .from("pos_desk_sessions")
      .update({
        customer_id: customerId,
        customer_lookup_value: lookup,
        customer_name_snapshot: customerNameSnapshot,
        note: cleanOptional(input.note),
        tip_amount: roundMoney(input.tipAmount ?? 0),
      })
      .eq("id", input.sessionId)
      .eq("salon_id", salon.id);

    if (updateSessionError) {
      throw new Error(updateSessionError.message);
    }

    const { error: deleteError } = await supabase
      .from("pos_desk_session_lines")
      .delete()
      .eq("session_id", input.sessionId)
      .eq("salon_id", salon.id);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const rows = input.lines.map((line, index) => ({
      amount: line.total,
      amount_input: line.amountInput,
      amount_parts: line.amountParts,
      organization_id: organization.id,
      salon_id: salon.id,
      service_id: cleanOptional(line.serviceId),
      service_label: cleanOptional(line.serviceLabel) ?? `Service ${index + 1}`,
      session_id: input.sessionId,
      sort_order: index + 1,
      staff_id: line.staffId,
      turn_large_count: line.amountParts.filter(
        (amount) => getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold) === "large",
      ).length,
      turn_small_count: line.amountParts.filter(
        (amount) => getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold) === "small",
      ).length,
    }));

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from("pos_desk_session_lines")
        .insert(rows);

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    await touchSession(input.sessionId);
    const session = await loadPosDeskSessionForPos(input.sessionId);

    if (!session) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: session, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to sync POS session.",
      ok: false,
    };
  }
}

export async function removeSessionLine(input: {
  lineId: string;
  sessionId: string;
}): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    await requireActiveSession(input.sessionId);

    const { error } = await supabase
      .from("pos_desk_session_lines")
      .delete()
      .eq("id", input.lineId)
      .eq("session_id", input.sessionId)
      .eq("salon_id", salon.id);

    if (error) {
      throw new Error(error.message);
    }

    const session = await loadPosDeskSessionForPos(input.sessionId);

    if (!session) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: session, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to remove receipt line.",
      ok: false,
    };
  }
}

export async function cancelSession(
  sessionId: string,
): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    await requireActiveSession(sessionId);

    const { error } = await supabase
      .from("pos_desk_sessions")
      .update({ last_activity_at: new Date().toISOString(), status: "cancelled" })
      .eq("id", sessionId)
      .eq("salon_id", salon.id);

    if (error) {
      throw new Error(error.message);
    }

    const session = await loadPosDeskSessionForPos(sessionId);

    if (!session) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: session, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to cancel POS session.",
      ok: false,
    };
  }
}

export async function submitSessionToTicket(
  sessionId: string,
): Promise<PosDeskActionResult> {
  try {
    const { context, organization, salon, supabase, user } =
      await requirePosDeskMutationContext();
    const session = await requirePendingConfirmedSession(sessionId);

    if (session.lines.length === 0) {
      throw new Error("Add at least one receipt line before submit.");
    }

    const customer = await findOrCreateDeskCustomer({
      customerId: session.customer_id,
      customerLookup: session.customer_lookup_value,
      customerName: session.customer_name_snapshot,
    });

    const now = new Date().toISOString();
    const workDate = getTodayDate(context.user?.timezone);
    const { data: ticket, error: ticketError } = await supabase
      .from("pos_tickets")
      .insert({
        customer_id: customer.id,
        notes: cleanOptional(session.note),
        opened_at: now,
        organization_id: organization.id,
        salon_id: salon.id,
        status: "open",
        tax_rate: POS_DESK_DEFAULTS.taxEnabled ? 0 : 0,
        tip_type: "fixed_amount",
        tip_value: session.tip_amount,
      })
      .select("id, organization_id, salon_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at")
      .single<PosTicket>();

    if (ticketError) {
      throw new Error(ticketError.message);
    }

    const insertedItems: PosTicketItemWithRelations[] = [];

    for (const line of session.lines) {
      const { data: item, error: itemError } = await supabase
        .from("pos_ticket_items")
        .insert({
          assigned_staff_id: line.staff_id,
          notes: `${line.service_label} | Parts: ${line.amount_input}`,
          organization_id: organization.id,
          pos_ticket_id: ticket.id,
          quantity: 1,
          salon_id: salon.id,
          service_id: line.service_id,
          unit_price: line.amount,
        })
        .select("id, organization_id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, created_at, updated_at, service:services(id, name, category, base_price, duration_minutes), assigned_staff:staff(id, display_name, job_title)")
        .single<PosTicketItemWithRelations>();

      if (itemError) {
        throw new Error(itemError.message);
      }

      insertedItems.push(item);

      const turnRows = line.amount_parts.map((amount, partIndex) => ({
        amount,
        organization_id: organization.id,
        salon_id: salon.id,
        staff_id: line.staff_id,
        ticket_id: ticket.id,
        ticket_item_id: item.id,
        turn_index: partIndex + 1,
        turn_type: getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold),
        work_date: workDate,
      }));

      const { error: turnError } = await supabase
        .from("pos_ticket_item_turn_parts")
        .insert(turnRows);

      if (turnError) {
        throw new Error(turnError.message);
      }
    }

    const totals = calculateTicketTotals({
      items: insertedItems,
      tipType: "fixed_amount",
      tipValue: session.tip_amount,
    });

    if (totals.total <= 0) {
      throw new Error("Receipt total must be greater than 0.");
    }

    const { data: payment, error: paymentError } = await supabase
      .from("pos_payments")
      .insert({
        amount: totals.total,
        created_by: user.id,
        note: "Record-only POS desk payment. Payment processor connection comes later.",
        organization_id: organization.id,
        payment_method: "other",
        salon_id: salon.id,
        ticket_id: ticket.id,
      })
      .select("id, organization_id, salon_id, ticket_id, payment_method, amount, note, created_by, created_at")
      .single<PosPayment>();

    if (paymentError) {
      throw new Error(paymentError.message);
    }

    const finalTotals = calculateTicketTotals({
      items: insertedItems,
      payments: [payment],
      tipType: "fixed_amount",
      tipValue: session.tip_amount,
    });

    buildTicketReceipt({
      customer,
      items: insertedItems,
      payments: [payment],
      salon,
      ticket,
      totals: finalTotals,
    });

    const { error: closeError } = await supabase
      .from("pos_tickets")
      .update({ closed_at: new Date().toISOString(), status: "closed" })
      .eq("id", ticket.id)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id);

    if (closeError) {
      throw new Error(closeError.message);
    }

    const { error: auditError } = await supabase
      .from("pos_ticket_audit_logs")
      .insert({
        action: "ticket_checked_out",
        created_by: user.id,
        note: "Ticket checked out from POS Desk session.",
        organization_id: organization.id,
        salon_id: salon.id,
        ticket_id: ticket.id,
      });

    if (auditError) {
      throw new Error(auditError.message);
    }

    const { error: sessionError } = await supabase
      .from("pos_desk_sessions")
      .update({
        last_activity_at: new Date().toISOString(),
        status: "submitted",
        submitted_ticket_id: ticket.id,
      })
      .eq("id", session.id)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id);

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    await supabase
      .from("pos_display_channels")
      .update({ status: "finalized" })
      .eq("token", session.customer_display_token)
      .eq("salon_id", salon.id);

    await recalculateStaffEarningsForDate(salon.id, workDate);

    revalidatePath("/pos");
    revalidatePath("/pos-tickets");
    revalidatePath("/staff/today");
    revalidatePath("/staff/my-work");

    return { ok: true, ticketId: ticket.id, ticketNumber: ticket.ticket_number };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to submit POS session.",
      ok: false,
    };
  }
}

export async function submitPosDeskReceipt(
  input: PosDeskSubmitInput,
  sessionId?: string | null,
): Promise<PosDeskActionResult> {
  return createTicketFromSubmitInput(input, sessionId);
}

export async function publishReceiptToCustomerDisplay(input: {
  customerId?: string | null;
  customerLookup?: string | null;
  customerName?: string | null;
  lines: PosDeskSubmitLine[];
  note?: string | null;
  payload: PosDisplayReceiptPayload;
  sessionId?: string | null;
  tipAmount?: number;
  token: string;
}): Promise<ActionResult<PosDisplayChannelView>> {
  try {
    const { organization, salon, supabase } = await requirePosDeskMutationContext();
    validateSubmitLines(input.lines);
    await validateSubmitLineScope({
      lines: input.lines,
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
    });

    if (input.sessionId) {
      await requireActiveSession(input.sessionId);
      const lookup = cleanOptional(input.customerLookup);
      const name = cleanOptional(input.customerName);
      const customerId = cleanOptional(input.customerId);
      let customerNameSnapshot = name;

      if (customerId) {
        const { data, error } = await supabase
          .from("customers")
          .select("id, name")
          .eq("id", customerId)
          .eq("location_id", salon.id)
          .maybeSingle<{ id: string; name: string }>();

        if (error || !data) {
          throw new Error("Selected customer must belong to the current salon.");
        }

        customerNameSnapshot = data.name;
      }

      const now = new Date();
      const { error: updateSessionError } = await supabase
        .from("pos_desk_sessions")
        .update({
          customer_confirmed_at: null,
          customer_id: customerId,
          customer_lookup_value: lookup,
          customer_name_snapshot: customerNameSnapshot,
          expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
          last_activity_at: now.toISOString(),
          note: cleanOptional(input.note),
          tip_amount: roundMoney(input.tipAmount ?? 0),
        })
        .eq("id", input.sessionId)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id);

      if (updateSessionError) {
        throw new Error(updateSessionError.message);
      }

      const { error: deleteError } = await supabase
        .from("pos_desk_session_lines")
        .delete()
        .eq("session_id", input.sessionId)
        .eq("salon_id", salon.id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      const rows = input.lines.map((line, index) => ({
        amount: line.total,
        amount_input: line.amountInput,
        amount_parts: line.amountParts,
        organization_id: organization.id,
        salon_id: salon.id,
        service_id: cleanOptional(line.serviceId),
        service_label: cleanOptional(line.serviceLabel) ?? `Service ${index + 1}`,
        session_id: input.sessionId,
        sort_order: index + 1,
        staff_id: line.staffId,
        turn_large_count: line.amountParts.filter(
          (amount) => getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold) === "large",
        ).length,
        turn_small_count: line.amountParts.filter(
          (amount) => getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold) === "small",
        ).length,
      }));

      const { error: insertError } = await supabase
        .from("pos_desk_session_lines")
        .insert(rows);

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from("pos_display_channels")
      .select("id, pos_message_version")
      .eq("token", input.token)
      .eq("salon_id", salon.id)
      .maybeSingle<{ id: string; pos_message_version: number }>();

    if (existingError) {
      throw new Error(existingError.message);
    }

    const nextVersion = Number(existing?.pos_message_version ?? 0) + 1;
    const channelPayload = {
      customer_message: null,
      customer_message_version: 0,
      pos_message: input.payload,
      pos_message_version: nextVersion,
      salon_id: salon.id,
      status: "receipt_sent",
      token: input.token,
    };

    const { data, error } = existing
      ? await supabase
          .from("pos_display_channels")
          .update(channelPayload)
          .eq("id", existing.id)
          .select(
            "id, salon_id, token, pos_message, pos_message_version, customer_message, customer_message_version, status, updated_at",
          )
          .single<RawDisplayChannel>()
      : await supabase
          .from("pos_display_channels")
          .insert(channelPayload)
          .select(
            "id, salon_id, token, pos_message, pos_message_version, customer_message, customer_message_version, status, updated_at",
          )
          .single<RawDisplayChannel>();

    if (error) {
      throw new Error(error.message);
    }

    return { data: toDisplayChannelView(data), ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to publish receipt to customer display.",
      ok: false,
    };
  }
}

export async function getPosDisplayChannel(
  token: string,
): Promise<ActionResult<PosDisplayChannelView | null>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    const { data, error } = await supabase
      .from("pos_display_channels")
      .select(
        "id, salon_id, token, pos_message, pos_message_version, customer_message, customer_message_version, status, updated_at",
      )
      .eq("token", token)
      .eq("salon_id", salon.id)
      .maybeSingle<RawDisplayChannel>();

    if (error) {
      throw new Error(error.message);
    }

    return { data: data ? toDisplayChannelView(data) : null, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to load display channel.",
      ok: false,
    };
  }
}

export async function getCustomerDisplayChannel(
  token: string,
): Promise<ActionResult<PosDisplayChannelView | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc("get_pos_display_channel_by_token", {
      p_token: token,
    });

    if (error) {
      throw new Error(error.message);
    }

    return { data: data as PosDisplayChannelView | null, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to load customer display.",
      ok: false,
    };
  }
}

export async function confirmCustomerTip(input: {
  message: PosDisplayCustomerMessage;
  token: string;
}): Promise<ActionResult<PosDisplayChannelView | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc("confirm_pos_display_channel_tip", {
      p_customer_message: input.message,
      p_token: input.token,
    });

    if (error) {
      throw new Error(error.message);
    }

    return { data: data as PosDisplayChannelView | null, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to confirm tip.",
      ok: false,
    };
  }
}

export async function requestCustomerReceiptConfirmation(input: {
  customerId?: string | null;
  customerLookup?: string | null;
  customerName?: string | null;
  lines: PosDeskSubmitLine[];
  note?: string | null;
  sessionId: string;
  tipAmount?: number;
}): Promise<ActionResult<PosDeskSessionView>> {
  try {
    const { organization, salon, supabase } = await requirePosDeskMutationContext();
    const existingSession = await requireActiveSession(input.sessionId);
    validateSubmitLines(input.lines);
    await validateSubmitLineScope({
      lines: input.lines,
      organizationId: organization.id,
      salonId: salon.id,
      supabase,
    });

    const lookup = cleanOptional(input.customerLookup) ?? existingSession.customer_lookup_value;
    const name = cleanOptional(input.customerName) ?? existingSession.customer_name_snapshot;
    const customerId = cleanOptional(input.customerId) ?? existingSession.customer_id;
    let customerNameSnapshot = name;

    if (customerId) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .eq("id", customerId)
        .eq("location_id", salon.id)
        .maybeSingle<{ id: string; name: string }>();

      if (error || !data) {
        throw new Error("Selected customer must belong to the current salon.");
      }

      customerNameSnapshot = data.name;
    }

    const now = new Date();
    const { error: updateSessionError } = await supabase
      .from("pos_desk_sessions")
      .update({
        customer_confirmed_at: null,
        customer_id: customerId,
        customer_lookup_value: lookup,
        customer_name_snapshot: customerNameSnapshot,
        expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        last_activity_at: now.toISOString(),
        note: cleanOptional(input.note),
        tip_amount: roundMoney(input.tipAmount ?? 0),
      })
      .eq("id", input.sessionId)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id);

    if (updateSessionError) {
      throw new Error(updateSessionError.message);
    }

    const { error: deleteError } = await supabase
      .from("pos_desk_session_lines")
      .delete()
      .eq("session_id", input.sessionId)
      .eq("salon_id", salon.id);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const rows = input.lines.map((line, index) => ({
      amount: line.total,
      amount_input: line.amountInput,
      amount_parts: line.amountParts,
      organization_id: organization.id,
      salon_id: salon.id,
      service_id: cleanOptional(line.serviceId),
      service_label: cleanOptional(line.serviceLabel) ?? `Service ${index + 1}`,
      session_id: input.sessionId,
      sort_order: index + 1,
      staff_id: line.staffId,
      turn_large_count: line.amountParts.filter(
        (amount) => getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold) === "large",
      ).length,
      turn_small_count: line.amountParts.filter(
        (amount) => getTurnType(amount, POS_DESK_DEFAULTS.largeTurnThreshold) === "small",
      ).length,
    }));

    const { error: insertError } = await supabase
      .from("pos_desk_session_lines")
      .insert(rows);

    if (insertError) {
      throw new Error(insertError.message);
    }

    const session = await loadPosDeskSessionForPos(input.sessionId);

    if (!session) {
      throw new Error("Unable to reload POS session.");
    }

    return { data: session, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to request confirmation.",
      ok: false,
    };
  }
}

export async function getCustomerDisplaySession(
  token: string,
): Promise<ActionResult<PosDeskSessionView | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc("get_pos_desk_session_by_token", {
      p_token: token,
    });

    if (error) {
      throw new Error(error.message);
    }

    return { data: data as PosDeskSessionView | null, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to load customer display.",
      ok: false,
    };
  }
}

export async function updateCustomerDisplayLookup(input: {
  customerLookup: string;
  token: string;
}): Promise<ActionResult<PosDeskSessionView | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "update_pos_desk_session_customer_by_token",
      {
        p_customer_lookup: input.customerLookup,
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return { data: data as PosDeskSessionView | null, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update customer.",
      ok: false,
    };
  }
}

export async function createCustomerDisplayCustomer(input: {
  customerLookup: string;
  customerName: string;
  token: string;
}): Promise<ActionResult<PosDeskSessionView | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "create_pos_desk_customer_by_token",
      {
        p_customer_lookup: input.customerLookup,
        p_customer_name: input.customerName,
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return { data: data as PosDeskSessionView | null, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to create customer.",
      ok: false,
    };
  }
}

export async function updateCustomerDisplayTip(input: {
  confirm?: boolean;
  tipAmount: number;
  token: string;
}): Promise<ActionResult<PosDeskSessionView | null>> {
  try {
    if (!Number.isFinite(input.tipAmount) || input.tipAmount < 0) {
      throw new Error("Tip must be zero or greater.");
    }

    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "update_pos_desk_session_tip_by_token",
      {
        p_confirm: Boolean(input.confirm),
        p_tip_amount: roundMoney(input.tipAmount),
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return { data: data as PosDeskSessionView | null, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update tip.",
      ok: false,
    };
  }
}
