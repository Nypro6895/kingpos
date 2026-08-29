"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCurrentBusinessContext,
  getRouteForInvalidSalonContext,
  isSalonManageContext,
} from "@/lib/current-context";
import {
  issueCustomerClaimTokenForTicket,
  type CustomerClaimOffer,
} from "@/lib/customer-identity-claims";
import {
  cancelCustomerVisit,
  completeCustomerVisitForTicket,
  resolveCustomerDisplaySubmission,
  selectCustomerVisitForLiveDraft,
  updateCustomerVisitRequestedServices,
} from "@/lib/customer-visits";
import { requirePermission } from "@/lib/permissions";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import { POS_DESK_DEFAULTS } from "@/lib/pos-desk";
import { getTurnType, parsePosAmountInput } from "@/lib/pos-desk-amounts";
import { broadcastPosLiveDraftSnapshot } from "@/lib/pos-live-draft-realtime-server";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import {
  getCurrentSalonPosSettings,
  getPublicPosDisplaySettingsByToken,
} from "@/lib/pos-settings";
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
  CustomerDisplayVisit,
  CustomerVisitRequestedService,
  CustomerVisitStatus,
} from "@/types/customer-visit";
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
  | {
      customerClaim?: never;
      error: string;
      ok: false;
      ticketId?: never;
      ticketNumber?: never;
    }
  | {
      customerClaim: CustomerClaimOffer | null;
      error?: never;
      ok: true;
      ticketId: string;
      ticketNumber: string;
    };

export type CustomerDisplayTipOption = {
  amount: number;
  percentage: number;
};

export type CustomerDisplayPhoneResult =
  | {
      mode: "check_in";
      state: "already_checked_in" | "checked_in";
      visit: CustomerDisplayVisit;
    }
  | {
      mode: "checkout";
      snapshot: PosLiveDraftView;
      visit: CustomerDisplayVisit | null;
    };

type CustomerDisplayPhoneActionResult =
  | { data: CustomerDisplayPhoneResult; ok: true }
  | {
      code?: string;
      error: string;
      mode?: "check_in" | "checkout";
      ok: false;
    };

type WaitingVisitActionResult =
  | {
      data: {
        snapshot?: PosLiveDraftView;
        status?: CustomerVisitStatus | null;
        visit?: CustomerDisplayVisit | null;
        visitId?: string | null;
      };
      ok: true;
    }
  | { error: string; ok: false };

const CUSTOMER_DISPLAY_COMPLETED_RESET_DELAY_MS = 30 * 1000;
const LIVE_DRAFT_SELECT =
  "id, salon_id, token, customer, staff_lines, selected_staff_id, tip, subtotal, discount, tax, total_before_tip, total, status, version, customer_version, receipt_version, completed_at, reset_at, last_customer_action_id, last_tip_action_id, customer_handoff_started_at, updated_at";

