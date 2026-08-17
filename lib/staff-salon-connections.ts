import "server-only";

import { createHash, randomBytes } from "crypto";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { headers } from "next/headers";
import { isEmailProviderConfigured, sendEmail } from "@/lib/email";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { STAFF_SELECT } from "@/lib/staff";
import {
  normalizeStaffConnectionEmail,
  normalizeStaffConnectionPhone,
  requireStaffConnectionContact,
  StaffConnectionNormalizationError,
} from "@/lib/staff-connection-normalization";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { Staff } from "@/types/staff";
import type {
  CreateSalonStaffInviteInput,
  CreateSalonStaffInviteResult,
  PublicStaffApplicationSalon,
  ReviewStaffSalonApplicationInput,
  ResendSalonStaffInviteResult,
  SalonStaffConnectionRequestWithDetails,
  StaffAccountExactMatchType,
  StaffAccountExactSearchResult,
  StaffConnectionDashboardRequest,
  StaffConnectionInviteTokenDetails,
  StaffConnectionRequestAccountSummary,
  StaffConnectionRequestStaffSummary,
  StaffConnectionRpcResult,
  StaffInviteEmailVerificationResult,
  StaffInviteEmailDelivery,
  StaffSalonConnectionRequest,
  SubmitStaffSalonApplicationInput,
} from "@/types/staff-salon-connection";
import type { KingUser } from "@/types/user";

export const STAFF_CONNECTION_INVITE_EXPIRY_DAYS = 7;

const STAFF_CONNECTION_REQUEST_SELECT =
  "id, salon_id, staff_id, account_user_id, direction, initiated_by_user_id, target_email_normalized, target_phone_e164, status, expires_at, accepted_at, declined_at, cancelled_at, revoked_at, reviewed_by_user_id, message, requested_job_title, created_at, updated_at";

const STAFF_CONNECTION_ACCOUNT_SELECT =
  "id, auth_user_id, email, phone, display_name, avatar_url, status";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type StaffConnectionAccount = Pick<
  KingUser,
  "auth_user_id" | "avatar_url" | "display_name" | "email" | "id" | "phone" | "status"
>;

type StaffConnectionErrorCode =
  | "ACCOUNT_ALREADY_CONNECTED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_INVITABLE"
  | "AMBIGUOUS_ACCOUNT_SEARCH"
  | "DUPLICATE_PENDING_REQUEST"
  | "INVALID_CONTACT"
  | "INVALID_INPUT"
  | "INVITE_NOT_FOUND"
  | "MISSING_CONTEXT"
  | "MISSING_PERMISSION"
  | "REQUEST_NOT_FOUND"
  | "SALON_NOT_FOUND"
  | "STAFF_ALREADY_CONNECTED"
  | "STAFF_NOT_FOUND"
  | "SUPABASE_NOT_CONFIGURED";

export class StaffSalonConnectionError extends Error {
  code: StaffConnectionErrorCode;

  constructor(code: StaffConnectionErrorCode, message: string) {
    super(message);
    this.name = "StaffSalonConnectionError";
    this.code = code;
  }
}

type StaffConnectionAuthContext = {
  context: CurrentBusinessContext;
  Account: NonNullable<CurrentBusinessContext["currentAccount"]>;
  salon: NonNullable<CurrentBusinessContext["currentSalon"]>;
  supabase: SupabaseServerClient;
  user: NonNullable<CurrentBusinessContext["user"]>;
};

type AccountSearchRpcRow = {
  account_user_id: string | null;
  avatar_url: string | null;
  display_name: string | null;
  masked_email: string | null;
  masked_phone: string | null;
  match_type: StaffAccountExactMatchType | null;
  result_status: "ambiguous" | "found" | "not_found";
};

type StaffConnectionDashboardRpcRow = StaffConnectionDashboardRequest;

type StaffConnectionPublicSalonRpcRow = PublicStaffApplicationSalon;

type StaffConnectionInviteRpcResult = StaffConnectionRpcResult & {
  expires_at?: string | null;
};

type InsertedSalonInviteRequest = Omit<
  CreateSalonStaffInviteResult,
  "email_delivery"
>;

type InviteEmailContext = {
  staffJobTitle: string | null;
  staffName: string;
  targetEmail: string | null;
};

