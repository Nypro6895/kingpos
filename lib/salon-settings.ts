import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  SalonSetting,
  UpdateSalonSettingInput,
} from "@/types/salon-setting";

export const SALON_SETTING_SELECT =
  "id, organization_id, salon_id, business_name, phone, email, website, address_line1, address_line2, city, state, postal_code, country, business_description, created_at, updated_at";

export const SALON_SETTING_PERMISSIONS = {
  view: "salon_settings.view",
  manage: "salon_settings.manage",
} as const;

function requireCurrentOrganizationAndSalon(context: CurrentBusinessContext) {
  if (!context.currentOrganization) {
    throw new Error("Create an organization before managing salon settings.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    organization: context.currentOrganization,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonSetting() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, setting: null };
  }

  await requirePermission(SALON_SETTING_PERMISSIONS.view, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: existingSetting, error: loadError } = await supabase
    .from("salon_settings")
    .select(SALON_SETTING_SELECT)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .maybeSingle<SalonSetting>();

  if (loadError) {
    console.error("Supabase load salon settings failed", {
      code: loadError.code,
      message: loadError.message,
      details: loadError.details,
      hint: loadError.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: context.user.id,
    });
    throw new Error(loadError.message);
  }

  if (existingSetting) {
    return { context, setting: existingSetting };
  }

  const { data: createdSetting, error: createError } = await supabase
    .from("salon_settings")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      business_name: salon.name,
      phone: salon.phone,
      address_line1: salon.address_line1,
      address_line2: salon.address_line2,
      city: salon.city,
      state: salon.state,
      postal_code: salon.postal_code,
      country: salon.country,
    })
    .select(SALON_SETTING_SELECT)
    .single<SalonSetting>();

  if (!createError) {
    return { context, setting: createdSetting };
  }

  if (createError.code === "23505") {
    const { data: racedSetting, error: reloadError } = await supabase
      .from("salon_settings")
      .select(SALON_SETTING_SELECT)
      .eq("organization_id", organization.id)
      .eq("salon_id", salon.id)
      .single<SalonSetting>();

    if (!reloadError) {
      return { context, setting: racedSetting };
    }
  }

  console.error("Supabase create default salon settings failed", {
    code: createError.code,
    message: createError.message,
    details: createError.details,
    hint: createError.hint,
    salonId: salon.id,
    organizationId: organization.id,
    userId: context.user.id,
  });
  throw new Error(createError.message);
}

export async function updateCurrentSalonSetting(input: UpdateSalonSettingInput) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to update salon settings.");
  }

  await requirePermission(SALON_SETTING_PERMISSIONS.manage, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const businessName = input.business_name.trim();

  if (!businessName) {
    throw new Error("Business Name is required.");
  }

  await getCurrentSalonSetting();

  const { data, error } = await supabase
    .from("salon_settings")
    .update({
      business_name: businessName,
      phone: input.phone,
      email: input.email,
      website: input.website,
      address_line1: input.address_line1,
      address_line2: input.address_line2,
      city: input.city,
      state: input.state,
      postal_code: input.postal_code,
      country: input.country,
      business_description: input.business_description,
    })
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .select(SALON_SETTING_SELECT)
    .single<SalonSetting>();

  if (error) {
    console.error("Supabase update salon settings failed", {
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
