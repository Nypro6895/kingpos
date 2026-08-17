"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPosLiveDraft } from "@/app/pos/actions";
import { POS_DESK_DEFAULTS } from "@/lib/pos-desk";
import {
  DEFAULT_PORTABLE_POS_CAPABILITIES,
  PORTABLE_POS_CAPABILITIES,
  type PortablePosCapability,
} from "@/lib/pos-portable-capabilities";
import { broadcastPosLiveDraftSnapshot } from "@/lib/pos-live-draft-realtime-server";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import {
  getPosDeskDefaults,
  normalizePosSettingsPayload,
} from "@/lib/pos-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTodayDate } from "@/lib/staff-workdays";
import type {
  CustomerDisplayVisit,
  CustomerVisitQueueItem,
  CustomerVisitRequestedService,
  CustomerVisitSource,
  CustomerVisitStatus,
} from "@/types/customer-visit";
import type {
  PosDeskCustomer,
  PosDeskService,
  PosDeskStaff,
  PosDeskSubmitInput,
  PosLiveDraftCustomer,
  PosLiveDraftReceiptLine,
  PosLiveDraftView,
} from "@/types/pos-desk";

const PORTABLE_POS_KEY_ID_COOKIE = "kingpos-portable-pos-key-id";
const PORTABLE_POS_SIGNATURE_COOKIE = "kingpos-portable-pos-session";
const PORTABLE_POS_REMEMBERED_ID_COOKIE =
  "kingpos-portable-pos-remembered-id";
const CUSTOMER_DISPLAY_COMPLETED_RESET_SECONDS = 30;

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
      customerClaim: null;
      error?: never;
      ok: true;
      ticketId: string;
      ticketNumber: string;
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

export type PortablePosLoginState = {
  error: string | null;
};

export type PortablePosSession = {
  access_id: string;
  capabilities: PortablePosCapability[];
  key_id: string;
  salon_id: string;
  salon_name: string;
};

type PortablePosSignInResult = PortablePosSession & {
  signature: string;
};

type PortableDeskRpcData = {
  liveDraft: PosLiveDraftView | null;
  salonName: string;
  settings?: unknown;
  services: PosDeskService[];
  staff: PosDeskStaff[];
  waitingVisits?: unknown;
};

export type PortableTodayStaffRow = {
  displayName: string;
  id: string;
  jobTitle: string | null;
  largeTurns: number;
  smallTurns: number;
  status: string;
  totalTurns: number;
};

export type PortableCheckInStaffRow = {
  checkInAt: string | null;
  checkInSequence: number | null;
  displayName: string;
  id: string;
  isPasscodeDefault: boolean;
  jobTitle: string | null;
  queueTurnCount: number;
  status: string;
};

export type PortableCheckInData = {
  checkInEnabled: boolean;
  salonId: string;
  salonName: string;
  staff: PortableCheckInStaffRow[];
  today: string;
  timezone: string;
};

export type PortableAttendanceEventInput = {
  eventType: "CHECK_IN" | "CHECK_OUT" | "LEAVE_OUT" | "RETURN_TO_WORK";
  passcode: string;
  staffId: string;
};

export type PortableTurnAdjustmentInput = {
  delta: number;
  operatorPasscode: string;
  operatorStaffId: string;
  reason: string;
  targetStaffId: string;
};

export type PortableTodayData = {
  currentTotal: number;
  openReceiptLines: number;
  salonName: string;
  staff: PortableTodayStaffRow[];
  today: string;
};

export type PortableTicketRow = {
  closedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  discountAmount: number;
  id: string;
  openedAt: string;
  paid: number;
  remaining: number;
  serviceCount: number;
  status: string;
  subtotal: number;
  taxAmount: number;
  ticketNumber: string;
  ticketSequence: number;
  tipAmount: number;
  total: number;
};

export type PortableTicketData = {
  date: string;
  salonName: string;
  setupMessage: string | null;
  tickets: PortableTicketRow[];
  timezone: string;
};

export type PortableBookAppointment = {
  customerName: string | null;
  customerPhone: string | null;
  endAt: string;
  id: string;
  serviceNames: string[];
  staffName: string | null;
  startAt: string;
  status: string;
};

export type PortableBookData = {
  appointments: PortableBookAppointment[];
  canCancel: boolean;
  canCreate: boolean;
  date: string;
  salonName: string;
  services: PosDeskService[];
  setupMessage: string | null;
  staff: PosDeskStaff[];
  timezone: string;
};

export type PortableReportData = {
  closingInputs: {
    cashAmount: number;
    creditCardAmount: number;
    note: string | null;
    otherAmount: number;
    status: string;
  };
  lock: {
    isLocked: boolean;
    status: string;
  };
  reportDate: string;
  salonName: string;
  setupMessage: string | null;
  timezone: string;
  totals: {
    actualTotal: number;
    discounts: number;
    difference: number;
    expectedTotal: number;
    finalizedTicketCount: number;
    reconciliationStatus: "balanced" | "over" | "short";
    serviceCount: number;
    taxes: number;
    ticketCount: number;
    tips: number;
  };
};

export type PortableReportClosingSaveInput = {
  cashAmount: string;
  creditCardAmount: string;
  note?: string | null;
  otherAmount: string;
  reportDate: string;
};

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  };
}