function toConnectionError(error: unknown): StaffSalonConnectionError {
  if (error instanceof StaffSalonConnectionError) {
    return error;
  }

  if (error instanceof StaffConnectionNormalizationError) {
    return new StaffSalonConnectionError("INVALID_CONTACT", error.message);
  }

  if (error instanceof Error) {
    return new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  return new StaffSalonConnectionError("INVALID_INPUT", "Invalid staff connection request.");
}

export function getStaffSalonConnectionError(error: unknown) {
  return toConnectionError(error);
}

export function generateStaffConnectionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashStaffConnectionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function getInviteExpiresAt() {
  return new Date(
    Date.now() + STAFF_CONNECTION_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function cleanOrigin(value: string | null | undefined) {
  return value?.trim().replace(/\/+$/, "") || null;
}

async function getStaffInviteOrigin() {
  const configuredOrigin =
    cleanOrigin(process.env.NEXT_PUBLIC_APP_URL) ?? cleanOrigin(process.env.APP_URL);

  if (configuredOrigin) {
    return configuredOrigin;
  }

  try {
    const headerStore = await headers();
    const host =
      headerStore.get("x-forwarded-host") ??
      headerStore.get("host") ??
      null;

    if (!host) {
      return null;
    }

    const protocol =
      headerStore.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https");

    return `${protocol}://${host}`;
  } catch {
    return null;
  }
}

async function getStaffInviteAbsoluteHref(token: string) {
  const origin = await getStaffInviteOrigin();

  if (!origin) {
    return null;
  }

  return `${origin}/staff/invite/${encodeURIComponent(token)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendStaffInviteEmail(input: {
  auth: StaffConnectionAuthContext;
  staffJobTitle?: string | null;
  staffName: string;
  targetEmail: string | null;
  token: string;
}): Promise<StaffInviteEmailDelivery> {
  if (!input.targetEmail) {
    return {
      reason: "No staff email was provided for this invitation.",
      status: "skipped",
    };
  }

  const salonName = input.auth.salon.name ?? "the salon";
  const staffName = input.staffName || "Staff";

  if (!isEmailProviderConfigured()) {
    return {
      reason:
        "Custom staff invite email provider is not connected. Copy the invite link from this page.",
      recipient: input.targetEmail,
      status: "skipped",
    };
  }

  const directInviteHref = await getStaffInviteAbsoluteHref(input.token);

  if (!directInviteHref) {
    return {
      reason:
        "App URL could not be resolved. Set NEXT_PUBLIC_APP_URL to email staff invite links.",
      recipient: input.targetEmail,
      status: "skipped",
    };
  }

  const subject = `Invitation to join ${salonName} as staff`;
  const titleLine = input.staffJobTitle
    ? `${staffName} (${input.staffJobTitle})`
    : staffName;
  const text = [
    `${salonName} invited you to join their staff team on Reylumi.`,
    "",
    `Staff profile: ${titleLine}`,
    `Invited email: ${input.targetEmail}`,
    "",
    "Open this link to review the invitation, verify your email, and create your password:",
    directInviteHref,
    "",
    `After your account is created, it will be connected to ${salonName} automatically.`,
    "",
    `This invitation expires in ${STAFF_CONNECTION_INVITE_EXPIRY_DAYS} days.`,
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #18181b;">
      <h1 style="font-size: 20px; margin: 0 0 12px;">Invitation to join ${escapeHtml(salonName)} as staff</h1>
      <p style="margin: 0 0 12px;">${escapeHtml(salonName)} has prepared a staff profile for you on Reylumi.</p>
      <p style="margin: 0 0 8px;">Staff profile: <strong>${escapeHtml(titleLine)}</strong></p>
      <p style="margin: 0 0 16px;">Invited email: <strong>${escapeHtml(input.targetEmail)}</strong></p>
      <p style="margin: 0 0 16px;">Open this secure invitation link, verify your email, and create your password. After the account is created, it will be connected to ${escapeHtml(salonName)} automatically.</p>
      <p style="margin: 0 0 16px;">
        <a href="${escapeHtml(directInviteHref)}" style="display: inline-block; background: #09090b; color: #ffffff; padding: 10px 14px; border-radius: 6px; text-decoration: none;">Open staff invitation</a>
      </p>
      <p style="margin: 0 0 8px; font-size: 13px; color: #52525b;">Or copy this link:</p>
      <p style="word-break: break-all; font-size: 13px; color: #27272a;">${escapeHtml(directInviteHref)}</p>
      <p style="font-size: 12px; color: #71717a;">This invitation expires in ${STAFF_CONNECTION_INVITE_EXPIRY_DAYS} days.</p>
    </div>
  `;
  const delivery = await sendEmail({
    html,
    subject,
    text,
    to: input.targetEmail,
  });

  if (delivery.status === "failed") {
    console.error("Staff invitation email delivery failed", {
      reason: delivery.reason,
      recipient: delivery.recipient,
      requestSalonId: input.auth.salon.id,
    });
  }

  return delivery;
}

function trimOptional(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function splitFullName(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: null, lastName: null };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function safeNormalizeStoredEmail(value: string | null | undefined) {
  try {
    return normalizeStaffConnectionEmail(value);
  } catch {
    return null;
  }
}

function safeNormalizeStoredPhone(value: string | null | undefined) {
  try {
    return normalizeStaffConnectionPhone(value);
  } catch {
    return null;
  }
}

function maskEmail(value: string | null | undefined) {
  const normalized = safeNormalizeStoredEmail(value);

  if (!normalized) {
    return null;
  }

  const [localPart, domainPart] = normalized.split("@");

  if (!localPart || !domainPart) {
    return "***";
  }

  return `${localPart[0]}${"*".repeat(Math.max(localPart.length - 1, 3))}@${domainPart}`;
}

function maskPhone(value: string | null | undefined) {
  const normalized = safeNormalizeStoredPhone(value);

  if (!normalized) {
    return null;
  }

  if (normalized.length <= 4) {
    return "*".repeat(normalized.length);
  }

  return `${"*".repeat(Math.max(normalized.length - 4, 3))}${normalized.slice(-4)}`;
}

function requireRpcObject(data: unknown): StaffConnectionRpcResult {
  if (!data || typeof data !== "object") {
    throw new StaffSalonConnectionError(
      "INVALID_INPUT",
      "Staff connection request did not return a result.",
    );
  }

  return data as StaffConnectionRpcResult;
}

function requirePublicSupabaseClient() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new StaffSalonConnectionError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase environment variables are missing.",
    );
  }

  return supabase;
}

async function requireAuthenticatedSupabaseClient() {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new StaffSalonConnectionError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase environment variables are missing.",
    );
  }

  return supabase;
}

