"use server";

import {
  STAFF_PERMISSIONS,
  createStaff as createStaffRecord,
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
  SubmitStaffSalonApplicationInput,
} from "@/types/staff-salon-connection";

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
  message: string;
  requestId: string;
  token: string;
}): never {
  const params = new URLSearchParams({
    add: "1",
    connection_notice: input.message,
    invite_request: input.requestId,
    invite_token: input.token,
  });

  redirect(`/staff?${params.toString()}`);
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

  if (!displayName) {
    redirectWithError("Display Name is required.");
  }

  try {
    await createStaffRecord({
      display_name: displayName,
      first_name: readOptionalString(formData, "first_name"),
      last_name: readOptionalString(formData, "last_name"),
      phone: readOptionalString(formData, "phone"),
      email: readOptionalString(formData, "email"),
      job_title: readOptionalString(formData, "job_title"),
      is_active: formData.get("is_active") === "on",
    });
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Staff could not be created.");
  }

  revalidatePath("/staff");
  redirect("/staff");
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
    message: "Invitation resent. Old invite links are now invalid.",
    requestId: result.result.request_id,
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

    revalidatePath("/staff/connections");

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

  revalidatePath("/staff/connections");
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

  revalidatePath("/staff/connections");
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
