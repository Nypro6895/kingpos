"use server";

import { createHash, randomBytes } from "crypto";
import {
  STAFF_PERMISSIONS,
  createStaff as createStaffRecord,
  updateStaffDirectoryBatch as updateStaffDirectoryBatchInService,
  updateStaffPublicProfile,
} from "@/lib/staff";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import {
  SALON_PROFILE_MEDIA_BUCKET,
  buildSalonProfileMediaPath,
} from "@/lib/salon-profile-media";
import { resolveStaffAccountForSalon } from "@/lib/staff-account";
import {
  acceptStaffInvite as acceptStaffInviteInService,
  acceptStaffInviteByRequestId as acceptStaffInviteByRequestIdInService,
  cancelStaffSalonApplication as cancelStaffSalonApplicationInService,
  createSalonStaffInvite as createSalonStaffInviteInService,
  declineStaffInvite as declineStaffInviteInService,
  declineStaffInviteByRequestId as declineStaffInviteByRequestIdInService,
  getSalonStaffConnectionRequests as getSalonStaffConnectionRequestsInService,
  getStaffSalonConnectionError,
  resendSalonStaffInvite as resendSalonStaffInviteInService,
  reviewStaffSalonApplication as reviewStaffSalonApplicationInService,
  revokeSalonStaffInvite as revokeSalonStaffInviteInService,
  searchStaffAccountExact as searchStaffAccountExactInService,
  submitStaffSalonApplication as submitStaffSalonApplicationInService,
} from "@/lib/staff-salon-connections";
import {
  createAuthenticatedSupabaseServerClient,
  getAccessTokenFromRequest,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import { getSalonProfileHref } from "@/lib/salon-profile";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  CreateSalonStaffInviteInput,
  ReviewStaffSalonApplicationInput,
  StaffInviteEmailDelivery,
  SubmitStaffSalonApplicationInput,
} from "@/types/staff-salon-connection";
import type { UpdateStaffDirectoryBatchChange } from "@/types/staff";

type StaffConnectionActionResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      error: {
        code: string;
        message: string;
      };
      ok: false;
    };

type ActionInput = FormData | Record<string, unknown>;

export type StaffAvatarUploadSession = {
  accessToken: string;
  anonKey: string;
  bucket: string;
  path: string;
  salonId: string;
  supabaseUrl: string;
};

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

