"use server";

import {
  POS_TICKET_ITEM_SELECT,
  POS_TICKET_PERMISSIONS,
} from "@/lib/pos-tickets";
import {
  getCurrentBusinessContext,
  getRouteForInvalidSalonContext,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import {
  assertFinancialDateMutable,
  assertTicketFinancialDateMutable,
  canApplyFinancialCorrections,
  FINANCIAL_CORRECTION_PERMISSIONS,
  isDailyClosingLocked,
} from "@/lib/daily-pos-report";
import { POS_DESK_DEFAULTS } from "@/lib/pos-desk";
import { getTurnType } from "@/lib/pos-desk-amounts";
import {
  POS_PAYMENT_METHOD_OPTIONS,
  POS_PAYMENT_SELECT,
} from "@/lib/pos-payments";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import {
  recalculateStaffEarningsForDate,
  recalculateTicketStaffEarnings,
} from "@/lib/pos-ticket-staff-earnings";
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

function finiteCents(value: number | string | null | undefined) {
  const cents = toCents(value ?? 0);
  return Number.isFinite(cents) ? cents : 0;
}

function addStaffTotals(
  totalsByStaffId: Map<string, StaffCorrectionTotals>,
  staffId: string,
  patch: Partial<StaffCorrectionTotals>,
) {
  const current = totalsByStaffId.get(staffId) ?? {
    serviceCents: 0,
    tipCents: 0,
    turnCount: 0,
  };

  current.serviceCents += patch.serviceCents ?? 0;
  current.tipCents += patch.tipCents ?? 0;
  current.turnCount += patch.turnCount ?? 0;
  totalsByStaffId.set(staffId, current);
}

function setStaffTotals(
  totalsByStaffId: Map<string, StaffCorrectionTotals>,
  staffId: string,
  totals: StaffCorrectionTotals,
) {
  totalsByStaffId.set(staffId, { ...totals });
}

function addStaffId(set: Set<string>, staffId: string | null | undefined) {
  if (staffId) {
    set.add(staffId);
  }
}

function allocateTipCentsByStaff(
  staffServiceTotalCents: Map<string, number>,
  totalTipCents: number,
  manualTipCentsByStaffId = new Map<string, number>(),
) {
  const tipCentsByStaffId = new Map<string, number>();
  const staffIds = Array.from(staffServiceTotalCents.keys()).sort();
  const validTotalTipCents = Math.max(0, totalTipCents);
  const manualTipCents = staffIds.reduce(
    (total, staffId) => total + (manualTipCentsByStaffId.get(staffId) ?? 0),
    0,
  );
  const remainingTipCents = Math.max(0, validTotalTipCents - manualTipCents);
  const nonManualStaffIds = staffIds.filter(
    (staffId) => !manualTipCentsByStaffId.has(staffId),
  );
  const nonManualServiceTotalCents = nonManualStaffIds.reduce(
    (total, staffId) =>
      total + (staffServiceTotalCents.get(staffId) ?? 0),
    0,
  );

  for (const staffId of staffIds) {
    if (manualTipCentsByStaffId.has(staffId)) {
      tipCentsByStaffId.set(staffId, manualTipCentsByStaffId.get(staffId) ?? 0);
    }
  }

  if (remainingTipCents > 0 && nonManualServiceTotalCents > 0) {
    for (const staffId of nonManualStaffIds) {
      const serviceTotalCents = staffServiceTotalCents.get(staffId) ?? 0;
      tipCentsByStaffId.set(
        staffId,
        Math.round((remainingTipCents * serviceTotalCents) / nonManualServiceTotalCents),
      );
    }

    const allocated = nonManualStaffIds.reduce(
      (total, staffId) => total + (tipCentsByStaffId.get(staffId) ?? 0),
      0,
    );
    const remainderCents = remainingTipCents - allocated;

    if (remainderCents !== 0) {
      const remainderStaffId = [...nonManualStaffIds].sort(
        (left, right) =>
          (staffServiceTotalCents.get(right) ?? 0) -
            (staffServiceTotalCents.get(left) ?? 0) ||
          left.localeCompare(right),
      )[0];

      if (remainderStaffId) {
        tipCentsByStaffId.set(
          remainderStaffId,
          (tipCentsByStaffId.get(remainderStaffId) ?? 0) + remainderCents,
        );
      }
    }
  }

  for (const staffId of nonManualStaffIds) {
    tipCentsByStaffId.set(staffId, tipCentsByStaffId.get(staffId) ?? 0);
  }

  return tipCentsByStaffId;
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
const LOCKED_TICKET_DATE_MESSAGE =
  "This ticket belongs to a locked business date. Submit a financial correction request instead.";

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

type LockedStaffCorrectionIntent = "apply" | "request";

type ClosedTicketFinancialTicketRow = {
  discount_type: "fixed_amount" | "percentage";
  discount_value: number;
  id: string;
  opened_at: string;
  salon_id: string;
  status: string;
  tax_rate: number;
  tip_type: "fixed_amount" | "percentage";
  tip_value: number;
};

type ClosedTicketCurrentItemRow = {
  assigned_staff_id: string | null;
  created_at: string;
  id: string;
  is_removed: boolean;
  line_total: number;
  notes: string | null;
  pos_ticket_id: string;
  quantity: number;
  salon_id: string;
  service_id: string | null;
  unit_price: number;
};

type ClosedTicketCurrentPartRow = {
  amount: number;
  created_at: string;
  id: string;
  ticket_item_id: string;
  turn_index: number;
};

type ClosedTicketStaffEarningRow = {
  big_turn_count: number;
  manual_tip_amount: number | null;
  service_total: number;
  small_turn_count: number;
  staff_id: string;
  tip_amount: number;
  tip_is_manual: boolean;
};

type StaffCorrectionTotals = {
  serviceCents: number;
  tipCents: number;
  turnCount: number;
};

type StaffFinancialCorrection = {
  adjustment:
    | {
        expectedTotalDelta: number;
        serviceDelta: number;
        tipDelta: number;
        turnDelta: number;
      }
    | null;
  correctionType:
    | "other"
    | "staff_service_amount"
    | "staff_tip"
    | "staff_turn_count"
    | "ticket_service"
    | "ticket_staff_assignment";
  moneyDelta: number;
  oldValue: Record<string, unknown>;
  requestedValue: Record<string, unknown>;
  staffId: string | null;
};

type TurnPartInsertRow = {
  amount: number;
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

type PosTicketSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

async function requirePosTicketMutationContext(editId?: string) {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!isSalonManageContext(context)) {
    redirect(getRouteForInvalidSalonContext(context));
  }

  if (!context.currentAccount) {
    redirectWithError("Choose a salon workspace before managing POS tickets.", editId);
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
    Account: context.currentAccount,
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

  if (!isSalonManageContext(context)) {
    redirect(getRouteForInvalidSalonContext(context));
  }

  if (!context.currentAccount) {
    redirectWithError("Choose a salon workspace before managing POS tickets.", editId);
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
    Account: context.currentAccount,
    salon: context.currentSalon,
    user: context.user,
  };
}

async function requireLockedStaffCorrectionContext(editId?: string) {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!isSalonManageContext(context)) {
    redirect(getRouteForInvalidSalonContext(context));
  }

  if (!context.currentAccount) {
    redirectWithError("Choose a salon workspace before managing POS tickets.", editId);
  }

  if (!context.currentSalon) {
    redirectWithError("Please select a salon first.", editId);
  }

  const canRequest =
    (await hasPermission(POS_TICKET_PERMISSIONS.manage, context)) ||
    (await hasPermission(POS_TICKET_PERMISSIONS.void, context)) ||
    (await hasPermission(FINANCIAL_CORRECTION_PERMISSIONS.request, context)) ||
    (await canApplyFinancialCorrections(context));

  if (!canRequest) {
    redirectWithError("You do not have permission to request staff corrections.", editId);
  }

  return {
    supabase,
    context,
    Account: context.currentAccount,
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
  salonId,
  supabase,
  ticketId,
  userId,
}: {
  action: PosTicketAuditAction;
  note: string;
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
      salon_id: salonId,
      ticket_id: ticketId,
    });

  if (error) {
    throw error;
  }
}

async function loadClosedCorrectionSnapshot({
  salonId,
  supabase,
  ticketId,
}: {
  salonId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  ticketId: string;
}) {
  const [{ data: ticket, error: ticketError }, { data: earnings, error: earningsError }] =
    await Promise.all([
      supabase
        .from("pos_tickets")
        .select(
          "id, salon_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at, ticket_items:pos_ticket_items(id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, is_removed, removed_at, removed_by, removal_reason, created_at, updated_at, service:services(id, name, category, base_price, duration_minutes), assigned_staff:staff(id, display_name, job_title), turn_parts:pos_ticket_item_turn_parts(id, ticket_id, ticket_item_id, staff_id, amount, turn_type, turn_index, work_date, created_at))",
        )
        .eq("id", ticketId)
        .eq("salon_id", salonId)
        .maybeSingle(),
      supabase
        .from("pos_ticket_staff_earnings")
        .select(
          "id, ticket_id, staff_id, work_date, service_total, tip_amount, tip_is_manual, manual_tip_amount, big_turn_count, small_turn_count, first_big_turn_sequence, last_big_turn_sequence, first_small_turn_sequence, last_small_turn_sequence, total_earning, locked_at, payroll_batch_id",
        )
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
  salonId,
  supabase,
  workDate,
}: {
  salonId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  workDate: string;
}) {
  const { data, error } = await supabase
    .from("pos_ticket_staff_earnings")
    .select("id, locked_at, payroll_batch_id")
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

async function assertOpenedAtFinancialDateMutable(
  openedAt: string,
  context: CurrentBusinessContext,
) {
  await assertFinancialDateMutable(
    formatDateInTimeZone(openedAt, context.user?.timezone ?? "America/Chicago"),
    context,
    {
      lockedMessage: LOCKED_TICKET_DATE_MESSAGE,
      requireEditPermission: false,
      tryCreateSnapshot: false,
    },
  );
}

function buildTurnPartRows({
  itemId,
  parts,
  salonId,
  staffId,
  ticketId,
  workDate,
}: {
  itemId: string;
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
  parts,
  salonId,
  staffId,
  supabase,
  ticketId,
  workDate,
}: {
  itemId: string;
  parts: number[];
  salonId: string;
  staffId: string | null;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  ticketId: string;
  workDate: string;
}) {
  const turnRows = buildTurnPartRows({
    itemId,
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
      "salon_id, ticket_id, ticket_item_id, staff_id, amount, turn_type, turn_index, work_date",
    )
    .eq("ticket_item_id", itemId)
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
  const { context, supabase, salon } =
    await requirePosTicketMutationContext(editId);

  const { data: ticket, error } = await supabase
    .from("pos_tickets")
    .select("id, opened_at, status")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; opened_at: string; status: string }>();

  if (error || !ticket) {
    redirectWithError("POS Ticket is required.", editId, undefined, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", editId, undefined, undefined, returnPath);
  }

  try {
    await assertOpenedAtFinancialDateMutable(ticket.opened_at, context);
  } catch (error) {
    redirectWithError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
      editId,
      undefined,
      undefined,
      returnPath,
    );
  }
}

async function validateOpenPaymentTicket(
  ticketId: string,
  amount: number,
  returnPath = "/pos-tickets",
) {
  const { context, supabase, salon } =
    await requirePosTicketMutationContext(undefined);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, opened_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      opened_at: string;
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

  try {
    await assertOpenedAtFinancialDateMutable(ticket.opened_at, context);
  } catch (error) {
    redirectWithError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
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
  const { context, supabase, salon } =
    await requirePosTicketMutationContext(undefined);

  const { data: payment, error } = await supabase
    .from("pos_payments")
    .select("id, ticket_id, ticket:pos_tickets(id, opened_at, status)")
    .eq("id", paymentId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      ticket_id: string;
      ticket: { id: string; opened_at: string; status: string } | null;
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

  if (payment.ticket?.opened_at) {
    try {
      await assertOpenedAtFinancialDateMutable(payment.ticket.opened_at, context);
    } catch (error) {
      redirectWithError(
        getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
        undefined,
        undefined,
        payment.ticket_id,
        returnPath,
      );
    }
  }

  return payment;
}

async function validateOpenTicketItemRelationship(
  itemId: string,
  returnPath = "/pos-tickets",
) {
  const { context, supabase, salon } = await requirePosTicketMutationContext();

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
    .select("id, opened_at, status")
    .eq("id", item.pos_ticket_id)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; opened_at: string; status: string }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, itemId, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", undefined, itemId, undefined, returnPath);
  }

  try {
    await assertOpenedAtFinancialDateMutable(ticket.opened_at, context);
  } catch (error) {
    redirectWithError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
      undefined,
      itemId,
      undefined,
      returnPath,
    );
  }
}

async function validateCheckoutTicket(ticketId: string, returnPath = "/pos-tickets") {
  const { context, supabase, salon } =
    await requirePosTicketMutationContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, opened_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      opened_at: string;
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

  try {
    await assertOpenedAtFinancialDateMutable(ticket.opened_at, context);
  } catch (error) {
    redirectWithCheckoutError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
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
  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext();
  const input = validateCreateInput(formData);

  await validateCustomerRelationship(input.customerId);

  try {
    await assertFinancialDateMutable(
      formatDateInTimeZone(input.openedAt, user.timezone),
      context,
      {
        lockedMessage: LOCKED_TICKET_DATE_MESSAGE,
        requireEditPermission: false,
        tryCreateSnapshot: false,
      },
    );
  } catch (error) {
    redirectWithError(getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE));
  }

  const { error } = await supabase
    .from("pos_tickets")
    .insert({
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
      accountId: context.currentAccount?.id,
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
      accountId: context.currentAccount?.id,
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
    .select("id, status")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      status: string;
    }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", undefined, undefined, undefined, returnPath);
  }

  try {
    await assertTicketFinancialDateMutable(ticketId, context);
  } catch (error) {
    redirectWithError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
      undefined,
      undefined,
      undefined,
      returnPath,
    );
  }

  const { data: items, error: itemsError } = await supabase
    .from("pos_ticket_items")
    .select("line_total")
    .eq("pos_ticket_id", ticketId)
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
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket discount failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
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
    .select("id, status")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      status: string;
    }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", undefined, undefined, undefined, returnPath);
  }

  try {
    await assertTicketFinancialDateMutable(ticketId, context);
  } catch (error) {
    redirectWithError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
      undefined,
      undefined,
      undefined,
      returnPath,
    );
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({ tax_rate: taxRate })
    .eq("id", ticketId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket tax rate failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
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
    .select("id, status")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{
      id: string;
      status: string;
    }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "open") {
    redirectWithError("Only Open tickets can be edited.", undefined, undefined, undefined, returnPath);
  }

  try {
    await assertTicketFinancialDateMutable(ticketId, context);
  } catch (error) {
    redirectWithError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
      undefined,
      undefined,
      undefined,
      returnPath,
    );
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({
      tip_type: tipType,
      tip_value: tipValue,
    })
    .eq("id", ticketId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update POS ticket tip failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
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

  const { supabase, context, salon, user } =
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
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithCheckoutError(error.message, ticketId, returnPath);
  }

  try {
    await writePosTicketAuditLog({
      action: "ticket_checked_out",
      note: "Ticket checked out.",
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
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithCheckoutError(message, ticketId, returnPath);
  }

  try {
    await recalculateTicketStaffEarnings(ticketId);
  } catch (earningError) {
    const message =
      earningError instanceof Error
        ? earningError.message
        : "Unable to update Payroll staff earnings.";
    console.error("Supabase POS ticket staff earnings recalculation failed", {
      message,
      ticketId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithCheckoutError(message, ticketId, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath("/payroll");
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

  const { supabase, context, salon, user } =
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
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithError(error.message, ticketId);
  }

  try {
    await writePosTicketAuditLog({
      action: "ticket_cancelled",
      note,
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
      accountId: context.currentAccount?.id,
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

  const { supabase, context, salon, user } =
    await requirePosTicketVoidContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, opened_at, status")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; opened_at: string; status: string }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "closed") {
    redirectWithError("Only Closed tickets can be voided.", undefined, undefined, undefined, returnPath);
  }

  try {
    await assertOpenedAtFinancialDateMutable(ticket.opened_at, context);
  } catch (error) {
    redirectWithError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
      undefined,
      undefined,
      undefined,
      returnPath,
    );
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({ status: "voided" })
    .eq("id", ticketId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase void POS ticket failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  try {
    await writePosTicketAuditLog({
      action: "ticket_voided",
      note,
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
      accountId: context.currentAccount?.id,
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

  const { supabase, context, salon, user } =
    await requirePosTicketVoidContext(ticketId);

  const { data: ticket, error: ticketError } = await supabase
    .from("pos_tickets")
    .select("id, opened_at, status")
    .eq("id", ticketId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ id: string; opened_at: string; status: string }>();

  if (ticketError || !ticket) {
    redirectWithError("POS Ticket is required.", undefined, undefined, undefined, returnPath);
  }

  if (ticket.status !== "closed") {
    redirectWithError("Only Closed tickets can be reopened.", undefined, undefined, undefined, returnPath);
  }

  try {
    await assertOpenedAtFinancialDateMutable(ticket.opened_at, context);
  } catch (error) {
    redirectWithError(
      getSafeErrorMessage(error, LOCKED_TICKET_DATE_MESSAGE),
      undefined,
      undefined,
      undefined,
      returnPath,
    );
  }

  const { error } = await supabase
    .from("pos_tickets")
    .update({ status: "open", closed_at: null })
    .eq("id", ticketId)
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase reopen POS ticket failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ticketId,
      salonId: salon.id,
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, undefined, returnPath);
  }

  try {
    await writePosTicketAuditLog({
      action: "ticket_reopened",
      note,
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
      accountId: context.currentAccount?.id,
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

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext();

  await validateOpenTicketRelationship(ticketId, undefined, returnPath);
  await validateServiceRelationship(serviceId);

  const { error } = await supabase
    .from("pos_ticket_items")
    .insert({
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
      accountId: context.currentAccount?.id,
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

  const { context, supabase, salon, user } =
    await requireClosedTicketCorrectionContext(ticketId);

  try {
    const { data: item, error: itemError } = await supabase
      .from("pos_ticket_items")
      .select("id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, is_removed, created_at")
      .eq("id", itemId)
      .eq("salon_id", salon.id)
      .eq("pos_ticket_id", ticketId)
      .maybeSingle<{
        assigned_staff_id: string | null;
        created_at: string;
        id: string;
        is_removed: boolean;
        line_total: number;
        notes: string | null;
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
      .select("id, salon_id, opened_at, status")
      .eq("id", ticketId)
      .eq("salon_id", salon.id)
      .maybeSingle<{
        id: string;
        opened_at: string;
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
    await assertFinancialDateMutable(workDate, context, {
      lockedMessage: LOCKED_TICKET_DATE_MESSAGE,
      requireEditPermission: false,
      tryCreateSnapshot: false,
    });
    await assertWorkDateIsUnlocked({
      salonId: salon.id,
      supabase,
      workDate,
    });

    const beforeSnapshot = await loadClosedCorrectionSnapshot({
      salonId: salon.id,
      supabase,
      ticketId,
    });

    let action: "item_corrected" | "item_removed" | "item_replaced" = "item_corrected";
    let replacementItemId: string | null = null;
    const serviceChanged = serviceId !== item.service_id;
    const lineTotal = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;

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
        .eq("salon_id", salon.id);

      if (removeError) {
        throw removeError;
      }

      await rebuildCorrectionTurnParts({
        itemId: item.id,
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
            line_total: lineTotal,
            notes: item.notes,
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
          parts: Array.from({ length: Math.round(quantity) }, () => unitPrice),
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
          line_total: lineTotal,
          quantity,
          unit_price: unitPrice,
        })
        .eq("id", item.id)
        .eq("salon_id", salon.id);

      if (updateError) {
        throw updateError;
      }

      await rebuildCorrectionTurnParts({
        itemId: item.id,
        parts: Array.from({ length: Math.round(quantity) }, () => unitPrice),
        salonId: salon.id,
        staffId: assignedStaffId,
        supabase,
        ticketId,
        workDate,
      });
    }

    await recalculateStaffEarningsForDate(salon.id, workDate);

    const afterSnapshot = await loadClosedCorrectionSnapshot({
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
        reason,
        replacement_ticket_item_id: replacementItemId,
        salon_id: salon.id,
        ticket_id: ticketId,
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

function readLockedStaffCorrectionIntent(
  formData: FormData,
): LockedStaffCorrectionIntent {
  return readRequiredString(formData, "correction_intent") === "apply"
    ? "apply"
    : "request";
}

function getLockedCorrectionErrorMessage(error: unknown) {
  const message = getSafeErrorMessage(
    error,
    "Unable to submit staff correction.",
  );

  if (
    message.includes("pos_financial_correction_requests_correction_type_check") ||
    message.includes("correction_type")
  ) {
    return "Ticket corrections are not enabled in the database yet. Please run the latest migration and try again.";
  }

  return message;
}

function itemPartsOrFallback(
  item: ClosedTicketCurrentItemRow,
  partsByItemId: Map<string, number[]>,
) {
  const parts = partsByItemId.get(item.id);
  return parts?.length ? parts : [item.line_total];
}

function serviceCentsByStaffId(totalsByStaffId: Map<string, StaffCorrectionTotals>) {
  return new Map(
    Array.from(totalsByStaffId.entries()).map(([staffId, totals]) => [
      staffId,
      totals.serviceCents,
    ]),
  );
}

function buildCurrentStaffCorrectionTotals(input: {
  currentItems: ClosedTicketCurrentItemRow[];
  currentPartsByItemId: Map<string, number[]>;
  currentStaffEarnings: ClosedTicketStaffEarningRow[];
  ticket: ClosedTicketFinancialTicketRow;
}) {
  const totalsByStaffId = new Map<string, StaffCorrectionTotals>();

  for (const item of input.currentItems) {
    if (!item.assigned_staff_id) {
      continue;
    }

    const parts = itemPartsOrFallback(item, input.currentPartsByItemId);
    addStaffTotals(totalsByStaffId, item.assigned_staff_id, {
      serviceCents: finiteCents(sumParts(parts)),
      turnCount: parts.length,
    });
  }

  const currentTicketTotals = calculateTicketTotals({
    discountType: input.ticket.discount_type,
    discountValue: input.ticket.discount_value,
    items: input.currentItems.map((item) => ({
      line_total: sumParts(itemPartsOrFallback(item, input.currentPartsByItemId)),
    })),
    taxRate: input.ticket.tax_rate,
    tipType: input.ticket.tip_type,
    tipValue: input.ticket.tip_value,
  });
  const allocatedTipCentsByStaffId = allocateTipCentsByStaff(
    serviceCentsByStaffId(totalsByStaffId),
    finiteCents(currentTicketTotals.tip_amount),
  );

  for (const [staffId, tipCents] of allocatedTipCentsByStaffId.entries()) {
    addStaffTotals(totalsByStaffId, staffId, { tipCents });
  }

  for (const earning of input.currentStaffEarnings) {
    setStaffTotals(totalsByStaffId, earning.staff_id, {
      serviceCents: finiteCents(earning.service_total),
      tipCents: finiteCents(earning.tip_amount),
      turnCount:
        Number(earning.big_turn_count ?? 0) +
        Number(earning.small_turn_count ?? 0),
    });
  }

  return {
    ticketTipCents: finiteCents(currentTicketTotals.tip_amount),
    totalsByStaffId,
  };
}

function buildRequestedStaffCorrectionTotals(input: {
  currentStaffEarnings: ClosedTicketStaffEarningRow[];
  finalItems: Array<{ line_total: number; parts: number[]; staff_id: string }>;
  hasTipChange: boolean;
  manualOverrides: ClosedTicketStaffTipOverrideInput[];
  tipTotalCents: number;
}) {
  const totalsByStaffId = new Map<string, StaffCorrectionTotals>();

  for (const item of input.finalItems) {
    if (!item.staff_id) {
      continue;
    }

    addStaffTotals(totalsByStaffId, item.staff_id, {
      serviceCents: finiteCents(item.line_total),
      turnCount: item.parts.length,
    });
  }

  const finalStaffIdSet = new Set(totalsByStaffId.keys());
  const effectiveManualTipCentsByStaffId = new Map<string, number>();

  if (!input.hasTipChange) {
    for (const earning of input.currentStaffEarnings) {
      if (!earning.tip_is_manual || !finalStaffIdSet.has(earning.staff_id)) {
        continue;
      }

      effectiveManualTipCentsByStaffId.set(
        earning.staff_id,
        Math.max(
          0,
          finiteCents(earning.manual_tip_amount ?? earning.tip_amount ?? 0),
        ),
      );
    }
  }

  for (const override of input.manualOverrides) {
    effectiveManualTipCentsByStaffId.set(
      override.staff_id,
      Math.max(0, finiteCents(override.tip_amount)),
    );
  }

  const allocatedTipCentsByStaffId = allocateTipCentsByStaff(
    serviceCentsByStaffId(totalsByStaffId),
    input.tipTotalCents,
    effectiveManualTipCentsByStaffId,
  );

  for (const [staffId, tipCents] of allocatedTipCentsByStaffId.entries()) {
    addStaffTotals(totalsByStaffId, staffId, { tipCents });
  }

  return totalsByStaffId;
}

function serializeLockedTicketCurrentItems(
  currentItems: ClosedTicketCurrentItemRow[],
  currentPartsByItemId: Map<string, number[]>,
) {
  return currentItems.map((item) => {
    const parts = itemPartsOrFallback(item, currentPartsByItemId);

    return {
      itemId: item.id,
      lineTotal: sumParts(parts),
      parts,
      serviceId: item.service_id,
      staffId: item.assigned_staff_id,
    };
  });
}

function serializeLockedTicketRequestedItems(
  finalItems: Map<
    string,
    { line_total: number; parts: number[]; service_id: string | null; staff_id: string }
  >,
) {
  return Array.from(finalItems.entries()).map(([key, item]) => ({
    itemKey: key,
    lineTotal: item.line_total,
    parts: item.parts,
    serviceId: item.service_id,
    staffId: item.staff_id,
  }));
}

function serializeLockedTicketStaffTotals(
  totalsByStaffId: Map<string, StaffCorrectionTotals>,
) {
  return Array.from(totalsByStaffId.entries()).map(([staffId, totals]) => ({
    serviceAmount: fromCents(totals.serviceCents),
    staffId,
    tipAmount: fromCents(totals.tipCents),
    turnCount: totals.turnCount,
  }));
}

function serializeLockedTicketCorrectionDetails(
  corrections: StaffFinancialCorrection[],
) {
  return corrections.map((correction) => ({
    adjustment: correction.adjustment
      ? {
          expectedTotalDelta: fromCents(correction.adjustment.expectedTotalDelta),
          serviceDelta: fromCents(correction.adjustment.serviceDelta),
          tipDelta: fromCents(correction.adjustment.tipDelta),
          turnDelta: correction.adjustment.turnDelta,
        }
      : null,
    correctionType: correction.correctionType,
    moneyDelta: fromCents(correction.moneyDelta),
    oldValue: correction.oldValue,
    requestedValue: correction.requestedValue,
    staffId: correction.staffId,
  }));
}

function buildLockedTicketCorrectionAuditValues(input: {
  businessDate: string;
  corrections: StaffFinancialCorrection[];
  currentItems: ClosedTicketCurrentItemRow[];
  currentPartsByItemId: Map<string, number[]>;
  currentStaffTotalsByStaffId: Map<string, StaffCorrectionTotals>;
  currentTipCents: number;
  finalItems: Map<
    string,
    { line_total: number; parts: number[]; service_id: string | null; staff_id: string }
  >;
  requestedStaffTotalsByStaffId: Map<string, StaffCorrectionTotals>;
  requestedTipCents: number;
  ticket: ClosedTicketFinancialTicketRow;
}) {
  const correctionDetails = serializeLockedTicketCorrectionDetails(
    input.corrections,
  );
  const ticketDetails = {
    businessDate: input.businessDate,
    discountType: input.ticket.discount_type,
    discountValue: input.ticket.discount_value,
    taxRate: input.ticket.tax_rate,
    ticketId: input.ticket.id,
    tipType: input.ticket.tip_type,
  };

  return {
    oldValue: {
      corrections: correctionDetails,
      items: serializeLockedTicketCurrentItems(
        input.currentItems,
        input.currentPartsByItemId,
      ),
      staffTotals: serializeLockedTicketStaffTotals(
        input.currentStaffTotalsByStaffId,
      ),
      ticket: {
        ...ticketDetails,
        tipAmount: fromCents(input.currentTipCents),
        tipValue: input.ticket.tip_value,
      },
    },
    requestedValue: {
      corrections: correctionDetails,
      items: serializeLockedTicketRequestedItems(input.finalItems),
      staffTotals: serializeLockedTicketStaffTotals(
        input.requestedStaffTotalsByStaffId,
      ),
      ticket: {
        ...ticketDetails,
        tipAmount: fromCents(input.requestedTipCents),
        tipValue: fromCents(input.requestedTipCents),
      },
    },
  };
}

function aggregateLockedTicketAdjustmentRows(
  corrections: StaffFinancialCorrection[],
) {
  const totalsByStaffId = new Map<
    string,
    {
      expectedTotalDelta: number;
      serviceDelta: number;
      tipDelta: number;
      turnDelta: number;
    }
  >();

  for (const correction of corrections) {
    if (!correction.adjustment || !correction.staffId) {
      continue;
    }

    const existing = totalsByStaffId.get(correction.staffId) ?? {
      expectedTotalDelta: 0,
      serviceDelta: 0,
      tipDelta: 0,
      turnDelta: 0,
    };

    existing.expectedTotalDelta += correction.adjustment.expectedTotalDelta;
    existing.serviceDelta += correction.adjustment.serviceDelta;
    existing.tipDelta += correction.adjustment.tipDelta;
    existing.turnDelta += correction.adjustment.turnDelta;
    totalsByStaffId.set(correction.staffId, existing);
  }

  return Array.from(totalsByStaffId.entries()).map(([staffId, totals]) => ({
    ...totals,
    staffId,
    targetType: "staff_earning" as const,
  }));
}

async function insertLockedTicketFinancialCorrection(input: {
  businessDate: string;
  corrections: StaffFinancialCorrection[];
  intent: LockedStaffCorrectionIntent;
  oldValue: Record<string, unknown>;
  reason: string;
  requestedValue: Record<string, unknown>;
  salonId: string;
  supabase: PosTicketSupabaseClient;
  ticketId: string;
  userId: string;
}) {
  const { corrections, supabase } = input;
  const moneyDelta = corrections.reduce(
    (total, correction) => total + correction.moneyDelta,
    0,
  );
  const { data: request, error: requestError } = await supabase
    .from("pos_financial_correction_requests")
    .insert({
      business_date: input.businessDate,
      correction_type: "ticket_correction",
      money_delta: fromCents(moneyDelta),
      old_value_json: input.oldValue,
      reason: input.reason,
      requested_by: input.userId,
      requested_value_json: input.requestedValue,
      salon_id: input.salonId,
      status: "pending",
      target_id: input.ticketId,
      target_type: "pos_ticket",
    })
    .select("id")
    .single<{ id: string }>();

  if (requestError) {
    throw requestError;
  }

  if (input.intent !== "apply") {
    return request.id;
  }

  const adjustmentRows = aggregateLockedTicketAdjustmentRows(corrections);
  const rowsToInsert =
    adjustmentRows.length > 0
      ? adjustmentRows
      : [
          {
            expectedTotalDelta: 0,
            serviceDelta: 0,
            staffId: null,
            targetType: "pos_ticket" as const,
            tipDelta: 0,
            turnDelta: 0,
          },
        ];

  const { error: adjustmentError } = await supabase
    .from("pos_financial_adjustments")
    .insert(
      rowsToInsert.map((row) => ({
        business_date: input.businessDate,
        correction_request_id: request.id,
        created_by: input.userId,
        discount_delta: 0,
        expected_total_delta: fromCents(row.expectedTotalDelta),
        note: input.reason,
        salon_id: input.salonId,
        service_delta: fromCents(row.serviceDelta),
        staff_id: row.staffId,
        target_id: input.ticketId,
        target_type: row.targetType,
        ticket_id: input.ticketId,
        tip_delta: fromCents(row.tipDelta),
        turn_delta: row.turnDelta,
      })),
    );

  if (adjustmentError) {
    throw adjustmentError;
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("pos_financial_correction_requests")
    .update({
      applied_at: now,
      approved_at: now,
      approved_by: input.userId,
      status: "applied",
    })
    .eq("id", request.id)
    .eq("salon_id", input.salonId);

  if (updateError) {
    throw updateError;
  }

  return request.id;
}

async function insertLockedStaffCorrectionHistory(input: {
  correctionRequestIds: string[];
  corrections: StaffFinancialCorrection[];
  intent: LockedStaffCorrectionIntent;
  reason: string;
  salonId: string;
  supabase: PosTicketSupabaseClient;
  ticketId: string;
  ticketItemId: string | null;
  userId: string;
}) {
  const beforeSnapshot = await loadClosedCorrectionSnapshot({
    salonId: input.salonId,
    supabase: input.supabase,
    ticketId: input.ticketId,
  });
  const { error } = await input.supabase
    .from("pos_ticket_adjustments")
    .insert({
      action: "item_corrected",
      after_snapshot: {
        ...beforeSnapshot,
        financial_correction: {
          correction_request_ids: input.correctionRequestIds,
          corrections: input.corrections.map((correction) => ({
            adjustment: correction.adjustment,
            correctionType: correction.correctionType,
            oldValue: correction.oldValue,
            requestedValue: correction.requestedValue,
            staffId: correction.staffId,
          })),
          intent: input.intent,
        },
      },
      before_snapshot: beforeSnapshot,
      created_by: input.userId,
      reason: input.reason,
      replacement_ticket_item_id: null,
      salon_id: input.salonId,
      ticket_id: input.ticketId,
    });

  if (error) {
    throw error;
  }
}

export async function submitLockedStaffFinancialCorrection(formData: FormData) {
  const ticketId = readRequiredString(formData, "ticket_id");
  const returnPath = readReturnPath(formData);
  const reason = readRequiredString(formData, "correction_reason");

  if (!ticketId) {
    redirectWithError("Ticket id is required.", undefined, undefined, undefined, returnPath);
  }

  if (!reason) {
    redirectWithError(
      "Correction reason is required.",
      undefined,
      undefined,
      undefined,
      returnPath,
    );
  }

  const { context, supabase, salon, user } =
    await requireLockedStaffCorrectionContext(ticketId);

  try {
    const intent = readLockedStaffCorrectionIntent(formData);

    if (intent === "apply" && !(await canApplyFinancialCorrections(context))) {
      throw new Error("You do not have permission to apply financial corrections.");
    }

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
      .select("id, salon_id, opened_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value")
      .eq("id", ticketId)
      .eq("salon_id", salon.id)
      .maybeSingle<ClosedTicketFinancialTicketRow>();

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
    const isLocked = await isDailyClosingLocked(workDate, context);

    if (!isLocked) {
      throw new Error("Use the normal edit flow for editable business dates.");
    }

    const { data: currentItems, error: itemsError } = await supabase
      .from("pos_ticket_items")
      .select("id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, is_removed, created_at")
      .eq("salon_id", salon.id)
      .eq("pos_ticket_id", ticketId)
      .eq("is_removed", false)
      .returns<ClosedTicketCurrentItemRow[]>();

    if (itemsError) {
      throw itemsError;
    }

    const currentItemIds = (currentItems ?? []).map((item) => item.id);
    const currentPartsByItemId = new Map<string, number[]>();

    if (currentItemIds.length > 0) {
      const { data: currentParts, error: currentPartsError } = await supabase
        .from("pos_ticket_item_turn_parts")
        .select("ticket_item_id, amount, turn_index, created_at, id")
        .eq("salon_id", salon.id)
        .in("ticket_item_id", currentItemIds)
        .returns<ClosedTicketCurrentPartRow[]>();

      if (currentPartsError) {
        throw currentPartsError;
      }

      for (const part of [...(currentParts ?? [])].sort(
        (left, right) =>
          left.turn_index - right.turn_index ||
          new Date(left.created_at).getTime() -
            new Date(right.created_at).getTime() ||
          left.id.localeCompare(right.id),
      )) {
        currentPartsByItemId.set(part.ticket_item_id, [
          ...(currentPartsByItemId.get(part.ticket_item_id) ?? []),
          part.amount,
        ]);
      }
    }

    const currentItemById = new Map(
      (currentItems ?? []).map((item) => [item.id, item]),
    );
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
          .filter(
            (update) =>
              !update.remove &&
              update.service_id &&
              currentItemById.get(update.item_id)?.service_id !==
                update.service_id,
          )
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
        .eq("salon_id", salon.id)
        .eq("is_active", true)
        .in("id", serviceIds)
        .returns<Array<{ id: string }>>();

      if (serviceError) {
        throw serviceError;
      }

      if ((serviceRows ?? []).length !== serviceIds.length) {
        throw new Error(
          "New or changed correction services must be active in the current salon.",
        );
      }
    }

    if (staffIds.length > 0) {
      const { data: staffRows, error: staffError } = await supabase
        .from("staff")
        .select("id")
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
      { line_total: number; parts: number[]; service_id: string | null; staff_id: string }
    >();
    const oldAssignmentValues: Array<Record<string, unknown>> = [];
    const requestedAssignmentValues: Array<Record<string, unknown>> = [];
    const oldOtherValues: Array<Record<string, unknown>> = [];
    const requestedOtherValues: Array<Record<string, unknown>> = [];
    const serviceChangedStaffIds = new Set<string>();
    const turnChangedStaffIds = new Set<string>();

    for (const item of currentItems ?? []) {
      const parts =
        submittedItemPartsById.get(item.id) ?? itemPartsOrFallback(item, currentPartsByItemId);
      finalItems.set(item.id, {
        line_total: sumParts(parts),
        parts,
        service_id: item.service_id,
        staff_id: item.assigned_staff_id ?? "",
      });
    }

    for (const update of itemUpdates) {
      const currentItem = currentItemById.get(update.item_id);

      if (!currentItem) {
        continue;
      }

      if (update.remove) {
        finalItems.delete(update.item_id);
        addStaffId(serviceChangedStaffIds, currentItem.assigned_staff_id);
        addStaffId(turnChangedStaffIds, currentItem.assigned_staff_id);
        oldAssignmentValues.push({
          itemId: update.item_id,
          staffId: currentItem.assigned_staff_id,
        });
        requestedAssignmentValues.push({
          action: "removed",
          itemId: update.item_id,
          staffId: null,
        });
        continue;
      }

      const parts = normalizedUpdateParts.get(update.item_id) ?? [];
      const currentParts = itemPartsOrFallback(currentItem, currentPartsByItemId);
      const currentStaffId = currentItem.assigned_staff_id ?? "";
      const requestedStaffId = update.staff_id ?? "";
      finalItems.set(update.item_id, {
        line_total: sumParts(parts),
        parts,
        service_id: update.service_id,
        staff_id: requestedStaffId,
      });

      if (
        finiteCents(sumParts(currentParts)) !== finiteCents(sumParts(parts)) ||
        currentStaffId !== requestedStaffId
      ) {
        addStaffId(serviceChangedStaffIds, currentStaffId);
        addStaffId(serviceChangedStaffIds, requestedStaffId);
      }

      if (currentParts.length !== parts.length || currentStaffId !== requestedStaffId) {
        addStaffId(turnChangedStaffIds, currentStaffId);
        addStaffId(turnChangedStaffIds, requestedStaffId);
      }

      if (requestedStaffId !== currentStaffId) {
        oldAssignmentValues.push({
          itemId: update.item_id,
          staffId: currentItem.assigned_staff_id,
        });
        requestedAssignmentValues.push({
          itemId: update.item_id,
          staffId: requestedStaffId,
        });
      }

      if (update.service_id !== currentItem.service_id) {
        oldOtherValues.push({
          itemId: update.item_id,
          serviceId: currentItem.service_id,
        });
        requestedOtherValues.push({
          itemId: update.item_id,
          serviceId: update.service_id,
        });
      }
    }

    for (const [index, item] of addedItems.entries()) {
      const parts = normalizedAddedParts.get(index) ?? [];
      finalItems.set(`added-${index}`, {
        line_total: sumParts(parts),
        parts,
        service_id: item.service_id,
        staff_id: item.staff_id,
      });
      addStaffId(serviceChangedStaffIds, item.staff_id);
      addStaffId(turnChangedStaffIds, item.staff_id);
      oldAssignmentValues.push({
        itemId: null,
        staffId: null,
      });
      requestedAssignmentValues.push({
        action: "added",
        itemId: null,
        staffId: item.staff_id,
      });
      oldOtherValues.push({
        itemId: null,
        serviceId: null,
      });
      requestedOtherValues.push({
        action: "service_added",
        itemId: null,
        serviceId: item.service_id,
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

    const finalStaffIds = Array.from(new Set(finalStaffIdsWithRepeats));
    const finalStaffIdSet = new Set(finalStaffIds);
    const manualOverrides = staffTipOverrides.filter((override) => override.is_manual);
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

    const tipTotalCents = toCents(tipTotal);

    if (!Number.isFinite(tipTotalCents)) {
      throw new Error("Total tip must be zero or greater.");
    }

    const { data: currentStaffEarnings, error: currentStaffEarningsError } =
      await supabase
        .from("pos_ticket_staff_earnings")
        .select("staff_id, service_total, tip_amount, tip_is_manual, manual_tip_amount, big_turn_count, small_turn_count")
        .eq("salon_id", salon.id)
        .eq("ticket_id", ticketId)
        .returns<ClosedTicketStaffEarningRow[]>();

    if (currentStaffEarningsError) {
      throw currentStaffEarningsError;
    }

    const current = buildCurrentStaffCorrectionTotals({
      currentItems: currentItems ?? [],
      currentPartsByItemId,
      currentStaffEarnings: currentStaffEarnings ?? [],
      ticket,
    });
    const hasTipChange = current.ticketTipCents !== tipTotalCents;
    const requestedTotalsByStaffId = buildRequestedStaffCorrectionTotals({
      currentStaffEarnings: currentStaffEarnings ?? [],
      finalItems: Array.from(finalItems.values()),
      hasTipChange,
      manualOverrides,
      tipTotalCents,
    });

    const effectiveManualTipCents = manualOverrides.reduce(
      (total, override) => total + Math.max(0, finiteCents(override.tip_amount)),
      0,
    );

    if (effectiveManualTipCents > tipTotalCents) {
      throw new Error("Manual staff tips cannot exceed total tip.");
    }

    if (
      finalStaffIds.length > 0 &&
      manualOverrides.length === finalStaffIds.length &&
      effectiveManualTipCents !== tipTotalCents
    ) {
      throw new Error("Manual staff tips must equal total tip when all staff tips are manual.");
    }

    if (
      itemUpdates.length === 0 &&
      addedItems.length === 0 &&
      !hasTipChange &&
      staffTipOverrides.length === 0
    ) {
      throw new Error("Make at least one correction before saving.");
    }

    const { data: appliedAdjustments, error: appliedAdjustmentsError } =
      await supabase
        .from("pos_financial_adjustments")
        .select("staff_id, service_delta, tip_delta, turn_delta")
        .eq("salon_id", salon.id)
        .eq("business_date", workDate)
        .eq("ticket_id", ticketId)
        .not("staff_id", "is", null)
        .returns<
          Array<{
            service_delta: number;
            staff_id: string | null;
            tip_delta: number;
            turn_delta: number;
          }>
        >();

    if (appliedAdjustmentsError) {
      throw appliedAdjustmentsError;
    }

    for (const adjustment of appliedAdjustments ?? []) {
      if (!adjustment.staff_id) {
        continue;
      }

      addStaffTotals(current.totalsByStaffId, adjustment.staff_id, {
        serviceCents: finiteCents(adjustment.service_delta),
        tipCents: finiteCents(adjustment.tip_delta),
        turnCount: Number(adjustment.turn_delta ?? 0),
      });
    }

    const shouldEvaluateTipDelta =
      hasTipChange ||
      staffTipOverrides.length > 0 ||
      serviceChangedStaffIds.size > 0 ||
      turnChangedStaffIds.size > 0;
    const tipChangedStaffIds = shouldEvaluateTipDelta
      ? new Set([
          ...current.totalsByStaffId.keys(),
          ...requestedTotalsByStaffId.keys(),
        ])
      : new Set<string>();
    const corrections: StaffFinancialCorrection[] = [];
    const staffIdsForCorrections = new Set([
      ...current.totalsByStaffId.keys(),
      ...requestedTotalsByStaffId.keys(),
    ]);

    for (const staffId of staffIdsForCorrections) {
      const oldTotals = current.totalsByStaffId.get(staffId) ?? {
        serviceCents: 0,
        tipCents: 0,
        turnCount: 0,
      };
      const requestedTotals = requestedTotalsByStaffId.get(staffId) ?? {
        serviceCents: 0,
        tipCents: 0,
        turnCount: 0,
      };
      const serviceDelta = requestedTotals.serviceCents - oldTotals.serviceCents;
      const tipDelta = requestedTotals.tipCents - oldTotals.tipCents;
      const turnDelta = requestedTotals.turnCount - oldTotals.turnCount;

      if (serviceDelta !== 0 && serviceChangedStaffIds.has(staffId)) {
        corrections.push({
          adjustment: {
            expectedTotalDelta: serviceDelta,
            serviceDelta,
            tipDelta: 0,
            turnDelta: 0,
          },
          correctionType: "staff_service_amount",
          moneyDelta: serviceDelta,
          oldValue: {
            serviceAmount: fromCents(oldTotals.serviceCents),
            staffId,
            ticketId,
          },
          requestedValue: {
            serviceAmount: fromCents(requestedTotals.serviceCents),
            staffId,
            ticketId,
          },
          staffId,
        });
      }

      if (tipDelta !== 0 && tipChangedStaffIds.has(staffId)) {
        corrections.push({
          adjustment: {
            expectedTotalDelta: tipDelta,
            serviceDelta: 0,
            tipDelta,
            turnDelta: 0,
          },
          correctionType: "staff_tip",
          moneyDelta: tipDelta,
          oldValue: {
            staffId,
            ticketId,
            tipAmount: fromCents(oldTotals.tipCents),
          },
          requestedValue: {
            staffId,
            ticketId,
            tipAmount: fromCents(requestedTotals.tipCents),
          },
          staffId,
        });
      }

      if (turnDelta !== 0 && turnChangedStaffIds.has(staffId)) {
        corrections.push({
          adjustment: {
            expectedTotalDelta: 0,
            serviceDelta: 0,
            tipDelta: 0,
            turnDelta,
          },
          correctionType: "staff_turn_count",
          moneyDelta: 0,
          oldValue: {
            staffId,
            ticketId,
            turnCount: oldTotals.turnCount,
          },
          requestedValue: {
            staffId,
            ticketId,
            turnCount: requestedTotals.turnCount,
          },
          staffId,
        });
      }
    }

    if (requestedAssignmentValues.length > 0) {
      corrections.push({
        adjustment: null,
        correctionType: "ticket_staff_assignment",
        moneyDelta: 0,
        oldValue: { assignments: oldAssignmentValues, ticketId },
        requestedValue: { assignments: requestedAssignmentValues, ticketId },
        staffId: null,
      });
    }

    if (requestedOtherValues.length > 0) {
      corrections.push({
        adjustment: null,
        correctionType: "ticket_service",
        moneyDelta: 0,
        oldValue: { serviceChanges: oldOtherValues, ticketId },
        requestedValue: { serviceChanges: requestedOtherValues, ticketId },
        staffId: null,
      });
    }

    if (corrections.length === 0) {
      throw new Error("Make at least one correction before saving.");
    }

    const auditValues = buildLockedTicketCorrectionAuditValues({
      businessDate: workDate,
      corrections,
      currentItems: currentItems ?? [],
      currentPartsByItemId,
      currentStaffTotalsByStaffId: current.totalsByStaffId,
      currentTipCents: current.ticketTipCents,
      finalItems,
      requestedStaffTotalsByStaffId: requestedTotalsByStaffId,
      requestedTipCents: tipTotalCents,
      ticket,
    });
    const correctionRequestId = await insertLockedTicketFinancialCorrection({
      businessDate: workDate,
      corrections,
      intent,
      oldValue: auditValues.oldValue,
      reason,
      requestedValue: auditValues.requestedValue,
      salonId: salon.id,
      supabase,
      ticketId,
      userId: user.id,
    });

    await insertLockedStaffCorrectionHistory({
      correctionRequestIds: [correctionRequestId],
      corrections,
      intent,
      reason,
      salonId: salon.id,
      supabase,
      ticketId,
      ticketItemId: itemUpdates[0]?.item_id ?? null,
      userId: user.id,
    });
  } catch (error) {
    const message = getLockedCorrectionErrorMessage(error);
    console.error("Supabase locked staff financial correction failed", {
      message,
      salonId: salon.id,
      ticketId,
      userId: user.id,
    });
    redirectWithError(message, undefined, undefined, undefined, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath("/reports");
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

  const { context, supabase, salon, user } =
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
      .select("id, salon_id, opened_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value")
      .eq("id", ticketId)
      .eq("salon_id", salon.id)
      .maybeSingle<{
        discount_type: "fixed_amount" | "percentage";
        discount_value: number;
        id: string;
        opened_at: string;
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
    await assertFinancialDateMutable(workDate, context, {
      lockedMessage: LOCKED_TICKET_DATE_MESSAGE,
      requireEditPermission: false,
      tryCreateSnapshot: false,
    });
    await assertWorkDateIsUnlocked({
      salonId: salon.id,
      supabase,
      workDate,
    });

    const { data: currentItems, error: itemsError } = await supabase
      .from("pos_ticket_items")
      .select("id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, is_removed, created_at")
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
          .filter(
            (update) =>
              !update.remove &&
              update.service_id &&
              currentItemById.get(update.item_id)?.service_id !==
                update.service_id,
          )
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
        .eq("salon_id", salon.id)
        .eq("is_active", true)
        .in("id", serviceIds)
        .returns<Array<{ id: string }>>();

      if (serviceError) {
        throw serviceError;
      }

      if ((serviceRows ?? []).length !== serviceIds.length) {
        throw new Error(
          "New or changed correction services must be active in the current salon.",
        );
      }
    }

    if (staffIds.length > 0) {
      const { data: staffRows, error: staffError } = await supabase
        .from("staff")
        .select("id")
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

    const tipTotalCents = toCents(tipTotal);

    if (!Number.isFinite(tipTotalCents)) {
      throw new Error("Total tip must be zero or greater.");
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
    const shouldUpdateTicketTip =
      ticket.tip_type !== "fixed_amount" || toCents(ticket.tip_value) !== tipTotalCents;

    const { data: currentStaffEarnings, error: currentStaffEarningsError } =
      await supabase
        .from("pos_ticket_staff_earnings")
        .select("staff_id, tip_amount, tip_is_manual, manual_tip_amount")
        .eq("salon_id", salon.id)
        .eq("ticket_id", ticketId)
        .returns<
          Array<{
            manual_tip_amount: number | null;
            staff_id: string;
            tip_amount: number;
            tip_is_manual: boolean;
          }>
        >();

    if (currentStaffEarningsError) {
      throw currentStaffEarningsError;
    }

    const effectiveManualTipCentsByStaffId = new Map<string, number>();

    if (!hasTipChange) {
      for (const earning of currentStaffEarnings ?? []) {
        if (!earning.tip_is_manual || !finalStaffIdSet.has(earning.staff_id)) {
          continue;
        }

        effectiveManualTipCentsByStaffId.set(
          earning.staff_id,
          Math.max(0, toCents(earning.manual_tip_amount ?? earning.tip_amount ?? 0)),
        );
      }
    }

    for (const override of manualOverrides) {
      effectiveManualTipCentsByStaffId.set(
        override.staff_id,
        Math.max(0, toCents(override.tip_amount)),
      );
    }

    const effectiveManualTipCents = Array.from(
      effectiveManualTipCentsByStaffId.values(),
    ).reduce((total, tipCentsForStaff) => total + tipCentsForStaff, 0);

    if (effectiveManualTipCents > tipTotalCents) {
      throw new Error("Manual staff tips cannot exceed total tip.");
    }

    if (
      finalStaffIds.length > 0 &&
      effectiveManualTipCentsByStaffId.size === finalStaffIds.length &&
      effectiveManualTipCents !== tipTotalCents
    ) {
      throw new Error("Manual staff tips must equal total tip when all staff tips are manual.");
    }

    if (itemUpdates.length === 0 && addedItems.length === 0 && !hasTipChange && !hasManualTipChange) {
      throw new Error("Make at least one correction before saving.");
    }

    const beforeSnapshot = await loadClosedCorrectionSnapshot({
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
            line_total: lineTotal,
            notes: currentItem.notes,
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
          .eq("salon_id", salon.id);

        if (removeError) {
          throw removeError;
        }

        await rebuildCorrectionTurnParts({
          itemId: currentItem.id,
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
          .eq("salon_id", salon.id);

        if (removeError) {
          throw removeError;
        }

        await rebuildCorrectionTurnParts({
          itemId: currentItem.id,
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
            line_total: lineTotal,
            quantity: 1,
            unit_price: lineTotal,
          })
          .eq("id", currentItem.id)
          .eq("salon_id", salon.id);

        if (updateError) {
          throw updateError;
        }

        await rebuildCorrectionTurnParts({
          itemId: currentItem.id,
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
            line_total: lineTotal,
            quantity: 1,
            unit_price: lineTotal,
          })
          .eq("id", currentItem.id)
          .eq("salon_id", salon.id);

        if (unchangedUpdateError) {
          throw unchangedUpdateError;
        }

        await rebuildCorrectionTurnParts({
          itemId: currentItem.id,
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
          line_total: lineTotal,
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
        parts,
        salonId: salon.id,
        staffId: addedItem.staff_id,
        supabase,
        ticketId,
        workDate,
      });
    }

    if (shouldUpdateTicketTip) {
      const { error: tipError } = await supabase.rpc(
        "update_closed_pos_ticket_tip_for_correction",
        {
          p_ticket_id: ticketId,
          p_tip_type: "fixed_amount",
          p_tip_value: tipTotal,
        },
      );

      if (tipError) {
        throw new Error(tipError.message);
      }
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
        reason,
        replacement_ticket_item_id: replacementItemIds[0] ?? null,
        salon_id: salon.id,
        ticket_id: ticketId,
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
      accountId: context.currentAccount?.id,
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
      accountId: context.currentAccount?.id,
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

  await validateOpenTicketItemRelationship(itemId, returnPath);

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
      accountId: context.currentAccount?.id,
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

  const { supabase, context, salon, user } =
    await requirePosTicketMutationContext();
  const note = readOptionalString(formData, "note");

  await validateOpenPaymentTicket(ticketId, amount, returnPath);

  const { error } = await supabase
    .from("pos_payments")
    .insert({
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
      accountId: context.currentAccount?.id,
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
      accountId: context.currentAccount?.id,
      userId: user.id,
    });
    redirectWithError(error.message, undefined, undefined, payment.ticket_id, returnPath);
  }

  revalidatePath("/pos-tickets");
  revalidatePath(returnPath);
  redirectAfterMutation(returnPath);
}