function normalizePortableCapabilities(value: unknown): PortablePosCapability[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PORTABLE_POS_CAPABILITIES];
  }

  const allowed = new Set<string>(Object.values(PORTABLE_POS_CAPABILITIES));
  const capabilities = value.filter(
    (item): item is PortablePosCapability =>
      typeof item === "string" && allowed.has(item),
  );

  return [...new Set(capabilities)];
}

function normalizePortableSession(value: unknown): PortablePosSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const accessId = typeof payload.access_id === "string" ? payload.access_id : "";
  const keyId = typeof payload.key_id === "string" ? payload.key_id : "";
  const salonId = typeof payload.salon_id === "string" ? payload.salon_id : "";
  const salonName =
    typeof payload.salon_name === "string" ? payload.salon_name : "";

  if (!accessId || !keyId || !salonId || !salonName) {
    return null;
  }

  return {
    access_id: accessId,
    capabilities: normalizePortableCapabilities(payload.capabilities),
    key_id: keyId,
    salon_id: salonId,
    salon_name: salonName,
  };
}

function hasPortableCapability(
  session: PortablePosSession,
  capability: PortablePosCapability,
) {
  return session.capabilities.includes(capability);
}

function normalizePortableNumber(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;

  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizePortableString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizePortableNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizePortableRequestedService(
  value: unknown,
): CustomerVisitRequestedService | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const id = normalizePortableString(payload.id);
  const name = normalizePortableString(payload.name);

  if (!id || !name) {
    return null;
  }

  return {
    basePrice: normalizePortableNumber(
      payload.basePrice ?? payload.base_price,
    ),
    category: normalizePortableNullableString(payload.category),
    durationMinutes: normalizePortableNumber(
      payload.durationMinutes ?? payload.duration_minutes,
    ),
    id,
    name,
    sortOrder: Math.max(
      1,
      Math.round(
        normalizePortableNumber(payload.sortOrder ?? payload.sort_order) || 1,
      ),
    ),
  };
}

function normalizePortableRequestedServices(
  value: unknown,
): CustomerVisitRequestedService[] {
  return Array.isArray(value)
    ? value
        .map(normalizePortableRequestedService)
        .filter(
          (service): service is CustomerVisitRequestedService =>
            Boolean(service),
        )
    : [];
}

const PORTABLE_VISIT_SOURCES = new Set<CustomerVisitSource>([
  "appointment",
  "customer_screen",
  "walk_in",
]);
const PORTABLE_VISIT_STATUSES = new Set<CustomerVisitStatus>([
  "cancelled",
  "checkout",
  "completed",
  "in_service",
  "waiting",
]);

function normalizePortableVisitSource(value: unknown): CustomerVisitSource {
  return typeof value === "string" &&
    PORTABLE_VISIT_SOURCES.has(value as CustomerVisitSource)
    ? (value as CustomerVisitSource)
    : "customer_screen";
}

function normalizePortableVisitStatus(value: unknown): CustomerVisitStatus {
  return typeof value === "string" &&
    PORTABLE_VISIT_STATUSES.has(value as CustomerVisitStatus)
    ? (value as CustomerVisitStatus)
    : "waiting";
}

function normalizePortableWaitingVisit(
  value: unknown,
): CustomerVisitQueueItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const checkedInAt = normalizePortableString(payload.checkedInAt);
  const customerId = normalizePortableString(payload.customerId);
  const customerName = normalizePortableString(payload.customerName);
  const id = normalizePortableString(payload.id);
  const salonId = normalizePortableString(payload.salonId);

  if (!checkedInAt || !customerId || !customerName || !id || !salonId) {
    return null;
  }

  return {
    appointmentId: normalizePortableNullableString(payload.appointmentId),
    appointmentStartAt: normalizePortableNullableString(
      payload.appointmentStartAt,
    ),
    assignedStaffId: normalizePortableNullableString(payload.assignedStaffId),
    assignedStaffName: normalizePortableNullableString(payload.assignedStaffName),
    checkedInAt,
    customerId,
    customerName,
    customerPhone: normalizePortableNullableString(payload.customerPhone),
    id,
    requestedServices: normalizePortableRequestedServices(
      payload.requestedServices,
    ),
    salonId,
    serviceLabel: normalizePortableNullableString(payload.serviceLabel),
    source: normalizePortableVisitSource(payload.source),
    status: normalizePortableVisitStatus(payload.status),
    ticketId: normalizePortableNullableString(payload.ticketId),
  };
}

function normalizePortableWaitingVisits(value: unknown) {
  return Array.isArray(value)
    ? value
        .map(normalizePortableWaitingVisit)
        .filter((visit): visit is CustomerVisitQueueItem => Boolean(visit))
    : [];
}

function normalizePortableDisplayVisit(
  value: unknown,
): CustomerDisplayVisit | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const checkedInAt = normalizePortableString(payload.checkedInAt);
  const customerId = normalizePortableString(payload.customerId);
  const id = normalizePortableString(payload.id);

  if (!checkedInAt || !customerId || !id) {
    return null;
  }

  return {
    appointmentId: normalizePortableNullableString(payload.appointmentId),
    checkedInAt,
    customerId,
    firstName: normalizePortableNullableString(payload.firstName),
    id,
    requestedServices: normalizePortableRequestedServices(
      payload.requestedServices,
    ),
    source: normalizePortableVisitSource(payload.source),
    status: normalizePortableVisitStatus(payload.status),
    ticketId: normalizePortableNullableString(payload.ticketId),
  };
}