async function getStaffConnectionAuthContext(): Promise<StaffConnectionAuthContext> {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new StaffSalonConnectionError(
      "MISSING_CONTEXT",
      "You must be logged in to manage staff connections.",
    );
  }

  if (
    !isSalonManageContext(context) ||
    !context.currentAccount ||
    !context.currentSalon
  ) {
    throw new StaffSalonConnectionError(
      "MISSING_CONTEXT",
      "Open staff connections from a Business workspace.",
    );
  }

  const canManageStaff = await hasPermission("staff.manage", context);

  if (!canManageStaff) {
    throw new StaffSalonConnectionError(
      "MISSING_PERMISSION",
      "Missing required permission: staff.manage",
    );
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new StaffSalonConnectionError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase environment variables are missing.",
    );
  }

  return {
    context,
    Account: context.currentAccount,
    salon: context.currentSalon,
    supabase,
    user: context.user,
  };
}

function mapSearchRow(row: AccountSearchRpcRow | null): StaffAccountExactSearchResult {
  if (!row || row.result_status === "not_found") {
    return { status: "not_found" };
  }

  if (row.result_status === "ambiguous") {
    return { status: "ambiguous" };
  }

  if (!row.account_user_id || !row.match_type) {
    return { status: "not_found" };
  }

  return {
    account: {
      avatar_url: row.avatar_url,
      display_name: row.display_name,
      id: row.account_user_id,
      masked_email: row.masked_email,
      masked_phone: row.masked_phone,
    },
    match_type: row.match_type,
    status: "found",
  };
}