const SESSION_SELECT = `
  id,
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

async function broadcastWaitingChangeByLiveDraftToken(token: string) {
  const result = await getPosLiveDraft(token);

  if (result.ok && result.data?.salon_id) {
    await broadcastPosStaffChange(result.data.salon_id, "waiting");
  }
}

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
  completed_at: string | null;
  customer: PosLiveDraftCustomer | null;
  customer_handoff_started_at?: string | null;
  customer_version: number;
  discount: number;
  id: string;
  last_customer_action_id: string | null;
  last_tip_action_id: string | null;
  receipt_version: number;
  reset_at: string | null;
  selected_staff_id: string | null;
  salon_id: string;
  server_now?: string | null;
  staff_lines: PosLiveDraftReceiptLine[] | null;
  status: PosLiveDraftView["status"];
  subtotal: number;
  tax: number;
  tip: number;
  token: string;
  total: number;
  total_before_tip: number;
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

function normalizeRequestedService(
  value: unknown,
): CustomerVisitRequestedService | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const id = typeof payload.id === "string" ? payload.id : "";
  const name = typeof payload.name === "string" ? payload.name : "";

  if (!id || !name) {
    return null;
  }

  const basePrice = Number(payload.basePrice ?? payload.base_price ?? 0);
  const durationMinutes = Number(
    payload.durationMinutes ?? payload.duration_minutes ?? 0,
  );
  const sortOrder = Number(payload.sortOrder ?? payload.sort_order ?? 1);

  return {
    basePrice: Number.isFinite(basePrice) ? basePrice : 0,
    category: typeof payload.category === "string" ? payload.category : null,
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : 0,
    id,
    name,
    sortOrder: Math.max(
      1,
      Math.round(Number.isFinite(sortOrder) ? sortOrder : 1),
    ),
  };
}

function normalizeRequestedServices(
  value: unknown,
): CustomerVisitRequestedService[] {
  return Array.isArray(value)
    ? value
        .map(normalizeRequestedService)
        .filter(
          (service): service is CustomerVisitRequestedService =>
            Boolean(service),
        )
    : [];
}

function normalizeLiveDraftCustomer(
  customer: PosLiveDraftCustomer | null,
): PosLiveDraftCustomer | null {
  if (!customer) {
    return null;
  }

  return {
    id: customer.id ?? null,
    name: customer.name,
    phone: customer.phone ?? null,
    requestedServices: normalizeRequestedServices(customer.requestedServices),
    visitId: customer.visitId ?? null,
  };
}

function toLiveDraftView(raw: RawLiveDraft): PosLiveDraftView {
  const tip = Number(raw.tip ?? 0);
  const total = Number(raw.total ?? 0);
  const totalBeforeTip =
    Number(raw.total_before_tip ?? Number.NaN) ||
    roundMoney(Math.max(0, total - tip));

  return {
    completed_at: raw.completed_at ?? null,
    customer: normalizeLiveDraftCustomer(raw.customer),
    customer_handoff_started_at: raw.customer_handoff_started_at ?? null,
    customer_version: Number(raw.customer_version ?? 0),
    discount: Number(raw.discount ?? 0),
    id: raw.id,
    last_customer_action_id: raw.last_customer_action_id ?? null,
    last_tip_action_id: raw.last_tip_action_id ?? null,
    receipt_version: Number(raw.receipt_version ?? 0),
    reset_at: raw.reset_at ?? null,
    selected_staff_id: raw.selected_staff_id,
    salon_id: raw.salon_id,
    server_now: raw.server_now ?? new Date().toISOString(),
    staff_lines: normalizeLiveDraftStaffLines(raw.staff_lines),
    status: raw.status,
    subtotal: Number(raw.subtotal ?? 0),
    tax: Number(raw.tax ?? 0),
    tip,
    token: raw.token,
    total,
    total_before_tip: totalBeforeTip,
    updated_at: raw.updated_at,
    version: Number(raw.version),
  };
}

function getLiveDraftTipBase(liveDraft: PosLiveDraftView | null) {
  if (!liveDraft) {
    return 0;
  }

  if (liveDraft.total_before_tip > 0) {
    return liveDraft.total_before_tip;
  }

  return Math.max(0, liveDraft.total - liveDraft.tip);
}

function hasActiveLiveDraftHandoff(input: {
  staffLines: PosLiveDraftReceiptLine[];
  subtotal: number;
  totalBeforeTip: number;
}) {
  return (
    input.staffLines.some((line) => Number(line.amount) > 0) ||
    Number(input.subtotal) > 0 ||
    Number(input.totalBeforeTip) > 0
  );
}

function getCustomerDisplayTipAmounts(input: {
  liveDraft: PosLiveDraftView | null;
  tipSuggestions: number[];
}): CustomerDisplayTipOption[] {
  const base = getLiveDraftTipBase(input.liveDraft);
  const percentages = input.tipSuggestions
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 3);
  const source = percentages.length > 0 ? percentages : [15, 18, 20];

  return source.map((percentage) => ({
    amount: roundMoney((base * percentage) / 100),
    percentage,
  }));
}

async function resetExpiredLiveDraftForPos(input: {
  raw: RawLiveDraft;
  salonId: string;
  supabase: PosDeskSupabaseClient;
}) {
  if (
    input.raw.status !== "closed" ||
    !input.raw.reset_at ||
    new Date(input.raw.reset_at).getTime() > Date.now()
  ) {
    return input.raw;
  }

  const { data, error } = await input.supabase
    .from("pos_live_drafts")
    .update({
      completed_at: null,
      customer: null,
      customer_handoff_started_at: null,
      discount: 0,
      last_customer_action_id: null,
      last_tip_action_id: null,
      receipt: {},
      reset_at: null,
      selected_staff_id: null,
      staff_lines: [],
      status: "draft",
      subtotal: 0,
      tax: 0,
      tip: 0,
      total: 0,
      total_before_tip: 0,
      version: Number(input.raw.version) + 1,
    })
    .eq("id", input.raw.id)
    .eq("salon_id", input.salonId)
    .select(LIVE_DRAFT_SELECT)
    .single<RawLiveDraft>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function requirePosDeskMutationContext() {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect("/login");
  }

  if (!isSalonManageContext(context)) {
    redirect(getRouteForInvalidSalonContext(context));
  }

  if (!context.currentAccount) {
    throw new Error("Choose a salon workspace before using POS Desk.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  await requirePermission(POS_TICKET_PERMISSIONS.manage, context);

  return {
    context,
    Account: context.currentAccount,
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
  const { Account, salon, supabase } = await requirePosDeskMutationContext();

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
    const normalizedPhone = normalizePhoneForIdentity(lookup);

    if (normalizedPhone) {
      const { data, error } = await supabase.rpc("search_salon_customers", {
        p_limit: 1,
        p_offset: 0,
        p_query: lookup,
        p_salon_id: salon.id,
        p_status: "active",
      });

      if (error) {
        throw new Error(error.message);
      }

      const customer = ((data ?? []) as PosDeskCustomer[])[0];

      if (customer) {
        return {
          email: customer.email,
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
        };
      }
    }

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
      accountId: Account.id,
      salonId: salon.id,
    });
    throw new Error(error.message);
  }

  return data;
}

async function maybeIssueCustomerClaimOffer(input: {
  customerId: string;
  supabase: PosDeskSupabaseClient;
  ticketId: string;
}) {
  return issueCustomerClaimTokenForTicket({
    customerId: input.customerId,
    supabase: input.supabase,
    ticketId: input.ticketId,
  });
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

type PosDeskSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

async function getSalonBusinessDate(input: {
  fallbackTimezone?: string | null;
  salonId: string;
  supabase: PosDeskSupabaseClient;
}) {
  const { data, error } = await input.supabase.rpc("get_salon_business_date", {
    p_salon_id: input.salonId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return typeof data === "string" && data
    ? data
    : getTodayDate(input.fallbackTimezone ?? undefined);
}

async function validatePosStaffIds(input: {
  salonId: string;
  staffIds: string[];
  supabase: PosDeskSupabaseClient;
}) {
  const staffIds = Array.from(
    new Set(
      input.staffIds
        .map(cleanOptional)
        .filter((staffId): staffId is string => Boolean(staffId)),
    ),
  );

  if (staffIds.length === 0) {
    return;
  }

  const { data: staffRows, error: staffError } = await input.supabase
    .from("staff")
    .select("id")
    .eq("salon_id", input.salonId)
    .eq("is_active", true)
    .eq("pos_enabled", true)
    .in("id", staffIds)
    .returns<Array<{ id: string }>>();

  if (staffError) {
    throw new Error(staffError.message);
  }

  if ((staffRows ?? []).length !== staffIds.length) {
    throw new Error("Assigned staff must be active and enabled for POS.");
  }
}

async function validateWorkingStaffIds(input: {
  salonId: string;
  staffIds: string[];
  supabase: PosDeskSupabaseClient;
  workDate: string;
}) {
  const staffIds = Array.from(
    new Set(
      input.staffIds
        .map(cleanOptional)
        .filter((staffId): staffId is string => Boolean(staffId)),
    ),
  );

  if (staffIds.length === 0) {
    return;
  }

  const { data: workdayRows, error } = await input.supabase
    .from("staff_workdays")
    .select("staff_id")
    .eq("salon_id", input.salonId)
    .eq("work_date", input.workDate)
    .eq("status", "working")
    .in("staff_id", staffIds)
    .returns<Array<{ staff_id: string }>>();

  if (error) {
    throw new Error(error.message);
  }

  if ((workdayRows ?? []).length !== staffIds.length) {
    throw new Error("Assigned staff must be checked in and working.");
  }
}

async function validateSubmitLineScope(input: {
  lines: PosDeskSubmitLine[];
  requireWorkingStaff?: boolean;
  salonId: string;
  supabase: PosDeskSupabaseClient;
  workDate?: string;
}) {
  const staffIds = Array.from(new Set(input.lines.map((line) => line.staffId)));
  const serviceIds = Array.from(
    new Set(
      input.lines
        .map((line) => cleanOptional(line.serviceId))
        .filter((serviceId): serviceId is string => Boolean(serviceId)),
    ),
  );

  await validatePosStaffIds({
    salonId: input.salonId,
    staffIds,
    supabase: input.supabase,
  });

  if (input.requireWorkingStaff) {
    if (!input.workDate) {
      throw new Error("Work date is required to validate checked-in staff.");
    }

    await validateWorkingStaffIds({
      salonId: input.salonId,
      staffIds,
      supabase: input.supabase,
      workDate: input.workDate,
    });
  }

  if (serviceIds.length === 0) {
    return;
  }

  const { data: serviceRows, error: serviceError } = await input.supabase
    .from("services")
    .select("id")
    .eq("salon_id", input.salonId)
    .eq("is_active", true)
    .in("id", serviceIds)
    .returns<Array<{ id: string }>>();

  if (serviceError) {
    throw new Error(serviceError.message);
  }

  if ((serviceRows ?? []).length !== serviceIds.length) {
    throw new Error("Selected services must be active in the current salon.");
  }
}

async function finalizeLiveDraftForPos(input: {
  salonId: string;
  supabase: PosDeskSupabaseClient;
  token?: string | null;
}): Promise<PosLiveDraftView | null> {
  const token = cleanOptional(input.token);

  if (!token) {
    return null;
  }

  const { data: existing, error: existingError } = await input.supabase
    .from("pos_live_drafts")
    .select("id, version")
    .eq("token", token)
    .eq("salon_id", input.salonId)
    .maybeSingle<{ id: string; version: number }>();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (!existing) {
    return null;
  }

  const completedAt = new Date();
  const resetAt = new Date(
    completedAt.getTime() + CUSTOMER_DISPLAY_COMPLETED_RESET_DELAY_MS,
  );
  const { data, error } = await input.supabase
    .from("pos_live_drafts")
    .update({
      completed_at: completedAt.toISOString(),
      customer_handoff_started_at: null,
      reset_at: resetAt.toISOString(),
      status: "closed",
      version: Number(existing.version) + 1,
    })
    .eq("id", existing.id)
    .eq("salon_id", input.salonId)
    .select(LIVE_DRAFT_SELECT)
    .single<RawLiveDraft>();

  if (error) {
    throw new Error(error.message);
  }

  return toLiveDraftView(data);
}

async function createTicketFromSubmitInput(
  input: PosDeskSubmitInput,
  sessionId?: string | null,
): Promise<PosDeskActionResult> {
  try {
    const { context, salon, supabase, user } =
      await requirePosDeskMutationContext();
    const settings = await getCurrentSalonPosSettings(context);
    validateSubmitLines(input.lines);
    const workDate = await getSalonBusinessDate({
      fallbackTimezone: context.user?.timezone,
      salonId: salon.id,
      supabase,
    });
    await validateSubmitLineScope({
      lines: input.lines,
      requireWorkingStaff: settings.staffCheckInEnabled,
      salonId: salon.id,
      supabase,
      workDate,
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
    const { data: ticket, error: ticketError } = await supabase
      .from("pos_tickets")
      .insert({
        customer_id: customer.id,
        notes: cleanOptional(input.note),
        opened_at: now,
        salon_id: salon.id,
        status: "open",
        tax_rate: settings.taxEnabled ? 0 : 0,
        tip_type: "fixed_amount",
        tip_value: tipAmount,
      })
      .select("id, salon_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at")
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
          pos_ticket_id: ticket.id,
          quantity: 1,
          salon_id: salon.id,
          service_id: cleanOptional(line.serviceId),
          unit_price: line.total,
        })
        .select("id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, created_at, updated_at, service:services(id, name, category, base_price, duration_minutes), assigned_staff:staff(id, display_name, job_title)")
        .single<PosTicketItemWithRelations>();

      if (itemError) {
        throw new Error(itemError.message);
      }

      insertedItems.push(item);

      const turnRows = line.amountParts.map((amount, partIndex) => ({
        amount,
        salon_id: salon.id,
        staff_id: line.staffId,
        ticket_id: ticket.id,
        ticket_item_id: item.id,
        turn_index: partIndex + 1,
        turn_type: getTurnType(amount, settings.largeTurnThreshold),
        work_date: workDate,
      }));

      const { error: turnError } = await supabase
        .from("pos_ticket_item_turn_parts")
        .insert(turnRows);

      if (turnError) {
        throw new Error(turnError.message);
      }

      const largeTurnDelta = turnRows.filter(
        (row) => row.turn_type === "large",
      ).length;

      if (largeTurnDelta > 0) {
        const { error: queueError } = await supabase.rpc(
          "increment_staff_queue_turns",
          {
            p_delta: largeTurnDelta,
            p_salon_id: salon.id,
            p_staff_id: line.staffId,
            p_work_date: workDate,
          },
        );

        if (queueError) {
          throw new Error(queueError.message);
        }
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
        payment_method: "other",
        salon_id: salon.id,
        ticket_id: ticket.id,
      })
      .select("id, salon_id, ticket_id, payment_method, amount, note, created_by, created_at")
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
        salon_id: salon.id,
        ticket_id: ticket.id,
      });

    if (auditError) {
      throw new Error(auditError.message);
    }

    try {
      const visitResult = await completeCustomerVisitForTicket({
        customerId: customer.id,
        preferredVisitId: cleanOptional(input.customerVisitId),
        salonId: salon.id,
        supabase,
        ticketId: ticket.id,
      });

      if (visitResult.ok && visitResult.appointmentId) {
        revalidatePath("/bookings");
      }
    } catch (visitError) {
      console.error("Unable to complete customer visit after POS submit", {
        error: visitError instanceof Error ? visitError.message : visitError,
        salonId: salon.id,
        ticketId: ticket.id,
      });
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
        .eq("salon_id", salon.id);

      if (sessionError) {
        throw new Error(sessionError.message);
      }
    }

    try {
      const finalizedDraft = await finalizeLiveDraftForPos({
        salonId: salon.id,
        supabase,
        token: input.liveDraftToken,
      });
      if (finalizedDraft) {
        await broadcastPosLiveDraftSnapshot(finalizedDraft, "pos");
      }
    } catch (draftError) {
      console.error("Unable to finalize POS live draft after submit", {
        error: draftError instanceof Error ? draftError.message : draftError,
        salonId: salon.id,
      });
    }

    await recalculateStaffEarningsForDate(salon.id, workDate);
    await broadcastPosStaffChange(salon.id, "pos");

    const customerClaim = await maybeIssueCustomerClaimOffer({
      customerId: customer.id,
      supabase,
      ticketId: ticket.id,
    });

    revalidatePath("/pos");
    revalidatePath("/pos-tickets");
    revalidatePath("/staff/today");
    revalidatePath("/staff/my-work");

    return {
      customerClaim,
      ok: true,
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
    };
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
    const { salon, supabase, user } = await requirePosDeskMutationContext();
    const now = new Date();
    const { data, error } = await supabase
      .from("pos_desk_sessions")
      .insert({
        created_by: user.id,
        customer_display_token: randomUUID().replaceAll("-", ""),
        expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
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

  const { data, error } = await supabase.rpc("search_salon_customers", {
    p_limit: 10,
    p_offset: 0,
    p_query: trimmed,
    p_salon_id: salon.id,
    p_status: "active",
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as PosDeskCustomer[]).map((customer) => ({
    email: customer.email,
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
  }));
}

export async function getOrCreatePosLiveDraft(): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();

    const existing = await supabase
      .from("pos_live_drafts")
      .select(LIVE_DRAFT_SELECT)
      .eq("salon_id", salon.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<RawLiveDraft>();

    if (existing.error) {
      throw new Error(existing.error.message);
    }

    if (existing.data) {
      const raw = await resetExpiredLiveDraftForPos({
        raw: existing.data,
        salonId: salon.id,
        supabase,
      });
      return { data: toLiveDraftView(raw), ok: true };
    }

    const inserted = await supabase
      .from("pos_live_drafts")
      .insert({
        receipt: {},
        salon_id: salon.id,
        staff_lines: [],
        subtotal: 0,
        tip: 0,
        token: randomUUID().replaceAll("-", ""),
        total: 0,
        total_before_tip: 0,
      })
      .select(LIVE_DRAFT_SELECT)
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

export async function getCustomerDisplayServiceCatalog(
  token: string,
): Promise<CustomerVisitRequestedService[]> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase || !cleanOptional(token)) {
      return [];
    }

    const { data, error } = await supabase.rpc(
      "get_customer_display_service_catalog",
      {
        p_token: token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return normalizeRequestedServices(data);
  } catch (error) {
    console.error("Unable to load customer display service catalog", {
      error: error instanceof Error ? error.message : error,
    });
    return [];
  }
}

export async function saveCustomerDisplayRequestedServices(input: {
  serviceIds: string[];
  token: string;
  visitId: string;
}): Promise<CustomerDisplayPhoneActionResult> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const result = await updateCustomerVisitRequestedServices({
      serviceIds: input.serviceIds,
      supabase,
      token: input.token,
      visitId: input.visitId,
    });

    if (!result.ok) {
      return {
        code: result.code,
        error: result.message,
        mode: result.mode,
        ok: false,
      };
    }

    if (!result.visit) {
      throw new Error("Unable to load your check-in.");
    }

    revalidatePath("/pos");
    revalidatePath("/pos/portable");
    revalidatePath("/staff/today");
    await broadcastWaitingChangeByLiveDraftToken(input.token);

    return {
      data: {
        mode: "check_in",
        state: result.state ?? "checked_in",
        visit: result.visit,
      },
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to save service request. Please ask the front desk.",
      ok: false,
    };
  }
}

export async function resetCustomerDisplayCompletedDraft(input: {
  token: string;
}): Promise<ActionResult<PosLiveDraftView | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "reset_completed_pos_live_draft",
      {
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return { data: null, ok: true };
    }

    const snapshot = toLiveDraftView(data as RawLiveDraft);
    await broadcastPosLiveDraftSnapshot(snapshot, "customer_display");

    return { data: snapshot, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to reset customer display.",
      ok: false,
    };
  }
}

export async function touchCustomerDisplayLiveDraftActivity(input: {
  resetSeconds?: number;
  token: string;
}): Promise<ActionResult<PosLiveDraftView | null>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc("touch_pos_live_draft_activity", {
      p_reset_seconds: Math.round(input.resetSeconds ?? 180),
      p_token: input.token,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return { data: null, ok: true };
    }

    const snapshot = toLiveDraftView(data as RawLiveDraft);
    await broadcastPosLiveDraftSnapshot(snapshot, "system");

    return { data: snapshot, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to update display activity.",
      ok: false,
    };
  }
}

export async function updatePosActiveDraft(input: {
  discount?: number;
  selectedStaffId: string | null;
  staffLines: PosLiveDraftReceiptLine[];
  subtotal: number;
  tax?: number;
  tip: number;
  token: string;
  total: number;
  totalBeforeTip?: number;
}): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    const { data: existing, error: existingError } = await supabase
      .from("pos_live_drafts")
      .select("id, receipt_version, status, version")
      .eq("token", input.token)
      .eq("salon_id", salon.id)
      .single<{
        id: string;
        receipt_version: number;
        status: PosLiveDraftView["status"];
        version: number;
      }>();

    if (existingError) {
      throw new Error(existingError.message);
    }

    const wasCompleted = existing.status !== "draft";
    const totalBeforeTip =
      Number.isFinite(input.totalBeforeTip) && Number(input.totalBeforeTip) >= 0
        ? roundMoney(Number(input.totalBeforeTip))
        : roundMoney(Math.max(0, input.total - input.tip));
    const normalizedStaffLines = normalizeLiveDraftStaffLines(input.staffLines);
    const handoffStartedAt = hasActiveLiveDraftHandoff({
      staffLines: normalizedStaffLines,
      subtotal: roundMoney(input.subtotal),
      totalBeforeTip,
    })
      ? new Date().toISOString()
      : null;
    const { data, error } = await supabase
      .from("pos_live_drafts")
      .update({
        completed_at: null,
        customer: wasCompleted ? null : undefined,
        customer_handoff_started_at: handoffStartedAt,
        discount: roundMoney(input.discount ?? 0),
        last_customer_action_id: wasCompleted ? null : undefined,
        last_tip_action_id: wasCompleted ? null : undefined,
        receipt_version: Number(existing.receipt_version) + 1,
        reset_at: null,
        selected_staff_id: input.selectedStaffId,
        staff_lines: normalizedStaffLines,
        status: "draft",
        subtotal: roundMoney(input.subtotal),
        tax: roundMoney(input.tax ?? 0),
        tip: roundMoney(input.tip),
        total: roundMoney(input.total),
        total_before_tip: totalBeforeTip,
        version: Number(existing.version) + 1,
      })
      .eq("id", existing.id)
      .select(LIVE_DRAFT_SELECT)
      .single<RawLiveDraft>();

    if (error) {
      throw new Error(error.message);
    }

    const snapshot = toLiveDraftView(data);
    await broadcastPosLiveDraftSnapshot(snapshot, "pos");

    return { data: snapshot, ok: true };
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
      .select("customer_version, id, status, version")
      .eq("token", input.token)
      .eq("salon_id", salon.id)
      .single<{
        customer_version: number;
        id: string;
        status: PosLiveDraftView["status"];
        version: number;
      }>();

    if (existingError) {
      throw new Error(existingError.message);
    }

    const customerId = cleanOptional(input.customer?.id);

    if (customerId) {
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .select("id")
        .eq("id", customerId)
        .eq("location_id", salon.id)
        .eq("status", "active")
        .maybeSingle<{ id: string }>();

      if (customerError || !customer) {
        throw new Error("Selected customer must belong to the current salon.");
      }
    }

    const { data, error } = await supabase
      .from("pos_live_drafts")
      .update({
        completed_at: null,
        customer: input.customer,
        customer_version: Number(existing.customer_version) + 1,
        last_customer_action_id: null,
        reset_at: null,
        status: "draft",
        version: Number(existing.version) + 1,
      })
      .eq("id", existing.id)
      .select(LIVE_DRAFT_SELECT)
      .single<RawLiveDraft>();

    if (error) {
      throw new Error(error.message);
    }

    const snapshot = toLiveDraftView(data);
    await broadcastPosLiveDraftSnapshot(snapshot, "pos");

    return { data: snapshot, ok: true };
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
        accountId: context.currentAccount?.id,
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

export async function searchCustomerDisplayLiveDraftCustomers(input: {
  phone: string;
  token: string;
}): Promise<ActionResult<PosLiveDraftCustomer[]>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "search_pos_live_draft_customers_by_phone",
      {
        p_phone: input.phone,
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return { data: (data ?? []) as PosLiveDraftCustomer[], ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to search customer.",
      ok: false,
    };
  }
}

export async function getCustomerDisplayLiveDraftTipOptions(input: {
  token: string;
}): Promise<ActionResult<CustomerDisplayTipOption[]>> {
  try {
    const [snapshotResult, settings] = await Promise.all([
      getPosLiveDraft(input.token),
      getPublicPosDisplaySettingsByToken(input.token),
    ]);

    if (!snapshotResult.ok) {
      throw new Error(snapshotResult.error);
    }

    return {
      data: getCustomerDisplayTipAmounts({
        liveDraft: snapshotResult.data,
        tipSuggestions: settings.tipSuggestions,
      }),
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to load tip options.",
      ok: false,
    };
  }
}

export async function submitCustomerDisplayPhone(input: {
  name?: string | null;
  phone: string;
  requestId?: string | null;
  token: string;
}): Promise<CustomerDisplayPhoneActionResult> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const result = await resolveCustomerDisplaySubmission({
      customerName: cleanOptional(input.name),
      phone: input.phone,
      requestId: cleanOptional(input.requestId),
      supabase,
      token: input.token,
    });

    if (!result.ok) {
      return {
        code: result.code,
        error: result.message,
        mode: result.mode,
        ok: false,
      };
    }

    if (result.mode === "checkout") {
      if (!result.snapshot) {
        throw new Error("This checkout session is no longer active.");
      }

      const snapshot = toLiveDraftView(result.snapshot as RawLiveDraft);
      await broadcastPosLiveDraftSnapshot(snapshot, "customer_display");
      await broadcastPosStaffChange(snapshot.salon_id, "waiting");
      revalidatePath("/pos");
      revalidatePath("/pos/portable");
      revalidatePath("/staff/today");

      return {
        data: {
          mode: "checkout",
          snapshot,
          visit: result.visit,
        },
        ok: true,
      };
    }

    if (!result.visit) {
      throw new Error("Unable to load your check-in.");
    }

    revalidatePath("/pos");
    revalidatePath("/pos/portable");
    revalidatePath("/staff/today");
    revalidatePath("/bookings");
    await broadcastWaitingChangeByLiveDraftToken(input.token);

    return {
      data: {
        mode: "check_in",
        state: result.state ?? "checked_in",
        visit: result.visit,
      },
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to continue. Please ask the front desk.",
      ok: false,
    };
  }
}

export async function selectWaitingVisitForPos(input: {
  token: string;
  visitId: string;
}): Promise<WaitingVisitActionResult> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    const token = cleanOptional(input.token);
    const visitId = cleanOptional(input.visitId);

    if (!token || !visitId) {
      throw new Error("Choose a waiting client first.");
    }

    const result = await selectCustomerVisitForLiveDraft({
      supabase,
      token,
      visitId,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }

    const snapshot = toLiveDraftView(result.snapshot as RawLiveDraft);
    await broadcastPosLiveDraftSnapshot(snapshot, "pos");
    await broadcastPosStaffChange(salon.id, "waiting");

    revalidatePath("/pos");
    revalidatePath("/pos/portable");
    revalidatePath("/staff/today");

    return {
      data: {
        snapshot,
        visit: result.visit,
      },
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to select waiting client.",
      ok: false,
    };
  }
}

export async function cancelWaitingVisitForPos(input: {
  visitId: string;
}): Promise<WaitingVisitActionResult> {
  try {
    const { salon, supabase } = await requirePosDeskMutationContext();
    const visitId = cleanOptional(input.visitId);

    if (!visitId) {
      throw new Error("Choose a waiting client first.");
    }

    const result = await cancelCustomerVisit({
      reason: "Removed from POS waiting list.",
      supabase,
      visitId,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }

    revalidatePath("/pos");
    revalidatePath("/pos/portable");
    revalidatePath("/staff/today");
    await broadcastPosStaffChange(salon.id, "waiting");

    return {
      data: {
        status: result.status,
        visitId: result.visitId,
      },
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to remove waiting client.",
      ok: false,
    };
  }
}

export async function confirmCustomerDisplayLiveDraftCustomer(input: {
  customerId: string;
  requestId: string;
  token: string;
}): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { data, error } = await supabase.rpc(
      "confirm_pos_live_draft_customer",
      {
        p_customer_id: input.customerId,
        p_request_id: input.requestId,
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("This checkout session is no longer active.");
    }

    const snapshot = toLiveDraftView(data as RawLiveDraft);
    await broadcastPosLiveDraftSnapshot(snapshot, "customer_display");

    return { data: snapshot, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to confirm customer.",
      ok: false,
    };
  }
}

export async function createCustomerDisplayLiveDraftCustomer(input: {
  name: string;
  phone: string;
  requestId: string;
  token: string;
}): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    const { error } = await supabase.rpc(
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

    const snapshotResult = await getPosLiveDraft(input.token);

    if (!snapshotResult.ok || !snapshotResult.data) {
      throw new Error(
        snapshotResult.ok
          ? "This checkout session is no longer active."
          : snapshotResult.error,
      );
    }

    const snapshot = snapshotResult.data;
    await broadcastPosLiveDraftSnapshot(snapshot, "customer_display");

    return { data: snapshot, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to create customer.",
      ok: false,
    };
  }
}

export async function confirmCustomerDisplayLiveDraftTip(input: {
  requestId: string;
  tipAmount: number;
  token: string;
}): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const supabase = createSupabaseServerClient();

    if (!supabase) {
      throw new Error("Supabase environment variables are missing.");
    }

    if (!Number.isFinite(input.tipAmount) || input.tipAmount < 0) {
      throw new Error("Tip must be zero or greater.");
    }

    const { data, error } = await supabase.rpc("confirm_pos_live_draft_tip", {
      p_request_id: input.requestId,
      p_tip_amount: roundMoney(input.tipAmount),
      p_token: input.token,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("This checkout session is no longer active.");
    }

    const snapshot = toLiveDraftView(data as RawLiveDraft);
    await broadcastPosLiveDraftSnapshot(snapshot, "customer_display");

    return { data: snapshot, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to confirm tip.",
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
    const { salon, supabase } = await requirePosDeskMutationContext();
    const session = await requireActiveSession(input.sessionId);
    const parsed = parsePosAmountInput(input.amountInput);

    if (!parsed.isValid) {
      throw new Error(parsed.error);
    }

    if (!input.staffId) {
      throw new Error("Select assigned staff.");
    }

    await validatePosStaffIds({
      salonId: salon.id,
      staffIds: [input.staffId],
      supabase,
    });

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
    const { salon, supabase } = await requirePosDeskMutationContext();
    const existingSession = await requireActiveSession(input.sessionId);

    if (input.lines.length > 0) {
      validateSubmitLines(input.lines);
      await validateSubmitLineScope({
        lines: input.lines,
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
    const { context, salon, supabase, user } =
      await requirePosDeskMutationContext();
    const settings = await getCurrentSalonPosSettings(context);
    const session = await requirePendingConfirmedSession(sessionId);

    if (session.lines.length === 0) {
      throw new Error("Add at least one receipt line before submit.");
    }

    const workDate = await getSalonBusinessDate({
      fallbackTimezone: context.user?.timezone,
      salonId: salon.id,
      supabase,
    });

    await validatePosStaffIds({
      salonId: salon.id,
      staffIds: session.lines.map((line) => line.staff_id),
      supabase,
    });

    if (settings.staffCheckInEnabled) {
      await validateWorkingStaffIds({
        salonId: salon.id,
        staffIds: session.lines.map((line) => line.staff_id),
        supabase,
        workDate,
      });
    }

    const customer = await findOrCreateDeskCustomer({
      customerId: session.customer_id,
      customerLookup: session.customer_lookup_value,
      customerName: session.customer_name_snapshot,
    });

    const now = new Date().toISOString();
    const { data: ticket, error: ticketError } = await supabase
      .from("pos_tickets")
      .insert({
        customer_id: customer.id,
        notes: cleanOptional(session.note),
        opened_at: now,
        salon_id: salon.id,
        status: "open",
        tax_rate: POS_DESK_DEFAULTS.taxEnabled ? 0 : 0,
        tip_type: "fixed_amount",
        tip_value: session.tip_amount,
      })
      .select("id, salon_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at")
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
          pos_ticket_id: ticket.id,
          quantity: 1,
          salon_id: salon.id,
          service_id: line.service_id,
          unit_price: line.amount,
        })
        .select("id, salon_id, pos_ticket_id, service_id, assigned_staff_id, quantity, unit_price, line_total, notes, created_at, updated_at, service:services(id, name, category, base_price, duration_minutes), assigned_staff:staff(id, display_name, job_title)")
        .single<PosTicketItemWithRelations>();

      if (itemError) {
        throw new Error(itemError.message);
      }

      insertedItems.push(item);

      const turnRows = line.amount_parts.map((amount, partIndex) => ({
        amount,
        salon_id: salon.id,
        staff_id: line.staff_id,
        ticket_id: ticket.id,
        ticket_item_id: item.id,
        turn_index: partIndex + 1,
        turn_type: getTurnType(amount, settings.largeTurnThreshold),
        work_date: workDate,
      }));

      const { error: turnError } = await supabase
        .from("pos_ticket_item_turn_parts")
        .insert(turnRows);

      if (turnError) {
        throw new Error(turnError.message);
      }

      const largeTurnDelta = turnRows.filter(
        (row) => row.turn_type === "large",
      ).length;

      if (largeTurnDelta > 0) {
        const { error: queueError } = await supabase.rpc(
          "increment_staff_queue_turns",
          {
            p_delta: largeTurnDelta,
            p_salon_id: salon.id,
            p_staff_id: line.staff_id,
            p_work_date: workDate,
          },
        );

        if (queueError) {
          throw new Error(queueError.message);
        }
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
        payment_method: "other",
        salon_id: salon.id,
        ticket_id: ticket.id,
      })
      .select("id, salon_id, ticket_id, payment_method, amount, note, created_by, created_at")
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
        salon_id: salon.id,
        ticket_id: ticket.id,
      });

    if (auditError) {
      throw new Error(auditError.message);
    }

    try {
      const visitResult = await completeCustomerVisitForTicket({
        customerId: customer.id,
        preferredVisitId: null,
        salonId: salon.id,
        supabase,
        ticketId: ticket.id,
      });

      if (visitResult.ok && visitResult.appointmentId) {
        revalidatePath("/bookings");
      }
    } catch (visitError) {
      console.error("Unable to complete customer visit after session submit", {
        error: visitError instanceof Error ? visitError.message : visitError,
        salonId: salon.id,
        ticketId: ticket.id,
      });
    }

    const { error: sessionError } = await supabase
      .from("pos_desk_sessions")
      .update({
        last_activity_at: new Date().toISOString(),
        status: "submitted",
        submitted_ticket_id: ticket.id,
      })
      .eq("id", session.id)
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
    await broadcastPosStaffChange(salon.id, "pos");

    const customerClaim = await maybeIssueCustomerClaimOffer({
      customerId: customer.id,
      supabase,
      ticketId: ticket.id,
    });

    revalidatePath("/pos");
    revalidatePath("/pos-tickets");
    revalidatePath("/staff/today");
    revalidatePath("/staff/my-work");

    return {
      customerClaim,
      ok: true,
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
    };
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
    const { salon, supabase } = await requirePosDeskMutationContext();
    validateSubmitLines(input.lines);
    await validateSubmitLineScope({
      lines: input.lines,
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
    const { salon, supabase } = await requirePosDeskMutationContext();
    const existingSession = await requireActiveSession(input.sessionId);
    validateSubmitLines(input.lines);
    await validateSubmitLineScope({
      lines: input.lines,
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
