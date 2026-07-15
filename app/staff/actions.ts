"use server";

import { createStaff as createStaffRecord } from "@/lib/staff";
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
