"use server";

import {
  getCreateSalonAccount,
  getCurrentBusinessContext,
  getCurrentStaffBusinessContext,
  getWorkspaceLandingHref,
  getManageWorkspaceId,
  getStaffWorkspaceId,
  isWorkspaceDestinationAllowed,
  isOwnerMembership,
  setCurrentManageSalonCookie,
  setNormalizedWorkspaceContext,
  type CurrentWorkspaceOption,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { routes, withSearchParams } from "@/lib/routes";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const MANAGE_SALON_SWITCH_PERMISSIONS = [
  "booking.view",
  "customers.view",
  "payroll.manage",
  "payroll.view",
  "reports.view",
  "salon_settings.view",
  "services.view",
  "staff.view",
  "tickets.manage",
  "tickets.view",
] as const;

function redirectWithError(message: string): never {
  redirect(withSearchParams(routes.salons.list(), { error: message }));
}

function redirectCreateSalonWithError(message: string): never {
  redirect(withSearchParams(routes.salons.create(), { error: message }));
}

function redirectStaffWithError(message: string): never {
  redirect(`/staff/my-work?error=${encodeURIComponent(message)}`);
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function readOptionalFormString(formData: FormData, key: string) {
  const value = readFormString(formData, key);
  return value || null;
}

function readInputString(input: string | null | undefined) {
  return typeof input === "string" ? input.trim() : "";
}

function redirectMyPlaceWithError(message: string): never {
  redirect(`/my-place?error=${encodeURIComponent(message)}`);
}

export async function createSalonAction(formData: FormData) {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await getCurrentBusinessContext();

  if (!supabase || !context.user) {
    redirect(withSearchParams("/login", { next: routes.salons.create() }));
  }

  const account = getCreateSalonAccount(context);

  if (!account) {
    redirectCreateSalonWithError("You do not have permission to create a salon.");
  }

  const accountId = account.id;

  if (!accountId) {
    redirectCreateSalonWithError("Choose an Account workspace before creating a salon.");
  }

  if (account.status !== "active") {
    redirectCreateSalonWithError("Choose an active Account before creating a salon.");
  }

  const name = readFormString(formData, "name");
  const createRequestKey = readFormString(formData, "create_request_key");

  if (!name) {
    redirectCreateSalonWithError("Salon name is required.");
  }

  if (!createRequestKey) {
    redirectCreateSalonWithError("Create request key is required. Refresh and try again.");
  }

  const { data, error } = await supabase.rpc("create_account_salon", {
    p_account_id: accountId,
    p_address_line1: readOptionalFormString(formData, "address_line1"),
    p_address_line2: readOptionalFormString(formData, "address_line2"),
    p_city: readOptionalFormString(formData, "city"),
    p_country: "US",
    p_create_request_key: createRequestKey,
    p_name: name,
    p_phone: readOptionalFormString(formData, "phone"),
    p_postal_code: readOptionalFormString(formData, "postal_code"),
    p_state: readOptionalFormString(formData, "state"),
  });

  if (error) {
    console.error("Supabase create salon failed", {
      accountId,
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      userId: context.user.id,
    });
    redirectCreateSalonWithError("Unable to create salon.");
  }

  const result =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const salonId = typeof result.salon_id === "string" ? result.salon_id : null;

  if (!salonId) {
    console.error("Supabase create salon returned no salon id", {
      accountId,
      result,
      userId: context.user.id,
    });
    redirectCreateSalonWithError("Unable to create salon.");
  }

  await setCurrentManageSalonCookie(salonId);

  revalidatePath(routes.salons.list());
  revalidatePath(routes.salons.create());
  revalidatePath("/", "layout");
  redirect(withSearchParams(routes.salons.list(), { created: "1" }));
}

export type WorkspaceDestinationActionResult =
  | {
      href: string;
      ok: true;
    }
  | {
      message: string;
      ok: false;
    };

async function switchWorkspaceToDestination(input: {
  destinationHref: string;
  workspaceId: string;
}): Promise<WorkspaceDestinationActionResult> {
  const workspaceId = readInputString(input.workspaceId);
  const destinationHref = readInputString(input.destinationHref);

  if (!workspaceId) {
    return { message: "Choose a workspace before opening it.", ok: false };
  }

  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { message: "Sign in again before opening a workspace.", ok: false };
  }

  const workspace = context.workspaceOptions.find(
    (option) => option.id === workspaceId,
  );

  if (!workspace) {
    return {
      message: "You no longer have access to that workspace.",
      ok: false,
    };
  }

  const href = destinationHref || getWorkspaceLandingHref(workspace);

  if (!isWorkspaceDestinationAllowed(workspace, href)) {
    return {
      message: "That shortcut is no longer available for this workspace.",
      ok: false,
    };
  }

  try {
    await setNormalizedWorkspaceContext(workspace);
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Workspace context could not be updated.",
      ok: false,
    };
  }

  revalidatePath("/", "layout");
  refresh();
  return { href, ok: true };
}