export async function searchStaffAccountExact(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<StaffAccountExactSearchResult> {
  try {
    const { email, phone } = requireStaffConnectionContact(input);
    const auth = await getStaffConnectionAuthContext();
    const { data, error } = await auth.supabase
      .rpc("search_staff_connection_account_exact", {
        p_email: email,
        p_phone: phone,
        target_account_id: auth.Account.id,
        target_salon_id: auth.salon.id,
      });

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    const rows = Array.isArray(data) ? (data as AccountSearchRpcRow[]) : [];

    return mapSearchRow(rows[0] ?? null);
  } catch (error) {
    throw toConnectionError(error);
  }
}

async function loadStaffForInvite(
  auth: StaffConnectionAuthContext,
  staffId: string,
) {
  const { data, error } = await auth.supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("salon_id", auth.salon.id)
    .eq("id", staffId)
    .maybeSingle<Staff>();

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  if (!data) {
    throw new StaffSalonConnectionError(
      "STAFF_NOT_FOUND",
      "Staff record was not found in the current salon.",
    );
  }

  if (data.account_user_id) {
    throw new StaffSalonConnectionError(
      "STAFF_ALREADY_CONNECTED",
      "This staff record is already connected to an account.",
    );
  }

  return data;
}

async function createUnconnectedStaffForInvite(
  auth: StaffConnectionAuthContext,
  input: {
    display_name: string;
    email?: string | null;
    first_name?: string | null;
    is_active?: boolean;
    job_title?: string | null;
    last_name?: string | null;
    phone?: string | null;
  },
) {
  const displayName = input.display_name.trim();
  const parsedName = splitFullName(displayName);

  if (!displayName) {
    throw new StaffSalonConnectionError("INVALID_INPUT", "Full Name is required.");
  }

  const { data, error } = await auth.supabase
    .from("staff")
    .insert({
      display_name: displayName,
      email: input.email,
      first_name: trimOptional(input.first_name) ?? parsedName.firstName,
      is_active: input.is_active ?? true,
      job_title: trimOptional(input.job_title),
      last_name: trimOptional(input.last_name) ?? parsedName.lastName,
      phone: input.phone,
      salon_id: auth.salon.id,
    })
    .select(STAFF_SELECT)
    .single<Staff>();

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  return data;
}

async function resolveExistingInviteAccount(
  auth: StaffConnectionAuthContext,
  input: Extract<CreateSalonStaffInviteInput, { mode: "existing_account" }>,
) {
  const contact = requireStaffConnectionContact(input);
  const { data, error } = await auth.supabase.rpc(
    "search_staff_connection_account_exact",
    {
      p_email: contact.email,
      p_phone: contact.phone,
      target_account_id: auth.Account.id,
      target_salon_id: auth.salon.id,
    },
  );

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  const rows = Array.isArray(data) ? (data as AccountSearchRpcRow[]) : [];
  const result = mapSearchRow(rows[0] ?? null);

  if (result.status === "ambiguous") {
    throw new StaffSalonConnectionError(
      "AMBIGUOUS_ACCOUNT_SEARCH",
      "More than one account matched. Refine the email or phone.",
    );
  }

  if (
    result.status !== "found" ||
    result.account.id !== input.account_user_id
  ) {
    throw new StaffSalonConnectionError("ACCOUNT_NOT_FOUND", "Account was not found.");
  }

  return {
    display_name: result.account.display_name,
    email: contact.email,
    id: result.account.id,
    phone: contact.phone,
  };
}

async function assertAccountNotConnectedToSalon(
  auth: StaffConnectionAuthContext,
  accountUserId: string,
) {
  const { data, error } = await auth.supabase
    .from("staff")
    .select("id")
    .eq("salon_id", auth.salon.id)
    .eq("account_user_id", accountUserId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  if (data) {
    throw new StaffSalonConnectionError(
      "ACCOUNT_ALREADY_CONNECTED",
      "This account is already connected to a staff record in this salon.",
    );
  }
}

async function assertNoPendingInviteForStaff(
  auth: StaffConnectionAuthContext,
  staffId: string,
) {
  const { data, error } = await auth.supabase
    .from("staff_salon_connection_requests")
    .select("id")
    .eq("salon_id", auth.salon.id)
    .eq("staff_id", staffId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  if (data) {
    throw new StaffSalonConnectionError(
      "DUPLICATE_PENDING_REQUEST",
      "A pending staff connection request already exists for this staff record.",
    );
  }
}

async function assertNoPendingInviteForAccount(
  auth: StaffConnectionAuthContext,
  accountUserId: string,
) {
  const { data, error } = await auth.supabase
    .from("staff_salon_connection_requests")
    .select("id")
    .eq("salon_id", auth.salon.id)
    .eq("account_user_id", accountUserId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  if (data) {
    throw new StaffSalonConnectionError(
      "DUPLICATE_PENDING_REQUEST",
      "A pending staff connection request already exists for this account and salon.",
    );
  }
}

async function assertNoPendingInviteForContact(
  auth: StaffConnectionAuthContext,
  input: {
    email: string | null;
    phone: string | null;
  },
) {
  if (input.email) {
    const { data, error } = await auth.supabase
      .from("staff_salon_connection_requests")
      .select("id")
      .eq("salon_id", auth.salon.id)
      .eq("target_email_normalized", input.email)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    if (data) {
      throw new StaffSalonConnectionError(
        "DUPLICATE_PENDING_REQUEST",
        "A pending staff invitation already exists for this email.",
      );
    }
  }

  if (input.phone) {
    const { data, error } = await auth.supabase
      .from("staff_salon_connection_requests")
      .select("id")
      .eq("salon_id", auth.salon.id)
      .eq("target_phone_e164", input.phone)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    if (data) {
      throw new StaffSalonConnectionError(
        "DUPLICATE_PENDING_REQUEST",
        "A pending staff invitation already exists for this phone.",
      );
    }
  }
}

async function insertSalonInviteRequest(input: {
  accountUserId: string | null;
  auth: StaffConnectionAuthContext;
  staffId: string;
  targetEmail: string | null;
  targetPhone: string | null;
}): Promise<InsertedSalonInviteRequest> {
  const token = generateStaffConnectionToken();
  const tokenHash = hashStaffConnectionToken(token);
  const { data, error } = await input.auth.supabase
    .from("staff_salon_connection_requests")
    .insert({
      account_user_id: input.accountUserId,
      direction: "salon_invite",
      expires_at: getInviteExpiresAt(),
      initiated_by_user_id: input.auth.user.id,
      salon_id: input.auth.salon.id,
      staff_id: input.staffId,
      status: "pending",
      target_email_normalized: input.targetEmail,
      target_phone_e164: input.targetPhone,
      token_hash: tokenHash,
    })
    .select(STAFF_CONNECTION_REQUEST_SELECT)
    .single<StaffSalonConnectionRequest>();

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  return {
    invite_token: token,
    request: data,
  };
}

async function loadInviteEmailContext(
  auth: StaffConnectionAuthContext,
  requestId: string,
): Promise<InviteEmailContext> {
  const { data: request, error } = await auth.supabase
    .from("staff_salon_connection_requests")
    .select("staff_id, target_email_normalized")
    .eq("id", requestId)
    .eq("salon_id", auth.salon.id)
    .maybeSingle<{
      staff_id: string | null;
      target_email_normalized: string | null;
    }>();

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  if (!request?.staff_id) {
    return {
      staffJobTitle: null,
      staffName: "Staff",
      targetEmail: request?.target_email_normalized ?? null,
    };
  }

  const { data: staff, error: staffError } = await auth.supabase
    .from("staff")
    .select("display_name, job_title")
    .eq("id", request.staff_id)
    .eq("salon_id", auth.salon.id)
    .maybeSingle<{ display_name: string; job_title: string | null }>();

  if (staffError) {
    throw new StaffSalonConnectionError("INVALID_INPUT", staffError.message);
  }

  return {
    staffJobTitle: staff?.job_title ?? null,
    staffName: staff?.display_name ?? "Staff",
    targetEmail: request.target_email_normalized,
  };
}

async function createExistingAccountInvite(
  auth: StaffConnectionAuthContext,
  input: Extract<CreateSalonStaffInviteInput, { mode: "existing_account" }>,
) {
  const account = await resolveExistingInviteAccount(auth, input);
  await assertAccountNotConnectedToSalon(auth, account.id);

  const targetEmail = account.email;
  const targetPhone = account.phone;
  const staff = input.staff_id
    ? await loadStaffForInvite(auth, input.staff_id)
    : await createUnconnectedStaffForInvite(auth, {
        display_name:
          trimOptional(input.display_name) ??
          account.display_name ??
          account.email ??
          "Staff",
        email: targetEmail,
        first_name: input.first_name,
        is_active: input.is_active,
        job_title: input.job_title,
        last_name: input.last_name,
        phone: targetPhone,
      });

  await assertNoPendingInviteForStaff(auth, staff.id);
  await assertNoPendingInviteForAccount(auth, account.id);
  await assertNoPendingInviteForContact(auth, {
    email: targetEmail,
    phone: targetPhone,
  });

  const invite = await insertSalonInviteRequest({
    accountUserId: account.id,
    auth,
    staffId: staff.id,
    targetEmail,
    targetPhone,
  });

  return {
    ...invite,
    email_delivery: await sendStaffInviteEmail({
      auth,
      staffJobTitle: staff.job_title,
      staffName: staff.display_name,
      targetEmail,
      token: invite.invite_token,
    }),
  };
}

async function createNewAccountInvite(
  auth: StaffConnectionAuthContext,
  input: Extract<CreateSalonStaffInviteInput, { mode: "new_account" }>,
) {
  const contact = requireStaffConnectionContact(input);
  await assertNoPendingInviteForContact(auth, contact);
  const staff = await createUnconnectedStaffForInvite(auth, {
    display_name: input.display_name,
    email: contact.email,
    first_name: input.first_name,
    is_active: input.is_active,
    job_title: input.job_title,
    last_name: input.last_name,
    phone: contact.phone,
  });

  await assertNoPendingInviteForStaff(auth, staff.id);

  const invite = await insertSalonInviteRequest({
    accountUserId: null,
    auth,
    staffId: staff.id,
    targetEmail: contact.email,
    targetPhone: contact.phone,
  });

  return {
    ...invite,
    email_delivery: await sendStaffInviteEmail({
      auth,
      staffJobTitle: staff.job_title,
      staffName: staff.display_name,
      targetEmail: contact.email,
      token: invite.invite_token,
    }),
  };
}

export async function createSalonStaffInvite(
  input: CreateSalonStaffInviteInput,
): Promise<CreateSalonStaffInviteResult> {
  try {
    const auth = await getStaffConnectionAuthContext();

    if (input.mode === "existing_account") {
      return createExistingAccountInvite(auth, input);
    }

    return createNewAccountInvite(auth, input);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function getStaffInviteByToken(
  token: string,
): Promise<StaffConnectionInviteTokenDetails> {
  try {
    if (!token.trim()) {
      throw new StaffSalonConnectionError(
        "INVITE_NOT_FOUND",
        "Invitation token is required.",
      );
    }

    const supabase = requirePublicSupabaseClient();
    const { data, error } = await supabase.rpc(
      "get_staff_connection_invite_by_token",
      {
        p_token: token,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return data as StaffConnectionInviteTokenDetails;
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function verifyStaffInviteEmail(input: {
  email: string;
  token: string;
}): Promise<StaffInviteEmailVerificationResult> {
  try {
    if (!input.token.trim()) {
      throw new StaffSalonConnectionError(
        "INVITE_NOT_FOUND",
        "Invitation token is required.",
      );
    }

    const supabase = requirePublicSupabaseClient();
    const { data, error } = await supabase.rpc(
      "verify_staff_connection_invite_email",
      {
        p_email: input.email,
        p_token: input.token,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return data as StaffInviteEmailVerificationResult;
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function acceptStaffInvite(token: string) {
  try {
    if (!token.trim()) {
      throw new StaffSalonConnectionError(
        "INVITE_NOT_FOUND",
        "Invitation token is required.",
      );
    }

    const supabase = await requireAuthenticatedSupabaseClient();
    const { data, error } = await supabase.rpc(
      "accept_staff_connection_invite",
      {
        p_token: token,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return requireRpcObject(data);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function declineStaffInvite(token: string) {
  try {
    if (!token.trim()) {
      throw new StaffSalonConnectionError(
        "INVITE_NOT_FOUND",
        "Invitation token is required.",
      );
    }

    const supabase = await requireAuthenticatedSupabaseClient();
    const { data, error } = await supabase.rpc(
      "decline_staff_connection_invite",
      {
        p_token: token,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return requireRpcObject(data);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function acceptStaffInviteByRequestId(requestId: string) {
  try {
    if (!requestId.trim()) {
      throw new StaffSalonConnectionError(
        "REQUEST_NOT_FOUND",
        "Invitation request is required.",
      );
    }

    const supabase = await requireAuthenticatedSupabaseClient();
    const { data, error } = await supabase.rpc(
      "accept_staff_connection_invite_by_request",
      {
        p_request_id: requestId,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return requireRpcObject(data);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function declineStaffInviteByRequestId(requestId: string) {
  try {
    if (!requestId.trim()) {
      throw new StaffSalonConnectionError(
        "REQUEST_NOT_FOUND",
        "Invitation request is required.",
      );
    }

    const supabase = await requireAuthenticatedSupabaseClient();
    const { data, error } = await supabase.rpc(
      "decline_staff_connection_invite_by_request",
      {
        p_request_id: requestId,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return requireRpcObject(data);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function resendSalonStaffInvite(
  requestId: string,
): Promise<ResendSalonStaffInviteResult> {
  try {
    if (!requestId.trim()) {
      throw new StaffSalonConnectionError(
        "REQUEST_NOT_FOUND",
        "Invitation request is required.",
      );
    }

    const token = generateStaffConnectionToken();
    const auth = await getStaffConnectionAuthContext();
    const { data, error } = await auth.supabase.rpc(
      "resend_staff_connection_invite",
      {
        p_expires_at: getInviteExpiresAt(),
        p_request_id: requestId,
        p_token_hash: hashStaffConnectionToken(token),
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    const emailContext = await loadInviteEmailContext(auth, requestId);

    return {
      email_delivery: await sendStaffInviteEmail({
        auth,
        staffJobTitle: emailContext.staffJobTitle,
        staffName: emailContext.staffName,
        targetEmail: emailContext.targetEmail,
        token,
      }),
      invite_token: token,
      result: data as StaffConnectionInviteRpcResult,
    };
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function revokeSalonStaffInvite(requestId: string) {
  try {
    if (!requestId.trim()) {
      throw new StaffSalonConnectionError(
        "REQUEST_NOT_FOUND",
        "Invitation request is required.",
      );
    }

    const supabase = await requireAuthenticatedSupabaseClient();
    const { data, error } = await supabase.rpc(
      "revoke_staff_connection_invite",
      {
        p_request_id: requestId,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return requireRpcObject(data);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function searchPublicStaffApplicationSalons(input: {
  city?: string | null;
  query?: string | null;
  state?: string | null;
}) {
  try {
    const supabase = requirePublicSupabaseClient();
    const { data, error } = await supabase.rpc(
      "search_public_staff_application_salons",
      {
        p_city: trimOptional(input.city),
        p_limit: 12,
        p_query: trimOptional(input.query),
        p_state: trimOptional(input.state),
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return Array.isArray(data)
      ? (data as StaffConnectionPublicSalonRpcRow[])
      : [];
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function submitStaffSalonApplication(
  input: SubmitStaffSalonApplicationInput,
) {
  try {
    if (!input.salon_id.trim()) {
      throw new StaffSalonConnectionError(
        "SALON_NOT_FOUND",
        "Please choose a salon before applying.",
      );
    }

    const supabase = await requireAuthenticatedSupabaseClient();
    const { data, error } = await supabase.rpc(
      "submit_staff_salon_application",
      {
        p_message: trimOptional(input.message),
        p_requested_job_title: trimOptional(input.requested_job_title),
        p_salon_id: input.salon_id,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return requireRpcObject(data);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function cancelStaffSalonApplication(requestId: string) {
  try {
    if (!requestId.trim()) {
      throw new StaffSalonConnectionError(
        "REQUEST_NOT_FOUND",
        "Application request is required.",
      );
    }

    const supabase = await requireAuthenticatedSupabaseClient();
    const { data, error } = await supabase.rpc(
      "cancel_staff_salon_application",
      {
        p_request_id: requestId,
      },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return requireRpcObject(data);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function reviewStaffSalonApplication(
  input: ReviewStaffSalonApplicationInput,
) {
  try {
    if (!input.request_id.trim()) {
      throw new StaffSalonConnectionError(
        "REQUEST_NOT_FOUND",
        "Application request is required.",
      );
    }

    const supabase = await requireAuthenticatedSupabaseClient();
    const { data, error } = await supabase.rpc(
      "review_staff_salon_application",
      input.decision === "declined"
        ? {
            p_decision: input.decision,
            p_request_id: input.request_id,
          }
        : {
            p_decision: input.decision,
            p_display_name: trimOptional(input.display_name),
            p_email: trimOptional(input.email),
            p_job_title: trimOptional(input.job_title),
            p_phone: trimOptional(input.phone),
            p_request_id: input.request_id,
            p_staff_id: trimOptional(input.staff_id),
          },
    );

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    return requireRpcObject(data);
  } catch (error) {
    throw toConnectionError(error);
  }
}

export async function getStaffConnectionDashboard() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return {
      context,
      requests: [] as StaffConnectionDashboardRequest[],
    };
  }

  const supabase = await requireAuthenticatedSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_my_staff_salon_connection_requests",
  );

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  return {
    context,
    requests: Array.isArray(data)
      ? (data as StaffConnectionDashboardRpcRow[])
      : [],
  };
}

async function enrichSalonConnectionRequests(
  supabase: SupabaseServerClient,
  requests: StaffSalonConnectionRequest[],
): Promise<SalonStaffConnectionRequestWithDetails[]> {
  const staffIds = Array.from(
    new Set(
      requests
        .map((request) => request.staff_id)
        .filter((staffId): staffId is string => Boolean(staffId)),
    ),
  );
  const accountUserIds = Array.from(
    new Set(
      requests
        .map((request) => request.account_user_id)
        .filter((accountUserId): accountUserId is string =>
          Boolean(accountUserId),
        ),
    ),
  );
  const staffById = new Map<string, StaffConnectionRequestStaffSummary>();
  const accountById = new Map<string, StaffConnectionRequestAccountSummary>();

  if (staffIds.length > 0) {
    const { data, error } = await supabase
      .from("staff")
      .select(
        "id, account_user_id, display_name, email, phone, job_title, is_active",
      )
      .in("id", staffIds)
      .returns<StaffConnectionRequestStaffSummary[]>();

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    for (const staff of data ?? []) {
      staffById.set(staff.id, staff);
    }
  }

  if (accountUserIds.length > 0) {
    const { data, error } = await supabase
      .from("users")
      .select(STAFF_CONNECTION_ACCOUNT_SELECT)
      .in("id", accountUserIds)
      .returns<StaffConnectionAccount[]>();

    if (error) {
      throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
    }

    for (const account of data ?? []) {
      accountById.set(account.id, {
        avatar_url: account.avatar_url,
        display_name: account.display_name,
        id: account.id,
        masked_email: maskEmail(account.email),
        masked_phone: maskPhone(account.phone),
        status: account.status,
      });
    }
  }

  return requests.map((request) => ({
    ...request,
    account: request.account_user_id
      ? accountById.get(request.account_user_id) ?? null
      : null,
    staff: request.staff_id ? staffById.get(request.staff_id) ?? null : null,
  }));
}

export async function getSalonStaffConnectionRequests() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new StaffSalonConnectionError(
      "MISSING_CONTEXT",
      "You must be logged in to view staff connection requests.",
    );
  }

  await requirePermission("staff.manage", context);

  if (
    !isSalonManageContext(context) ||
    !context.currentAccount ||
    !context.currentSalon
  ) {
    throw new StaffSalonConnectionError(
      "MISSING_CONTEXT",
      "Open staff connection requests from a Business workspace.",
    );
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new StaffSalonConnectionError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase environment variables are missing.",
    );
  }

  const { data, error } = await supabase
    .from("staff_salon_connection_requests")
    .select(STAFF_CONNECTION_REQUEST_SELECT)
    .eq("salon_id", context.currentSalon.id)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<StaffSalonConnectionRequest[]>();

  if (error) {
    throw new StaffSalonConnectionError("INVALID_INPUT", error.message);
  }

  return {
    context,
    requests: await enrichSalonConnectionRequests(supabase, data ?? []),
  };
}
