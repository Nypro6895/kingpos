import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { CreateServiceInput, Service } from "@/types/service";

export const SERVICE_SELECT =
  "id, organization_id, salon_id, name, category, base_price, duration_minutes, description, is_active, created_at, updated_at";
const SERVICE_ADD_ON_LINK_SELECT =
  "id, parent_service_id, add_on_service_id, is_active, display_order";

export const SERVICE_PERMISSIONS = {
  view: "services.view",
  manage: "services.manage",
} as const;

export type ServiceWithAddOns = Service & {
  addOnServiceIds: string[];
};

type ServiceAddOnLinkRow = {
  add_on_service_id: string;
  display_order: number;
  id: string;
  is_active: boolean;
  parent_service_id: string;
};

function requireCurrentOrganizationAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open services from a Manage Salon workspace.");
  }

  if (!context.currentOrganization) {
    throw new Error("Create an organization before managing services.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    organization: context.currentOrganization,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonServices() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, services: [] };
  }

  await requirePermission(SERVICE_PERMISSIONS.view, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("services")
    .select(SERVICE_SELECT)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .order("created_at", { ascending: false })
    .returns<Service[]>();

  if (error) {
    console.error("Supabase load services failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  const { data: addOnLinks, error: addOnError } = await supabase
    .from("service_add_on_links")
    .select(SERVICE_ADD_ON_LINK_SELECT)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .order("display_order", { ascending: true })
    .returns<ServiceAddOnLinkRow[]>();

  if (addOnError) {
    console.error("Supabase load service add-ons failed", {
      code: addOnError.code,
      message: addOnError.message,
      details: addOnError.details,
      hint: addOnError.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: context.user.id,
    });
    throw new Error(addOnError.message);
  }

  const activeLinks = (addOnLinks ?? []).filter((link) => link.is_active);
  const services = (data ?? []).map((service) => ({
    ...service,
    addOnServiceIds: activeLinks
      .filter((link) => link.parent_service_id === service.id)
      .sort((left, right) => left.display_order - right.display_order)
      .map((link) => link.add_on_service_id),
  })) satisfies ServiceWithAddOns[];

  return { context, services };
}

export async function createService(input: CreateServiceInput) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to create services.");
  }

  await requirePermission(SERVICE_PERMISSIONS.manage, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const name = input.name.trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  if (input.base_price < 0) {
    throw new Error("Base Price must be greater than or equal to 0.");
  }

  if (input.duration_minutes <= 0) {
    throw new Error("Duration must be greater than 0.");
  }

  const { data, error } = await supabase
    .from("services")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      name,
      category: input.category,
      base_price: input.base_price,
      duration_minutes: input.duration_minutes,
      description: input.description,
      is_active: input.is_active ?? true,
    })
    .select(SERVICE_SELECT)
    .single<Service>();

  if (error) {
    console.error("Supabase create service failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  return data;
}

export async function saveServiceAddOns(input: {
  addOnServiceIds: string[];
  parentServiceId: string;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to manage service add-ons.");
  }

  await requirePermission(SERVICE_PERMISSIONS.manage, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const parentServiceId = input.parentServiceId.trim();
  const addOnServiceIds = [...new Set(input.addOnServiceIds)]
    .map((id) => id.trim())
    .filter((id) => id && id !== parentServiceId);
  const candidateServiceIds = [parentServiceId, ...addOnServiceIds];
  const { data: services, error: serviceError } = await supabase
    .from("services")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .in("id", candidateServiceIds)
    .returns<Array<{ id: string }>>();

  if (serviceError) {
    throw new Error(serviceError.message);
  }

  const serviceIds = new Set((services ?? []).map((service) => service.id));

  if (!serviceIds.has(parentServiceId)) {
    throw new Error("Parent service was not found.");
  }

  const validAddOnIds = addOnServiceIds.filter((id) => serviceIds.has(id));

  const { data: existing, error: existingError } = await supabase
    .from("service_add_on_links")
    .select(SERVICE_ADD_ON_LINK_SELECT)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .eq("parent_service_id", parentServiceId)
    .returns<ServiceAddOnLinkRow[]>();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingLinks = existing ?? [];
  const existingByAddOnId = new Map(
    existingLinks.map((link) => [link.add_on_service_id, link]),
  );
  const selected = new Set(validAddOnIds);
  const linksToDisable = existingLinks.filter(
    (link) => link.is_active && !selected.has(link.add_on_service_id),
  );

  if (linksToDisable.length > 0) {
    const { error } = await supabase
      .from("service_add_on_links")
      .update({ is_active: false })
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .in(
        "id",
        linksToDisable.map((link) => link.id),
      );

    if (error) {
      throw new Error(error.message);
    }
  }

  for (const [index, addOnServiceId] of validAddOnIds.entries()) {
    const existingLink = existingByAddOnId.get(addOnServiceId);

    if (existingLink) {
      const { error } = await supabase
        .from("service_add_on_links")
        .update({
          display_order: index,
          is_active: true,
        })
        .eq("id", existingLink.id)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id);

      if (error) {
        throw new Error(error.message);
      }
    } else {
      const { error } = await supabase.from("service_add_on_links").insert({
        add_on_service_id: addOnServiceId,
        display_order: index,
        is_active: true,
        organization_id: organization.id,
        parent_service_id: parentServiceId,
        salon_id: salon.id,
      });

      if (error) {
        throw new Error(error.message);
      }
    }
  }
}
