import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { getServiceBookingReadiness } from "@/lib/service-contract";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { STAFF_SELECT } from "@/lib/staff";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { StaffServiceAssignment } from "@/types/booking";
import type {
  Service,
  ServiceAddOnLink,
  ServiceBookingStaff,
  ServiceConfigInput,
  ServicesWorkspaceData,
} from "@/types/service";
import type { Staff } from "@/types/staff";

export const SERVICE_SELECT =
  "id, salon_id, name, category, base_price, duration_minutes, description, is_active, online_booking_enabled, created_at, updated_at";
const SERVICE_ADD_ON_LINK_SELECT =
  "id, parent_service_id, add_on_service_id, is_active, display_order";

export const SERVICE_PERMISSIONS = {
  view: "services.view",
  manage: "services.manage",
} as const;

function requireCurrentAccountAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open services from a Business workspace.");
  }

  if (!context.currentAccount) {
    throw new Error("Choose a salon workspace before managing services.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    Account: context.currentAccount,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonServicesWorkspace(
  context?: CurrentBusinessContext,
): Promise<ServicesWorkspaceData> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("Sign in before viewing services.");
  }

  await requirePermission(SERVICE_PERMISSIONS.view, resolvedContext);

  const { Account, salon } =
    requireCurrentAccountAndSalon(resolvedContext);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [servicesResult, linksResult, assignmentsResult, staffResult, canManage] =
    await Promise.all([
      supabase
        .from("services")
        .select(SERVICE_SELECT)
        .eq("salon_id", salon.id)
        .order("category", { ascending: true })
        .order("name", { ascending: true })
        .returns<Service[]>(),
      supabase
        .from("service_add_on_links")
        .select(SERVICE_ADD_ON_LINK_SELECT)
        .eq("salon_id", salon.id)
        .order("display_order", { ascending: true })
        .returns<ServiceAddOnLink[]>(),
      supabase
        .from("staff_service_assignments")
        .select("*")
        .eq("salon_id", salon.id)
        .returns<StaffServiceAssignment[]>(),
      supabase
        .from("staff")
        .select(STAFF_SELECT)
        .eq("salon_id", salon.id)
        .order("display_name", { ascending: true })
        .returns<Staff[]>(),
      hasPermission(SERVICE_PERMISSIONS.manage, resolvedContext),
    ]);
  const firstError =
    servicesResult.error ??
    linksResult.error ??
    assignmentsResult.error ??
    staffResult.error;

  if (firstError) {
    console.error("Supabase load services workspace failed", {
      code: firstError.code,
      details: firstError.details,
      hint: firstError.hint,
      message: firstError.message,
      accountId: Account.id,
      salonId: salon.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(firstError.message);
  }

  const rawServices = servicesResult.data ?? [];
  const addOnLinks = linksResult.data ?? [];
  const assignments = assignmentsResult.data ?? [];
  const rawStaff = staffResult.data ?? [];
  const staff = rawStaff.map(
    (member): ServiceBookingStaff => ({
      avatarPath: member.public_profile_photo_path,
      displayName: member.display_name,
      id: member.id,
      isActive: member.is_active,
      onlineBookingEnabled: member.online_booking_enabled,
      ownerPublicEnabled: member.owner_public_enabled,
      publicProfileVisible: member.public_profile_visible,
      publicReady:
        member.is_active &&
        member.online_booking_enabled &&
        member.owner_public_enabled &&
        member.public_profile_visible &&
        member.staff_public_consent_status === "granted",
    }),
  );
  const services = rawServices.map((service) => ({
    ...service,
    addOnServiceIds: addOnLinks
      .filter(
        (link) => link.parent_service_id === service.id && link.is_active,
      )
      .sort((left, right) => left.display_order - right.display_order)
      .map((link) => link.add_on_service_id),
    bookingStaffIds: assignments
      .filter(
        (assignment) =>
          assignment.service_id === service.id &&
          assignment.is_active &&
          assignment.online_bookable,
      )
      .map((assignment) => assignment.staff_id),
    readiness: getServiceBookingReadiness({
      assignments,
      service,
      staff: rawStaff,
    }),
  }));

  return {
    addOnLinks,
    canManage,
    services,
    staff,
  };
}

export async function saveServiceConfigurations(inputs: ServiceConfigInput[]) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to manage services.");
  }

  await requirePermission(SERVICE_PERMISSIONS.manage, context);

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  if (inputs.length === 0 || inputs.length > 100) {
    throw new Error("Save between 1 and 100 service configurations at once.");
  }

  const serviceIds = inputs
    .map((input) => input.serviceId?.trim())
    .filter((id): id is string => Boolean(id));

  if (new Set(serviceIds).size !== serviceIds.length) {
    throw new Error("Each service can appear only once in a save batch.");
  }

  const { data, error } = await supabase.rpc("save_service_config_batch", {
    p_configs: inputs.map((input) => ({
      add_on_service_ids: input.addOnServiceIds,
      base_price: input.basePrice,
      booking_staff_ids: input.bookingStaffIds,
      category: input.category?.trim() || null,
      description: input.description?.trim() || null,
      duration_minutes: input.durationMinutes,
      is_active: input.isActive,
      name: input.name.trim(),
      online_booking_enabled:
        input.isActive && input.onlineBookingEnabled,
      ...(input.serviceId ? { service_id: input.serviceId } : {}),
    })),
    p_salon_id: salon.id,
  });

  if (error) {
    console.error("Supabase atomic service configuration save failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      accountId: Account.id,
      salonId: salon.id,
      serviceIds,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  const result =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const savedServiceIds = Array.isArray(result.service_ids)
    ? result.service_ids.filter(
        (serviceId): serviceId is string => typeof serviceId === "string",
      )
    : [];

  if (result.ok !== true || savedServiceIds.length !== inputs.length) {
    throw new Error("The service configuration transaction did not complete.");
  }

  return {
    salonId: salon.id,
    serviceIds: savedServiceIds,
  };
}