function readActionString(input: ActionInput, key: string) {
  const value = input instanceof FormData ? input.get(key) : input[key];

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readActionOptionalString(input: ActionInput, key: string) {
  return readActionString(input, key) || null;
}

function readActionBoolean(input: ActionInput, key: string) {
  const value = input instanceof FormData ? input.get(key) : input[key];

  if (typeof value === "boolean") {
    return value;
  }

  return value === "on" || value === "true";
}

function digestStaffPasscode(input: {
  passcode: string;
  salonId: string;
  salt: string;
  staffId: string;
}) {
  return createHash("sha256")
    .update(`${input.salonId}:${input.staffId}:${input.passcode}:${input.salt}`)
    .digest("hex");
}

function validateStaffPasscodeFormat(passcode: string) {
  return /^\d{4,8}$/.test(passcode);
}

function getStaffPasscodeHash(input: {
  passcode: string;
  salonId: string;
  staffId: string;
}) {
  const salt = randomBytes(16).toString("hex");

  return {
    passcode_digest: digestStaffPasscode({
      passcode: input.passcode,
      salonId: input.salonId,
      salt,
      staffId: input.staffId,
    }),
    passcode_is_default: input.passcode === "1234",
    passcode_salt: salt,
  };
}

function getConnectionActionError(error: unknown) {
  const connectionError = getStaffSalonConnectionError(error);

  return {
    error: {
      code: connectionError.code,
      message: connectionError.message,
    },
    ok: false as const,
  };
}

function parseSalonStaffInviteInput(input: ActionInput): CreateSalonStaffInviteInput {
  const mode = readActionString(input, "mode");
  const base = {
    email: readActionOptionalString(input, "email"),
    first_name: readActionOptionalString(input, "first_name"),
    is_active: readActionBoolean(input, "is_active"),
    job_title: readActionOptionalString(input, "job_title"),
    last_name: readActionOptionalString(input, "last_name"),
    phone: readActionOptionalString(input, "phone"),
  };

  if (mode === "existing_account") {
    return {
      ...base,
      account_user_id: readActionString(input, "account_user_id"),
      display_name: readActionOptionalString(input, "display_name"),
      mode,
      staff_id: readActionOptionalString(input, "staff_id"),
    };
  }

  if (mode === "new_account") {
    return {
      ...base,
      display_name: readActionString(input, "display_name"),
      mode,
    };
  }

  throw new Error("Invite mode must be existing_account or new_account.");
}

function redirectWithError(message: string): never {
  redirect(`/staff?add=1&error=${encodeURIComponent(message)}`);
}

function redirectWithConnectionError(path: "/staff" | "/staff/connections", message: string): never {
  redirect(`${path}?connection_error=${encodeURIComponent(message)}`);
}

function redirectWithInviteToken(input: {
  emailDelivery?: StaffInviteEmailDelivery;
  message: string;
  requestId: string;
  staffId?: string | null;
  token: string;
}): never {
  const message = getInviteDeliveryNotice(input.message, input.emailDelivery);
  const params = new URLSearchParams({
    connection_notice: message,
    invite_request: input.requestId,
    invite_token: input.token,
  });

  if (input.staffId) {
    params.set("staff", input.staffId);
  }

  redirect(`/staff?${params.toString()}`);
}

function getInviteDeliveryNotice(
  message: string,
  delivery?: StaffInviteEmailDelivery,
) {
  if (!delivery) {
    return message;
  }

  if (delivery.status === "sent") {
    return `${message} Email sent to ${delivery.recipient}.`;
  }

  if (delivery.status === "failed") {
    return `${message} Email delivery failed: ${delivery.reason}`;
  }

  return `${message} Email not sent: ${delivery.reason}`;
}

function revalidateStaffInviteWorkspaceContext() {
  revalidatePath("/staff/connections");
  revalidatePath("/my-place");
  revalidatePath("/", "layout");
}

function parseApplicationInput(input: ActionInput): SubmitStaffSalonApplicationInput {
  return {
    message: readActionOptionalString(input, "message"),
    requested_job_title: readActionOptionalString(input, "requested_job_title"),
    salon_id: readActionString(input, "salon_id"),
  };
}

function parseReviewApplicationInput(
  input: ActionInput,
): ReviewStaffSalonApplicationInput {
  const requestId = readActionString(input, "request_id");
  const decision = readActionString(input, "decision");

  if (decision === "declined") {
    return {
      decision,
      request_id: requestId,
    };
  }

  if (decision === "accepted") {
    const staffId = readActionOptionalString(input, "staff_id");

    return {
      decision,
      display_name: readActionOptionalString(input, "display_name"),
      email: readActionOptionalString(input, "email"),
      job_title: readActionOptionalString(input, "job_title"),
      phone: readActionOptionalString(input, "phone"),
      request_id: requestId,
      staff_id: staffId === "__new" ? null : staffId,
    };
  }

  throw new Error("Application decision must be accepted or declined.");
}

export async function createStaff(formData: FormData) {
  const displayName = readRequiredString(formData, "display_name");
  const parsedName = splitFullName(displayName);

  if (!displayName) {
    redirectWithError("Full Name is required.");
  }

  try {
    await createStaffRecord({
      address_line1: readOptionalString(formData, "address_line1"),
      address_line2: readOptionalString(formData, "address_line2"),
      city: readOptionalString(formData, "city"),
      display_name: displayName,
      first_name: readOptionalString(formData, "first_name") ?? parsedName.firstName,
      last_name: readOptionalString(formData, "last_name") ?? parsedName.lastName,
      phone: readOptionalString(formData, "phone"),
      email: readOptionalString(formData, "email"),
      job_title: readOptionalString(formData, "job_title"),
      postal_code: readOptionalString(formData, "postal_code"),
      pos_enabled: true,
      state: readOptionalString(formData, "state"),
      is_active: formData.get("is_active") === "on",
    });
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Staff could not be created.");
  }

  revalidatePath("/staff");
  redirect("/staff");
}

function readBatchOptionalString(
  formData: FormData,
  field: string,
  staffId: string,
) {
  return readOptionalString(formData, `${field}_${staffId}`);
}

function readBatchRequiredString(
  formData: FormData,
  field: string,
  staffId: string,
) {
  return readRequiredString(formData, `${field}_${staffId}`);
}

function readBatchBoolean(formData: FormData, field: string, staffId: string) {
  return formData.get(`${field}_${staffId}`) === "on";
}

function getStaffDirectoryRedirectHref(
  formData: FormData,
  noticeKey: "connection_error" | "connection_notice",
  message: string,
) {
  const params = new URLSearchParams({
    [noticeKey]: message,
  });
  const query = readRequiredString(formData, "q");

  if (query) {
    params.set("q", query);
  }

  return `/staff?${params.toString()}`;
}

export async function updateStaffDirectoryBatchFormAction(formData: FormData) {
  const staffIds = Array.from(
    new Set(
      formData
        .getAll("staff_id")
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const changes = staffIds.map<UpdateStaffDirectoryBatchChange>((staffId) => ({
    address_line1: readBatchOptionalString(formData, "address_line1", staffId),
    address_line2: readBatchOptionalString(formData, "address_line2", staffId),
    city: readBatchOptionalString(formData, "city", staffId),
    display_name: readBatchRequiredString(formData, "display_name", staffId),
    email: readBatchOptionalString(formData, "email", staffId),
    first_name: splitFullName(
      readBatchOptionalString(formData, "full_name", staffId),
    ).firstName,
    is_active: readBatchBoolean(formData, "is_active", staffId),
    job_title: readBatchOptionalString(formData, "job_title", staffId),
    last_name: splitFullName(
      readBatchOptionalString(formData, "full_name", staffId),
    ).lastName,
    online_booking_enabled: readBatchBoolean(
      formData,
      "online_booking_enabled",
      staffId,
    ),
    owner_public_enabled: readBatchBoolean(
      formData,
      "owner_public_enabled",
      staffId,
    ),
    phone: readBatchOptionalString(formData, "phone", staffId),
    postal_code: readBatchOptionalString(formData, "postal_code", staffId),
    pos_enabled: readBatchBoolean(formData, "pos_enabled", staffId),
    salon_profile_content_posting_enabled: readBatchBoolean(
      formData,
      "owner_public_enabled",
      staffId,
    ),
    staff_id: staffId,
    state: readBatchOptionalString(formData, "state", staffId),
  }));

  try {
    await updateStaffDirectoryBatchInService({ changes });
  } catch (error) {
    redirect(
      getStaffDirectoryRedirectHref(
        formData,
        "connection_error",
        error instanceof Error ? error.message : "Staff changes could not be saved.",
      ),
    );
  }

  const context = await getCurrentBusinessContext();

  revalidatePath("/staff");
  revalidatePath("/staff/my-work");
  revalidatePath("/bookings");
  revalidatePath("/pos");
  revalidatePath("/salon-profile");

  if (context.currentSalon) {
    revalidatePath(getSalonProfileHref(context.currentSalon.id));
  }

  redirect(
    getStaffDirectoryRedirectHref(
      formData,
      "connection_notice",
      "Staff changes saved.",
    ),
  );
}

export async function resetStaffPasscodeFormAction(formData: FormData) {
  const staffId = readRequiredString(formData, "reset_staff_id");
  const passcode = staffId
    ? readRequiredString(formData, `new_passcode_${staffId}`)
    : "";

  if (!staffId) {
    redirect(
      getStaffDirectoryRedirectHref(
        formData,
        "connection_error",
        "Choose a staff profile before resetting a passcode.",
      ),
    );
  }

  if (!validateStaffPasscodeFormat(passcode)) {
    redirect(
      getStaffDirectoryRedirectHref(
        formData,
        "connection_error",
        "Staff passcode must be 4-8 digits.",
      ),
    );
  }

  const context = await getCurrentBusinessContext();

  if (!context.user || !context.currentSalon) {
    redirect(
      getStaffDirectoryRedirectHref(
        formData,
        "connection_error",
        "Choose a salon workspace before resetting a staff passcode.",
      ),
    );
  }

  if (!(await hasPermission(STAFF_PERMISSIONS.manage, context))) {
    redirect(
      getStaffDirectoryRedirectHref(
        formData,
        "connection_error",
        "You do not have permission to reset staff passcodes.",
      ),
    );
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    redirect(
      getStaffDirectoryRedirectHref(
        formData,
        "connection_error",
        "Supabase environment variables are missing.",
      ),
    );
  }

  const { data: staff, error: loadError } = await supabase
    .from("staff")
    .select("id")
    .eq("id", staffId)
    .eq("salon_id", context.currentSalon.id)
    .maybeSingle<{ id: string }>();

  if (loadError || !staff) {
    redirect(
      getStaffDirectoryRedirectHref(
        formData,
        "connection_error",
        loadError?.message ?? "Staff profile was not found.",
      ),
    );
  }

  const { error } = await supabase
    .from("staff")
    .update(
      getStaffPasscodeHash({
        passcode,
        salonId: context.currentSalon.id,
        staffId,
      }),
    )
    .eq("id", staffId)
    .eq("salon_id", context.currentSalon.id);

  if (error) {
    console.error("Supabase reset staff passcode failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: context.currentSalon.id,
      staffId,
      userId: context.user.id,
    });
    redirect(
      getStaffDirectoryRedirectHref(
        formData,
        "connection_error",
        error.message,
      ),
    );
  }

  revalidatePath("/staff");
  revalidatePath("/staff/my-work");
  revalidatePath("/pos");
  revalidatePath("/pos/portable");
  revalidatePath("/pos/portable/check-in");

  redirect(
    getStaffDirectoryRedirectHref(
      formData,
      "connection_notice",
      "Staff passcode reset.",
    ),
  );
}

function readActionStringList(input: ActionInput, key: string) {
  const value = input instanceof FormData ? input.get(key) : input[key];

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function assertCanMutateStaffPublicProfile(staffId: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user || !context.currentSalon) {
    throw new Error("Choose a salon workspace before updating staff.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [canManageStaff, staffResolution] = await Promise.all([
    hasPermission(STAFF_PERMISSIONS.manage, context),
    resolveStaffAccountForSalon({ context, supabase }),
  ]);
  const canEditSelf =
    staffResolution.status === "found" && staffResolution.staff.id === staffId;

  if (!canManageStaff && !canEditSelf) {
    throw new Error("You can only update your own public staff profile.");
  }

  const { data: staff, error } = await supabase
    .from("staff")
    .select("id")
    .eq("id", staffId)
    .eq("salon_id", context.currentSalon.id)
    .maybeSingle<{ id: string }>();

  if (error || !staff) {
    throw new Error(error?.message ?? "Staff profile was not found.");
  }

  return { context, supabase };
}

export async function getStaffProfileAvatarUploadSessionAction(
  staffId: string,
): Promise<StaffAvatarUploadSession> {
  const [accessToken, permissionContext] = await Promise.all([
    getAccessTokenFromRequest(),
    assertCanMutateStaffPublicProfile(staffId),
  ]);
  const config = getSupabaseConfig();

  if (!config || !accessToken) {
    throw new Error("Sign in before uploading staff media.");
  }

  const path = buildSalonProfileMediaPath({
    kind: "staffAvatar",
    salonId: permissionContext.context.currentSalon!.id,
    staffId,
  });
  const { error } = await permissionContext.supabase
    .from("salon_profile_media_assets")
    .insert({
      bucket: SALON_PROFILE_MEDIA_BUCKET,
      object_path: path,
      purpose: "staff_avatar",
      salon_id: permissionContext.context.currentSalon!.id,
      status: "pending",
      upload_intent: "staff",
      uploaded_by_user_id: permissionContext.context.user!.id,
    });

  if (error) {
    console.error("Supabase reserve staff profile avatar failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      staffId,
    });
    throw new Error(error.message);
  }

  return {
    accessToken,
    anonKey: config.supabaseAnonKey,
    bucket: SALON_PROFILE_MEDIA_BUCKET,
    path,
    salonId: permissionContext.context.currentSalon!.id,
    supabaseUrl: config.supabaseUrl,
  };
}

export async function updateStaffPublicProfileAction(
  input: ActionInput,
): Promise<{ error: string | null }> {
  const staffId = readActionString(input, "staff_id");

  if (!staffId) {
    return { error: "Staff profile is required." };
  }

  try {
    await updateStaffPublicProfile({
      displayName: readActionOptionalString(input, "display_name"),
      jobTitle: readActionOptionalString(input, "job_title"),
      publicBio: readActionOptionalString(input, "public_bio"),
      publicProfilePhotoPath: readActionOptionalString(
        input,
        "public_profile_photo_path",
      ),
      staffPublicConsentStatus: readActionBoolean(input, "appear_publicly")
        ? "granted"
        : "opted_out",
      removePhoto: readActionBoolean(input, "remove_photo"),
      specialties: readActionStringList(input, "specialties"),
      staffId,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Staff public profile could not be saved.",
    };
  }

  const context = await getCurrentBusinessContext();

  revalidatePath("/staff");
  revalidatePath("/staff/my-work");
  revalidatePath("/salon-profile");

  if (context.currentSalon) {
    revalidatePath(getSalonProfileHref(context.currentSalon.id));
  }

  return { error: null };
}

export async function updateOwnStaffPasscodeAction(
  input: ActionInput,
): Promise<{ error: string | null }> {
  const currentPasscode = readActionString(input, "current_passcode");
  const newPasscode = readActionString(input, "new_passcode");
  const confirmPasscode = readActionString(input, "confirm_passcode");
  const requestedStaffId = readActionString(input, "staff_id");

  if (!currentPasscode) {
    return { error: "Current staff passcode is required." };
  }

  if (!validateStaffPasscodeFormat(newPasscode)) {
    return { error: "New staff passcode must be 4-8 digits." };
  }

  if (newPasscode !== confirmPasscode) {
    return { error: "New staff passcodes do not match." };
  }

  const context = await getCurrentBusinessContext();

  if (!context.user || !context.currentSalon) {
    return { error: "Choose a salon workspace before changing your passcode." };
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return { error: "Supabase environment variables are missing." };
  }

  const staffResolution = await resolveStaffAccountForSalon({
    context,
    supabase,
  });

  if (staffResolution.status !== "found") {
    return { error: "Your staff profile is not connected to this salon." };
  }

  const staffId = staffResolution.staff.id;

  if (requestedStaffId && requestedStaffId !== staffId) {
    return { error: "You can only change your own staff passcode." };
  }

  const { error: validationError } = await supabase.rpc(
    "validate_staff_passcode_or_raise",
    {
      p_passcode: currentPasscode,
      p_salon_id: context.currentSalon.id,
      p_scope: "staff_self_passcode_change",
      p_staff_id: staffId,
    },
  );

  if (validationError) {
    return { error: validationError.message };
  }

  const { error } = await supabase
    .from("staff")
    .update(
      getStaffPasscodeHash({
        passcode: newPasscode,
        salonId: context.currentSalon.id,
        staffId,
      }),
    )
    .eq("id", staffId)
    .eq("salon_id", context.currentSalon.id);

  if (error) {
    console.error("Supabase update own staff passcode failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: context.currentSalon.id,
      staffId,
      userId: context.user.id,
    });
    return { error: error.message };
  }

  revalidatePath("/staff");
  revalidatePath("/staff/my-work");
  revalidatePath("/pos");
  revalidatePath("/pos/portable");
  revalidatePath("/pos/portable/check-in");

  return { error: null };
}

export async function searchStaffAccountExactAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<
    Awaited<ReturnType<typeof searchStaffAccountExactInService>>
  >
> {
  try {
    const data = await searchStaffAccountExactInService({
      email: readActionOptionalString(input, "email"),
      phone: readActionOptionalString(input, "phone"),
    });

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function createSalonStaffInviteAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<
    Awaited<ReturnType<typeof createSalonStaffInviteInService>>
  >
> {
  try {
    const data = await createSalonStaffInviteInService(
      parseSalonStaffInviteInput(input),
    );

    revalidatePath("/staff");

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function createSalonStaffInviteFormAction(formData: FormData) {
  let result: Awaited<ReturnType<typeof createSalonStaffInviteInService>>;

  try {
    result = await createSalonStaffInviteInService(
      parseSalonStaffInviteInput(formData),
    );
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirectWithError(connectionError.message);
  }

  revalidatePath("/staff");
  redirectWithInviteToken({
    emailDelivery: result.email_delivery,
    message: "Invitation created.",
    requestId: result.request.id,
    token: result.invite_token,
  });
}

export async function resendSalonStaffInviteAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<
    Awaited<ReturnType<typeof resendSalonStaffInviteInService>>
  >
> {
  try {
    const data = await resendSalonStaffInviteInService(
      readActionString(input, "request_id"),
    );

    revalidatePath("/staff");

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function resendSalonStaffInviteFormAction(formData: FormData) {
  let result: Awaited<ReturnType<typeof resendSalonStaffInviteInService>>;
  const staffId = readOptionalString(formData, "staff_id");

  try {
    result = await resendSalonStaffInviteInService(
      readRequiredString(formData, "request_id"),
    );
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirectWithConnectionError("/staff", connectionError.message);
  }

  revalidatePath("/staff");
  redirectWithInviteToken({
    emailDelivery: result.email_delivery,
    message: "Invitation resent. Old invite links are now invalid.",
    requestId: result.result.request_id,
    staffId,
    token: result.invite_token,
  });
}

export async function revokeSalonStaffInviteAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<
    Awaited<ReturnType<typeof revokeSalonStaffInviteInService>>
  >
> {
  try {
    const data = await revokeSalonStaffInviteInService(
      readActionString(input, "request_id"),
    );

    revalidatePath("/staff");

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function revokeSalonStaffInviteFormAction(formData: FormData) {
  try {
    await revokeSalonStaffInviteInService(
      readRequiredString(formData, "request_id"),
    );
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirectWithConnectionError("/staff", connectionError.message);
  }

  revalidatePath("/staff");
  redirect("/staff?connection_notice=Invitation revoked.");
}

export async function reviewStaffSalonApplicationAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<
    Awaited<ReturnType<typeof reviewStaffSalonApplicationInService>>
  >
> {
  try {
    const data = await reviewStaffSalonApplicationInService(
      parseReviewApplicationInput(input),
    );

    revalidatePath("/staff");

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function reviewStaffSalonApplicationFormAction(formData: FormData) {
  try {
    await reviewStaffSalonApplicationInService(
      parseReviewApplicationInput(formData),
    );
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirectWithConnectionError("/staff", connectionError.message);
  }

  revalidatePath("/staff");
  redirect("/staff?connection_notice=Application reviewed.");
}

export async function submitStaffSalonApplicationAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<
    Awaited<ReturnType<typeof submitStaffSalonApplicationInService>>
  >
> {
  try {
    const data = await submitStaffSalonApplicationInService(
      parseApplicationInput(input),
    );

    revalidatePath("/staff/connections");

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function submitStaffSalonApplicationFormAction(formData: FormData) {
  try {
    await submitStaffSalonApplicationInService(parseApplicationInput(formData));
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirectWithConnectionError("/staff/connections", connectionError.message);
  }

  revalidatePath("/staff/connections");
  redirect("/staff/connections?connection_notice=Application submitted.");
}

export async function cancelStaffSalonApplicationAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<
    Awaited<ReturnType<typeof cancelStaffSalonApplicationInService>>
  >
> {
  try {
    const data = await cancelStaffSalonApplicationInService(
      readActionString(input, "request_id"),
    );

    revalidatePath("/staff/connections");

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function cancelStaffSalonApplicationFormAction(formData: FormData) {
  try {
    await cancelStaffSalonApplicationInService(
      readRequiredString(formData, "request_id"),
    );
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirectWithConnectionError("/staff/connections", connectionError.message);
  }

  revalidatePath("/staff/connections");
  redirect("/staff/connections?connection_notice=Application cancelled.");
}

export async function acceptStaffInviteAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<Awaited<ReturnType<typeof acceptStaffInviteInService>>>
> {
  try {
    const data = await acceptStaffInviteInService(readActionString(input, "token"));

    revalidateStaffInviteWorkspaceContext();

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function declineStaffInviteAction(
  input: ActionInput,
): Promise<
  StaffConnectionActionResult<Awaited<ReturnType<typeof declineStaffInviteInService>>>
> {
  try {
    const data = await declineStaffInviteInService(readActionString(input, "token"));

    revalidatePath("/staff/connections");

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}

export async function acceptStaffInviteByRequestFormAction(formData: FormData) {
  try {
    await acceptStaffInviteByRequestIdInService(
      readRequiredString(formData, "request_id"),
    );
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirectWithConnectionError("/staff/connections", connectionError.message);
  }

  revalidateStaffInviteWorkspaceContext();
  redirect("/staff/connections?connection_notice=Invitation accepted.");
}

export async function declineStaffInviteByRequestFormAction(formData: FormData) {
  try {
    await declineStaffInviteByRequestIdInService(
      readRequiredString(formData, "request_id"),
    );
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirectWithConnectionError("/staff/connections", connectionError.message);
  }

  revalidatePath("/staff/connections");
  redirect("/staff/connections?connection_notice=Invitation declined.");
}

export async function acceptStaffInviteTokenFormAction(formData: FormData) {
  try {
    await acceptStaffInviteInService(readRequiredString(formData, "token"));
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirect(
      `/staff/invite/${encodeURIComponent(
        readRequiredString(formData, "token"),
      )}?connection_error=${encodeURIComponent(connectionError.message)}`,
    );
  }

  revalidateStaffInviteWorkspaceContext();
  redirect("/staff/connections?connection_notice=Invitation accepted.");
}

export async function declineStaffInviteTokenFormAction(formData: FormData) {
  try {
    await declineStaffInviteInService(readRequiredString(formData, "token"));
  } catch (error) {
    const connectionError = getStaffSalonConnectionError(error);
    redirect(
      `/staff/invite/${encodeURIComponent(
        readRequiredString(formData, "token"),
      )}?connection_error=${encodeURIComponent(connectionError.message)}`,
    );
  }

  revalidatePath("/staff/connections");
  redirect("/staff/connections?connection_notice=Invitation declined.");
}

export async function listSalonStaffConnectionRequestsAction(): Promise<
  StaffConnectionActionResult<
    Awaited<ReturnType<typeof getSalonStaffConnectionRequestsInService>>
  >
> {
  try {
    const data = await getSalonStaffConnectionRequestsInService();

    return { data, ok: true };
  } catch (error) {
    return getConnectionActionError(error);
  }
}