function readPortableResultPayload(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizePortableTicket(value: unknown): PortableTicketRow | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const id = normalizePortableString(payload.id);
  const openedAt = normalizePortableString(payload.openedAt);

  if (!id || !openedAt) {
    return null;
  }

  return {
    closedAt: normalizePortableNullableString(payload.closedAt),
    customerName: normalizePortableNullableString(payload.customerName),
    customerPhone: normalizePortableNullableString(payload.customerPhone),
    discountAmount: normalizePortableNumber(payload.discountAmount),
    id,
    openedAt,
    paid: normalizePortableNumber(payload.paid),
    remaining: normalizePortableNumber(payload.remaining),
    serviceCount: normalizePortableNumber(payload.serviceCount),
    status: normalizePortableString(payload.status) || "open",
    subtotal: normalizePortableNumber(payload.subtotal),
    taxAmount: normalizePortableNumber(payload.taxAmount),
    ticketNumber: normalizePortableString(payload.ticketNumber) || "Ticket",
    ticketSequence: normalizePortableNumber(payload.ticketSequence),
    tipAmount: normalizePortableNumber(payload.tipAmount),
    total: normalizePortableNumber(payload.total),
  };
}

function normalizePortableReportClosingInputs(value: unknown) {
  const payload =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    cashAmount: normalizePortableNumber(payload.cashAmount),
    creditCardAmount: normalizePortableNumber(payload.creditCardAmount),
    note: normalizePortableNullableString(payload.note),
    otherAmount: normalizePortableNumber(payload.otherAmount),
    status: normalizePortableString(payload.status) || "draft",
  };
}

function normalizePortableReportLock(value: unknown) {
  const payload =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    isLocked: Boolean(payload.isLocked),
    status: normalizePortableString(payload.status) || "draft",
  };
}

function normalizePortableReconciliationStatus(
  value: unknown,
): PortableReportData["totals"]["reconciliationStatus"] {
  return value === "balanced" || value === "over" || value === "short"
    ? value
    : "short";
}

function parsePortableCurrencyToCents(value: string, label: string) {
  const normalized = value.trim().replaceAll(",", "").replace(/^\$/, "");

  if (!normalized) {
    return 0;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} must be a valid non-negative money amount.`);
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be a valid non-negative money amount.`);
  }

  const cents = Math.round(amount * 100);

  if (cents > 999_999_999_999) {
    throw new Error(`${label} is too large.`);
  }

  return cents;
}