export async function switchWorkspaceDestination(input: {
  destinationHref: string;
  workspaceId: string;
}): Promise<WorkspaceDestinationActionResult> {
  return switchWorkspaceToDestination(input);
}

export async function switchWorkspaceLanding(input: {
  workspaceId: string;
}): Promise<WorkspaceDestinationActionResult> {
  return switchWorkspaceToDestination({
    destinationHref: "",
    workspaceId: input.workspaceId,
  });
}

export async function switchWorkspaceDestinationFormAction(formData: FormData) {
  const result = await switchWorkspaceToDestination({
    destinationHref: readFormString(formData, "destination_href"),
    workspaceId: readFormString(formData, "workspace_id"),
  });

  if (!result.ok) {
    redirectMyPlaceWithError(result.message);
  }

  redirect(result.href);
}

export async function setCurrentWorkspace(formData: FormData) {
  const workspaceId = readFormString(formData, "workspace_id");

  if (!workspaceId) {
    redirect("/my-place?error=Choose a workspace before switching.");
  }

  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect("/login");
  }

  const workspace = context.workspaceOptions.find((option) => option.id === workspaceId);

  if (!workspace) {
    redirect("/my-place?error=You can only switch to a workspace connected to your account.");
  }

  await setNormalizedWorkspaceContext(workspace);

  revalidatePath("/", "layout");
  redirect(getWorkspaceLandingHref(workspace));
}

export async function setCurrentSalon(formData: FormData) {
  const salonId = formData.get("salon_id");

  if (typeof salonId !== "string" || !salonId.trim()) {
    redirectWithError("Choose a salon before setting the current salon.");
  }

  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect("/login");
  }

  const requestedSalon = context.availableManageSalons.find(
    (salon) => salon.id === salonId.trim(),
  );
  const workspace = requestedSalon
    ? context.workspaceOptions.find(
        (option): option is CurrentWorkspaceOption =>
          option.id === getManageWorkspaceId(requestedSalon.id),
      )
    : null;

  const canSwitchManagedSalon =
    Boolean(workspace) ||
    isOwnerMembership(context.currentMembership) ||
    (context.currentMembership
      ? (
          await Promise.all(
            MANAGE_SALON_SWITCH_PERMISSIONS.map((permission) =>
              hasPermission(permission, context),
            ),
          )
        ).some(Boolean)
      : false);

  if (!canSwitchManagedSalon) {
    redirectWithError("You do not have permission to switch the current salon.");
  }

  const allowedSalon = requestedSalon;

  if (!allowedSalon) {
    console.error("Blocked current Salon switch outside accessible account", {
      requestedSalonId: salonId,
      accountId: context.accountId,
      userId: context.user.id,
    });
    redirectWithError("You can only switch to a salon connected to your Account.");
  }

  if (!workspace) {
    redirectWithError("You can only switch to a salon connected to your Account.");
  }

  await setNormalizedWorkspaceContext(workspace);
  revalidatePath("/", "layout");
  redirect(getWorkspaceLandingHref(workspace));
}

export async function setCurrentStaffSalon(formData: FormData) {
  const salonId = formData.get("salon_id");

  if (typeof salonId !== "string" || !salonId.trim()) {
    redirectStaffWithError("Choose a salon before opening My Work.");
  }

  const context = await getCurrentStaffBusinessContext();

  if (!context.user) {
    redirect("/login");
  }

  const allowedSalon = context.staffSalons.find(
    (salon) => salon.id === salonId.trim(),
  );

  if (!allowedSalon) {
    console.error("Blocked staff Salon switch outside linked salons", {
      requestedSalonId: salonId,
      userId: context.user.id,
    });
    redirectStaffWithError("You can only switch to a salon linked to your staff account.");
  }

  const workspace = context.workspaceOptions.find(
    (option): option is CurrentWorkspaceOption =>
      option.id === getStaffWorkspaceId(allowedSalon.id),
  );

  if (!workspace) {
    redirectStaffWithError("You can only switch to a salon linked to your staff account.");
  }

  await setNormalizedWorkspaceContext(workspace);
  revalidatePath("/", "layout");
  redirect(getWorkspaceLandingHref(workspace));
}
