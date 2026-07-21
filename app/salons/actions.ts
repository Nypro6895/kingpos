"use server";

import {
  getCurrentBusinessContext,
  getCurrentStaffBusinessContext,
  getManageWorkspaceId,
  getStaffWorkspaceId,
  isWorkspaceDestinationAllowed,
  isOwnerMembership,
  setNormalizedWorkspaceContext,
  type CurrentWorkspaceOption,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
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
  redirect(`/salons?error=${encodeURIComponent(message)}`);
}

function redirectStaffWithError(message: string): never {
  redirect(`/staff/my-work?error=${encodeURIComponent(message)}`);
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function readInputString(input: string | null | undefined) {
  return typeof input === "string" ? input.trim() : "";
}

function redirectMyPlaceWithError(message: string): never {
  redirect(`/my-place?error=${encodeURIComponent(message)}`);
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

async function getManageDefaultRedirect(context: Awaited<ReturnType<typeof getCurrentBusinessContext>>) {
  if (await hasPermission("tickets.manage", context)) {
    return "/pos";
  }

  if (await hasPermission("staff.view", context)) {
    return "/staff";
  }

  if (await hasPermission("booking.view", context)) {
    return "/bookings";
  }

  if (await hasPermission("customers.view", context)) {
    return "/customers";
  }

  if (await hasPermission("services.view", context)) {
    return "/services";
  }

  if (
    (await hasPermission("payroll.view", context)) ||
    (await hasPermission("payroll.manage", context))
  ) {
    return "/payroll";
  }

  if (await hasPermission("reports.view", context)) {
    return "/reports";
  }

  if (await hasPermission("salon_settings.view", context)) {
    return "/salon-settings";
  }

  return "/my-place";
}

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

  const href = destinationHref || workspace.defaultHref;

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
  redirect(workspace.defaultHref);
}

export async function setCurrentSalon(formData: FormData) {
  const salonId = formData.get("salon_id");

  if (typeof salonId !== "string" || !salonId.trim()) {
    redirectWithError("Choose a Salon before setting the current Salon.");
  }

  const context = await getCurrentBusinessContext();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentOrganization || !context.currentMembership) {
    redirectWithError("Create an organization before choosing a current Salon.");
  }

  const canSwitchManagedSalon =
    isOwnerMembership(context.currentMembership) ||
    (
      await Promise.all(
        MANAGE_SALON_SWITCH_PERMISSIONS.map((permission) =>
          hasPermission(permission, context),
        ),
      )
    ).some(Boolean);

  if (!canSwitchManagedSalon) {
    redirectWithError("You do not have permission to switch the current Salon.");
  }

  const allowedSalon = context.salons.find((salon) => salon.id === salonId.trim());

  if (!allowedSalon) {
    console.error("Blocked current Salon switch outside current organization", {
      requestedSalonId: salonId,
      organizationId: context.currentOrganization.id,
      userId: context.user.id,
    });
    redirectWithError("You can only switch to a Salon in your organization.");
  }

  const selectedContext = {
    ...context,
    currentSalon: allowedSalon,
    salonId: allowedSalon.id,
    salonMode: "manage" as const,
    workspaceType: "salon" as const,
  };
  const redirectTo = await getManageDefaultRedirect(selectedContext);

  const workspace = context.workspaceOptions.find(
    (option): option is CurrentWorkspaceOption =>
      option.id === getManageWorkspaceId(allowedSalon.id),
  );

  if (!workspace) {
    redirectWithError("You can only switch to a Salon connected to your account.");
  }

  await setNormalizedWorkspaceContext(workspace);
  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function setCurrentStaffSalon(formData: FormData) {
  const salonId = formData.get("salon_id");

  if (typeof salonId !== "string" || !salonId.trim()) {
    redirectStaffWithError("Choose a Salon before opening My Work.");
  }

  const context = await getCurrentStaffBusinessContext();

  if (!context.user) {
    redirect("/login");
  }

  const allowedSalon = context.staffSalons.find(
    (salon) => salon.id === salonId.trim(),
  );

  if (!allowedSalon) {
    console.error("Blocked staff Salon switch outside linked staff salons", {
      requestedSalonId: salonId,
      userId: context.user.id,
    });
    redirectStaffWithError("You can only switch to a Salon linked to your staff account.");
  }

  const workspace = context.workspaceOptions.find(
    (option): option is CurrentWorkspaceOption =>
      option.id === getStaffWorkspaceId(allowedSalon.id),
  );

  if (!workspace) {
    redirectStaffWithError("You can only switch to a Salon linked to your staff account.");
  }

  await setNormalizedWorkspaceContext(workspace);
  revalidatePath("/", "layout");
  redirect("/staff/my-work");
}