function centsToPortableMoney(cents: number) {
  return Math.round(cents) / 100;
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readPortableReturnTo(formData: FormData) {
  const value = readString(formData, "return_to");

  if (value === "/pos/customer-display") {
    return value;
  }

  return "/pos/portable";
}

function normalizeLiveDraftStaffLines(
  lines: PosLiveDraftReceiptLine[] | null,
): PosLiveDraftReceiptLine[] {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines
    .map((line, index) => ({
      amount: Number(line.amount) || 0,
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
    requestedServices: normalizePortableRequestedServices(
      customer.requestedServices,
    ),
    visitId: customer.visitId ?? null,
  };
}

function normalizeLiveDraft(value: PosLiveDraftView | null): PosLiveDraftView | null {
  if (!value) {
    return null;
  }

  const tip = Number(value.tip ?? 0);
  const total = Number(value.total ?? 0);

  return {
    completed_at: value.completed_at ?? null,
    customer: normalizeLiveDraftCustomer(value.customer),
    customer_handoff_started_at: value.customer_handoff_started_at ?? null,
    customer_version: Number(value.customer_version ?? 0),
    discount: Number(value.discount ?? 0),
    id: value.id,
    last_customer_action_id: value.last_customer_action_id ?? null,
    last_tip_action_id: value.last_tip_action_id ?? null,
    receipt_version: Number(value.receipt_version ?? 0),
    reset_at: value.reset_at ?? null,
    selected_staff_id: value.selected_staff_id,
    salon_id: value.salon_id,
    server_now: value.server_now ?? new Date().toISOString(),
    staff_lines: normalizeLiveDraftStaffLines(value.staff_lines),
    status: value.status,
    subtotal: Number(value.subtotal ?? 0),
    tax: Number(value.tax ?? 0),
    tip,
    token: value.token,
    total,
    total_before_tip:
      Number(value.total_before_tip ?? Number.NaN) ||
      Math.max(0, total - tip),
    updated_at: value.updated_at,
    version: Number(value.version ?? 0),
  };
}

async function readPortablePosCookieSession() {
  const cookieStore = await cookies();
  const keyId = cookieStore.get(PORTABLE_POS_KEY_ID_COOKIE)?.value ?? "";
  const signature =
    cookieStore.get(PORTABLE_POS_SIGNATURE_COOKIE)?.value ?? "";

  if (!keyId || !signature) {
    return null;
  }

  return { keyId, signature };
}

async function clearPortableSessionCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(PORTABLE_POS_KEY_ID_COOKIE);
  cookieStore.delete(PORTABLE_POS_SIGNATURE_COOKIE);
}

async function recordPortableLogout() {
  const session = await readPortablePosCookieSession();

  if (!session) {
    return;
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return;
  }

  await supabase.rpc("log_out_pos_portable_access", {
    p_key_id: session.keyId,
    p_session_signature: session.signature,
  });
}

export async function getRememberedPortablePosAccessId() {
  const cookieStore = await cookies();
  return cookieStore.get(PORTABLE_POS_REMEMBERED_ID_COOKIE)?.value ?? "";
}

export async function signInPortablePosAction(
  _state: PortablePosLoginState,
  formData: FormData,
): Promise<PortablePosLoginState> {
  const accessId = readString(formData, "access_id");
  const passcode = readString(formData, "passcode");
  const rememberId = formData.get("remember_id") === "on";
  const returnTo = readPortableReturnTo(formData);

  if (!accessId || !passcode) {
    return { error: "POS ID and passcode are required." };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return { error: "Supabase environment variables are missing." };
  }

  const requestHeaders = await headers();
  const { data, error } = await supabase.rpc("sign_in_pos_portable_access", {
    p_access_id: accessId,
    p_passcode: passcode,
    p_user_agent: requestHeaders.get("user-agent") ?? "",
  });

  if (error) {
    return { error: error.message };
  }

  if (!data) {
    return { error: "POS ID or passcode is incorrect." };
  }

  const result = data as PortablePosSignInResult;
  const cookieStore = await cookies();
  cookieStore.set(
    PORTABLE_POS_KEY_ID_COOKIE,
    result.key_id,
    cookieOptions(),
  );
  cookieStore.set(
    PORTABLE_POS_SIGNATURE_COOKIE,
    result.signature,
    cookieOptions(),
  );

  if (rememberId) {
    cookieStore.set(
      PORTABLE_POS_REMEMBERED_ID_COOKIE,
      result.access_id,
      cookieOptions(60 * 60 * 24 * 365),
    );
  } else {
    cookieStore.delete(PORTABLE_POS_REMEMBERED_ID_COOKIE);
  }

  redirect(returnTo);
}

export async function logoutPortablePosAction() {
  await recordPortableLogout();
  await clearPortableSessionCookies();
  redirect("/pos/portable");
}

export async function forgetPortablePosAccessIdAction() {
  const cookieStore = await cookies();
  await recordPortableLogout();
  cookieStore.delete(PORTABLE_POS_REMEMBERED_ID_COOKIE);
  await clearPortableSessionCookies();
  redirect("/pos/portable");
}

export async function getCurrentPortablePosSession() {
  const session = await readPortablePosCookieSession();

  if (!session) {
    return null;
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.rpc("get_pos_portable_access_context", {
    p_key_id: session.keyId,
    p_session_signature: session.signature,
  });

  if (error || !data) {
    return null;
  }

  return normalizePortableSession(data);
}

async function requirePortablePosSession() {
  const session = await readPortablePosCookieSession();

  if (!session) {
    throw new Error("Portable POS is logged out.");
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  return {
    ...session,
    supabase,
  };
}

async function requirePortablePosSessionContext() {
  const session = await readPortablePosCookieSession();

  if (!session) {
    throw new Error("Portable POS is logged out.");
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase.rpc("get_pos_portable_access_context", {
    p_key_id: session.keyId,
    p_session_signature: session.signature,
  });
  const portableSession = normalizePortableSession(data);

  if (error || !portableSession) {
    throw new Error("Portable POS session expired. Log in again.");
  }

  return {
    ...session,
    portableSession,
    supabase,
  };
}

async function requirePortableCapability(capability: PortablePosCapability) {
  const context = await requirePortablePosSessionContext();

  if (!hasPortableCapability(context.portableSession, capability)) {
    throw new Error("This Portable POS device is not allowed to open that area.");
  }

  return context;
}

async function getPortableBusinessDate(input: {
  fallback?: string;
  salonId: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}) {
  const fallback = input.fallback ?? getTodayDate();

  if (!input.supabase) {
    return fallback;
  }

  const { data, error } = await input.supabase.rpc("get_salon_business_date", {
    p_salon_id: input.salonId,
  });

  if (error || typeof data !== "string") {
    return fallback;
  }

  return data;
}

async function loadPortablePosDeskData(): Promise<{
  defaults: typeof POS_DESK_DEFAULTS;
  liveDraft: PosLiveDraftView | null;
  salonLogoUrl: string | null;
  salonName: string;
  services: PosDeskService[];
  staff: PosDeskStaff[];
  today: string;
  waitingVisits: CustomerVisitQueueItem[];
}> {
  const { keyId, portableSession, signature, supabase } =
    await requirePortablePosSessionContext();
  const today = await getPortableBusinessDate({
    salonId: portableSession.salon_id,
    supabase,
  });
  const { data, error } = await supabase.rpc("get_pos_portable_desk_data", {
    p_key_id: keyId,
    p_session_signature: signature,
    p_work_date: today,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Portable POS session expired. Log in again.");
  }

  const payload = data as PortableDeskRpcData;
  const settings = normalizePosSettingsPayload(payload.settings);

  return {
    defaults: getPosDeskDefaults(settings),
    liveDraft: normalizeLiveDraft(payload.liveDraft),
    salonLogoUrl: settings.salonLogoUrl,
    salonName: payload.salonName,
    services: payload.services ?? [],
    staff: payload.staff ?? [],
    today,
    waitingVisits: normalizePortableWaitingVisits(payload.waitingVisits),
  };
}

export async function getPortablePosDeskData(): Promise<{
  defaults: typeof POS_DESK_DEFAULTS;
  liveDraft: PosLiveDraftView | null;
  salonLogoUrl: string | null;
  salonName: string;
  services: PosDeskService[];
  staff: PosDeskStaff[];
  today: string;
  waitingVisits: CustomerVisitQueueItem[];
}> {
  await requirePortableCapability(PORTABLE_POS_CAPABILITIES.posUse);
  return loadPortablePosDeskData();
}

export async function getPortableTodayData(): Promise<PortableTodayData> {
  await requirePortableCapability(PORTABLE_POS_CAPABILITIES.todayView);
  const deskData = await loadPortablePosDeskData();

  return {
    currentTotal: deskData.liveDraft?.total ?? 0,
    openReceiptLines: deskData.liveDraft?.staff_lines.length ?? 0,
    salonName: deskData.salonName,
    staff: deskData.staff.map((member) => ({
      displayName: member.display_name,
      id: member.id,
      jobTitle: member.job_title,
      largeTurns: member.turns.largeTurns,
      smallTurns: member.turns.smallTurns,
      status: member.today_status,
      totalTurns: member.turns.totalTurns,
    })),
    today: deskData.today,
  };
}

function normalizePortableCheckInRow(value: unknown): PortableCheckInStaffRow | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const id = normalizePortableString(payload.id);
  const displayName = normalizePortableString(payload.displayName);

  if (!id || !displayName) {
    return null;
  }

  return {
    checkInAt: normalizePortableNullableString(payload.checkInAt),
    checkInSequence:
      payload.checkInSequence === null || payload.checkInSequence === undefined
        ? null
        : normalizePortableNumber(payload.checkInSequence),
    displayName,
    id,
    isPasscodeDefault: Boolean(payload.isPasscodeDefault),
    jobTitle: normalizePortableNullableString(payload.jobTitle),
    queueTurnCount: normalizePortableNumber(payload.queueTurnCount),
    status: normalizePortableString(payload.status) || "not_checked_in",
  };
}

export async function getPortableCheckInData(): Promise<PortableCheckInData> {
  const { keyId, portableSession, signature, supabase } =
    await requirePortableCapability(PORTABLE_POS_CAPABILITIES.checkInUse);
  const { data, error } = await supabase.rpc("get_pos_portable_check_in_data", {
    p_key_id: keyId,
    p_session_signature: signature,
  });

  if (error || !data) {
    if (error) {
      console.error("Supabase load Portable Check-in data failed", {
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
      });
    }

    return {
      checkInEnabled: false,
      salonId: portableSession.salon_id,
      salonName: portableSession.salon_name,
      staff: [],
      today: getTodayDate(),
      timezone: "America/Chicago",
    };
  }

  const payload = data as Record<string, unknown>;
  const staff = Array.isArray(payload.staff)
    ? payload.staff
        .map(normalizePortableCheckInRow)
        .filter((row): row is PortableCheckInStaffRow => Boolean(row))
    : [];

  return {
    checkInEnabled: Boolean(payload.checkInEnabled),
    salonId: portableSession.salon_id,
    salonName:
      normalizePortableString(payload.salonName) || portableSession.salon_name,
    staff,
    today: normalizePortableString(payload.today) || getTodayDate(),
    timezone: normalizePortableString(payload.timezone) || "America/Chicago",
  };
}

export async function portableSubmitAttendanceEvent(
  input: PortableAttendanceEventInput,
): Promise<ActionResult<PortableCheckInData>> {
  try {
    const { keyId, portableSession, signature, supabase } =
      await requirePortableCapability(PORTABLE_POS_CAPABILITIES.checkInUse);
    const eventType = input.eventType;

    if (
      eventType !== "CHECK_IN" &&
      eventType !== "LEAVE_OUT" &&
      eventType !== "RETURN_TO_WORK" &&
      eventType !== "CHECK_OUT"
    ) {
      throw new Error("Choose a valid attendance action.");
    }

    const { data, error } = await supabase.rpc(
      "submit_pos_portable_attendance_event",
      {
        p_event_type: eventType,
        p_key_id: keyId,
        p_passcode: input.passcode,
        p_session_signature: signature,
        p_staff_id: input.staffId,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("Portable POS session expired. Log in again.");
    }

    revalidatePath("/pos/portable");
    revalidatePath("/pos/portable/check-in");
    revalidatePath("/pos/portable/ticket");
    await broadcastPosStaffChange(portableSession.salon_id, "attendance");

    return {
      data: await getPortableCheckInData(),
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to update staff attendance.",
      ok: false,
    };
  }
}

export async function getPortableTicketData(
  date = getTodayDate(),
): Promise<PortableTicketData> {
  const { keyId, portableSession, signature, supabase } =
    await requirePortableCapability(PORTABLE_POS_CAPABILITIES.todayView);
  const rpcResult = await supabase.rpc("get_pos_portable_ticket_data", {
    p_date: date,
    p_key_id: keyId,
    p_session_signature: signature,
  });

  if (rpcResult.error || !rpcResult.data) {
    return {
      date,
      salonName: portableSession.salon_name,
      setupMessage:
        "Portable Ticket data RPC is not applied yet. Apply the Portable ticket migration before enabling this page.",
      tickets: [],
      timezone: "America/Chicago",
    };
  }

  const payload = rpcResult.data as {
    salonName?: unknown;
    tickets?: unknown;
    timezone?: unknown;
  };
  const tickets = Array.isArray(payload.tickets)
    ? payload.tickets
        .map(normalizePortableTicket)
        .filter((ticket): ticket is PortableTicketRow => Boolean(ticket))
    : [];

  return {
    date,
    salonName:
      normalizePortableString(payload.salonName) || portableSession.salon_name,
    setupMessage: null,
    tickets,
    timezone: normalizePortableString(payload.timezone) || "America/Chicago",
  };
}

export async function getPortableBookData(
  date = getTodayDate(),
): Promise<PortableBookData> {
  const { keyId, portableSession, signature, supabase } =
    await requirePortableCapability(PORTABLE_POS_CAPABILITIES.bookView);
  const [deskData, rpcResult] = await Promise.all([
    loadPortablePosDeskData(),
    supabase.rpc("get_pos_portable_book_data", {
      p_date: date,
      p_key_id: keyId,
      p_session_signature: signature,
    }),
  ]);

  if (rpcResult.error || !rpcResult.data) {
    return {
      appointments: [],
      canCancel: hasPortableCapability(
        portableSession,
        PORTABLE_POS_CAPABILITIES.bookCancel,
      ),
      canCreate: hasPortableCapability(
        portableSession,
        PORTABLE_POS_CAPABILITIES.bookCreate,
      ),
      date,
      salonName: deskData.salonName,
      services: deskData.services,
      setupMessage:
        "Portable Book data RPC is not applied yet. Apply the Portable shell migration before enabling appointment operations.",
      staff: deskData.staff,
      timezone: "America/Chicago",
    };
  }

  const payload = rpcResult.data as {
    appointments?: PortableBookAppointment[];
    timezone?: string;
  };

  return {
    appointments: Array.isArray(payload.appointments) ? payload.appointments : [],
    canCancel: hasPortableCapability(
      portableSession,
      PORTABLE_POS_CAPABILITIES.bookCancel,
    ),
    canCreate: hasPortableCapability(
      portableSession,
      PORTABLE_POS_CAPABILITIES.bookCreate,
    ),
    date,
    salonName: deskData.salonName,
    services: deskData.services,
    setupMessage: null,
    staff: deskData.staff,
    timezone: payload.timezone ?? "America/Chicago",
  };
}

export async function getPortableReportData(
  reportDate = getTodayDate(),
): Promise<PortableReportData> {
  const { keyId, portableSession, signature, supabase } =
    await requirePortableCapability(PORTABLE_POS_CAPABILITIES.reportView);
  const rpcResult = await supabase.rpc("get_pos_portable_report_data", {
    p_key_id: keyId,
    p_report_date: reportDate,
    p_session_signature: signature,
  });

  if (rpcResult.error || !rpcResult.data) {
    if (rpcResult.error) {
      console.error("Supabase load Portable Report data failed", {
        code: rpcResult.error.code,
        details: rpcResult.error.details,
        hint: rpcResult.error.hint,
        message: rpcResult.error.message,
        reportDate,
      });
    }

    return {
      closingInputs: {
        cashAmount: 0,
        creditCardAmount: 0,
        note: null,
        otherAmount: 0,
        status: "draft",
      },
      lock: {
        isLocked: false,
        status: "draft",
      },
      reportDate,
      salonName: portableSession.salon_name,
      setupMessage:
        "Portable Report data RPC is not applied yet. Apply the Portable shell migration before enabling restricted reports.",
      timezone: "America/Chicago",
      totals: {
        actualTotal: 0,
        discounts: 0,
        difference: 0,
        expectedTotal: 0,
        finalizedTicketCount: 0,
        reconciliationStatus: "balanced",
        serviceCount: 0,
        taxes: 0,
        ticketCount: 0,
        tips: 0,
      },
    };
  }

  const payload = rpcResult.data as {
    closingInputs?: unknown;
    lock?: unknown;
    salonName?: string;
    timezone?: string;
    totals?: Partial<PortableReportData["totals"]>;
  };
  const totals = payload.totals ?? {};

  return {
    closingInputs: normalizePortableReportClosingInputs(payload.closingInputs),
    lock: normalizePortableReportLock(payload.lock),
    reportDate,
    salonName: payload.salonName ?? portableSession.salon_name,
    setupMessage: null,
    timezone: normalizePortableString(payload.timezone) || "America/Chicago",
    totals: {
      actualTotal: Number(totals.actualTotal ?? 0),
      discounts: Number(totals.discounts ?? 0),
      difference: Number(totals.difference ?? 0),
      expectedTotal: Number(totals.expectedTotal ?? 0),
      finalizedTicketCount: Number(totals.finalizedTicketCount ?? 0),
      reconciliationStatus: normalizePortableReconciliationStatus(
        totals.reconciliationStatus,
      ),
      serviceCount: Number(totals.serviceCount ?? 0),
      taxes: Number(totals.taxes ?? 0),
      ticketCount: Number(totals.ticketCount ?? 0),
      tips: Number(totals.tips ?? 0),
    },
  };
}

export async function savePortableReportClosing(
  input: PortableReportClosingSaveInput,
): Promise<ActionResult<PortableReportData>> {
  try {
    if (!input.reportDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      throw new Error("Report date is required.");
    }

    const { keyId, signature, supabase } = await requirePortableCapability(
      PORTABLE_POS_CAPABILITIES.reportView,
    );
    const cashAmountCents = parsePortableCurrencyToCents(
      input.cashAmount,
      "Cash",
    );
    const creditCardAmountCents = parsePortableCurrencyToCents(
      input.creditCardAmount,
      "Credit Card",
    );
    const otherAmountCents = parsePortableCurrencyToCents(
      input.otherAmount,
      "Other",
    );
    const { error } = await supabase.rpc("save_pos_portable_report_closing", {
      p_cash_amount: centsToPortableMoney(cashAmountCents),
      p_credit_card_amount: centsToPortableMoney(creditCardAmountCents),
      p_key_id: keyId,
      p_note: input.note?.trim() ? input.note.trim() : null,
      p_other_amount: centsToPortableMoney(otherAmountCents),
      p_report_date: input.reportDate,
      p_session_signature: signature,
    });

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath("/reports");
    revalidatePath("/pos/portable/report");

    return {
      data: await getPortableReportData(input.reportDate),
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message
          ? error.message
          : "Unable to save portable report closing.",
      ok: false,
    };
  }
}

export async function portableSearchPosDeskCustomers(search: string) {
  const { keyId, signature, supabase } = await requirePortablePosSession();
  const { data, error } = await supabase.rpc("search_pos_portable_customers", {
    p_key_id: keyId,
    p_search: search,
    p_session_signature: signature,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PosDeskCustomer[];
}

export async function portableCreatePosDeskCustomer(input: {
  email?: string | null;
  name: string;
  phone?: string | null;
}): Promise<ActionResult<PosDeskCustomer>> {
  try {
    const { keyId, signature, supabase } = await requirePortablePosSession();
    const { data, error } = await supabase.rpc("create_pos_portable_customer", {
      p_email: input.email ?? null,
      p_key_id: keyId,
      p_name: input.name,
      p_phone: input.phone ?? null,
      p_session_signature: signature,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("Portable POS session expired. Log in again.");
    }

    revalidatePath("/customers");
    return { data: data as PosDeskCustomer, ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to create customer.",
      ok: false,
    };
  }
}

export async function portableUpdatePosActiveDraft(input: {
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
    const { keyId, signature, supabase } = await requirePortablePosSession();
    const { data, error } = await supabase.rpc(
      "update_pos_portable_live_draft",
      {
        p_key_id: keyId,
        p_discount: input.discount ?? 0,
        p_selected_staff_id: input.selectedStaffId,
        p_session_signature: signature,
        p_staff_lines: input.staffLines,
        p_subtotal: input.subtotal,
        p_tax: input.tax ?? 0,
        p_tip: input.tip,
        p_token: input.token,
        p_total: input.total,
        p_total_before_tip:
          input.totalBeforeTip ?? Math.max(0, input.total - input.tip),
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    const liveDraft = normalizeLiveDraft(data as PosLiveDraftView | null);

    if (!liveDraft) {
      throw new Error("Portable POS session expired. Log in again.");
    }

    await broadcastPosLiveDraftSnapshot(liveDraft, "pos");

    return { data: liveDraft, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to update live receipt.",
      ok: false,
    };
  }
}

export async function portableUpdatePosLiveDraftCustomer(input: {
  customer: PosLiveDraftCustomer | null;
  token: string;
}): Promise<ActionResult<PosLiveDraftView>> {
  try {
    const { keyId, signature, supabase } = await requirePortablePosSession();
    const { data, error } = await supabase.rpc(
      "update_pos_portable_live_draft_customer",
      {
        p_customer: input.customer,
        p_key_id: keyId,
        p_session_signature: signature,
        p_token: input.token,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    const liveDraft = normalizeLiveDraft(data as PosLiveDraftView | null);

    if (!liveDraft) {
      throw new Error("Portable POS session expired. Log in again.");
    }

    await broadcastPosLiveDraftSnapshot(liveDraft, "pos");

    return { data: liveDraft, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to update live customer.",
      ok: false,
    };
  }
}

export async function portableGetPosLiveDraft(
  token: string,
): Promise<ActionResult<PosLiveDraftView | null>> {
  return getPosLiveDraft(token);
}

export async function portableSelectWaitingVisitForPos(input: {
  token: string;
  visitId: string;
}): Promise<WaitingVisitActionResult> {
  try {
    const { keyId, portableSession, signature, supabase } =
      await requirePortableCapability(PORTABLE_POS_CAPABILITIES.posUse);
    const token = input.token.trim();
    const visitId = input.visitId.trim();

    if (!token || !visitId) {
      throw new Error("Choose a waiting client first.");
    }

    const { data, error } = await supabase.rpc(
      "select_pos_portable_customer_visit_for_live_draft",
      {
        p_key_id: keyId,
        p_session_signature: signature,
        p_token: token,
        p_visit_id: visitId,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("Portable POS session expired. Log in again.");
    }

    const payload = readPortableResultPayload(data);

    if (payload.ok !== true) {
      throw new Error(
        normalizePortableString(payload.message) || "Unable to select waiting client.",
      );
    }

    const snapshot = normalizeLiveDraft(payload.snapshot as PosLiveDraftView | null);

    if (!snapshot) {
      throw new Error("Live draft was not found.");
    }

    await broadcastPosLiveDraftSnapshot(snapshot, "pos");
    revalidatePath("/pos");
    revalidatePath("/pos/portable");
    revalidatePath("/staff/today");
    await broadcastPosStaffChange(portableSession.salon_id, "waiting");

    return {
      data: {
        snapshot,
        visit: normalizePortableDisplayVisit(payload.visit),
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

export async function portableCancelWaitingVisitForPos(input: {
  visitId: string;
}): Promise<WaitingVisitActionResult> {
  try {
    const { keyId, portableSession, signature, supabase } =
      await requirePortableCapability(PORTABLE_POS_CAPABILITIES.posUse);
    const visitId = input.visitId.trim();

    if (!visitId) {
      throw new Error("Choose a waiting client first.");
    }

    const { data, error } = await supabase.rpc(
      "cancel_pos_portable_customer_visit",
      {
        p_key_id: keyId,
        p_reason: "Removed from Portable POS waiting list.",
        p_session_signature: signature,
        p_visit_id: visitId,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("Portable POS session expired. Log in again.");
    }

    const payload = readPortableResultPayload(data);

    if (payload.ok !== true) {
      throw new Error(
        normalizePortableString(payload.message) || "Unable to remove waiting client.",
      );
    }

    revalidatePath("/pos");
    revalidatePath("/pos/portable");
    revalidatePath("/staff/today");
    await broadcastPosStaffChange(portableSession.salon_id, "waiting");

    return {
      data: {
        status: normalizePortableVisitStatus(payload.status),
        visitId: normalizePortableNullableString(payload.visitId),
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

export async function portableSubmitPosDeskReceipt(
  input: PosDeskSubmitInput,
): Promise<PosDeskActionResult> {
  try {
    const { keyId, portableSession, signature, supabase } =
      await requirePortableCapability(PORTABLE_POS_CAPABILITIES.posUse);
    const today = await getPortableBusinessDate({
      salonId: portableSession.salon_id,
      supabase,
    });
    const { data, error } = await supabase.rpc("submit_pos_portable_receipt", {
      p_key_id: keyId,
      p_receipt: input,
      p_session_signature: signature,
      p_work_date: today,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("Portable POS session expired. Log in again.");
    }

    const result = data as {
      ticketId: string;
      ticketNumber: string;
    };

    if (input.liveDraftToken) {
      const { data: finalizedDraft, error: finalizeError } = await supabase.rpc(
        "finalize_pos_portable_live_draft",
        {
          p_key_id: keyId,
          p_reset_seconds: CUSTOMER_DISPLAY_COMPLETED_RESET_SECONDS,
          p_session_signature: signature,
          p_token: input.liveDraftToken,
        },
      );

      if (finalizeError) {
        throw new Error(finalizeError.message);
      }

      const liveDraft = normalizeLiveDraft(
        finalizedDraft as PosLiveDraftView | null,
      );

      if (liveDraft) {
        await broadcastPosLiveDraftSnapshot(liveDraft, "pos");
      }
    }

    revalidatePath("/pos");
    revalidatePath("/pos-tickets");
    revalidatePath("/pos/portable");
    revalidatePath("/pos/portable/check-in");
    revalidatePath("/pos/portable/ticket");
    revalidatePath("/staff/today");
    revalidatePath("/staff/my-work");
    await broadcastPosStaffChange(portableSession.salon_id, "pos");

    return {
      customerClaim: null,
      ok: true,
      ticketId: result.ticketId,
      ticketNumber: result.ticketNumber,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to submit POS receipt.",
      ok: false,
    };
  }
}

export async function portableAdjustStaffTurn(
  input: PortableTurnAdjustmentInput,
): Promise<
  ActionResult<{
    delta: number;
    isOperatorPasscodeDefault: boolean;
    newTurn: number;
    oldTurn: number;
    operatorStaffId: string;
    targetStaffId: string;
    today: string;
  }>
> {
  try {
    const { keyId, portableSession, signature, supabase } =
      await requirePortableCapability(PORTABLE_POS_CAPABILITIES.turnAdjust);
    const delta = Math.trunc(input.delta);

    if (!Number.isFinite(delta) || delta === 0) {
      throw new Error("Choose a plus or minus turn adjustment.");
    }

    if (!input.reason.trim()) {
      throw new Error("Reason is required.");
    }

    const { data, error } = await supabase.rpc(
      "adjust_pos_portable_staff_turn",
      {
        p_delta: delta,
        p_key_id: keyId,
        p_operator_passcode: input.operatorPasscode,
        p_operator_staff_id: input.operatorStaffId,
        p_reason: input.reason.trim(),
        p_session_signature: signature,
        p_target_staff_id: input.targetStaffId,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error("Portable POS is not authorized for turn adjustment.");
    }

    revalidatePath("/pos/portable");
    revalidatePath("/pos/portable/check-in");
    revalidatePath("/pos/portable/ticket");
    await broadcastPosStaffChange(portableSession.salon_id, "turn_adjust");

    const payload = data as Record<string, unknown>;

    return {
      data: {
        delta: normalizePortableNumber(payload.delta),
        isOperatorPasscodeDefault: Boolean(payload.isOperatorPasscodeDefault),
        newTurn: normalizePortableNumber(payload.newTurn),
        oldTurn: normalizePortableNumber(payload.oldTurn),
        operatorStaffId: normalizePortableString(payload.operatorStaffId),
        targetStaffId: normalizePortableString(payload.targetStaffId),
        today: normalizePortableString(payload.today),
      },
      ok: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to adjust staff turn.",
      ok: false,
    };
  }
}
