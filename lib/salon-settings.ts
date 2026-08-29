import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { syncCurrentSalonMapLocationAddressState } from "@/lib/location/salon-map-location";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  SalonSetting,
  UpdateSalonSettingInput,
} from "@/types/salon-setting";

export const SALON_SETTING_SELECT =
  "id, salon_id, business_name, phone, email, website, address_line1, address_line2, city, state, postal_code, country, business_description, allow_staff_applications, public_discovery_enabled, public_discovery_published_at, created_at, updated_at";

export const SALON_SETTING_PERMISSIONS = {
  view: "salon_settings.view",
  manage: "salon_settings.manage",
} as const;

type DiscoverySettingSnapshot = {
  address_line1?: string | null;
  business_description?: string | null;
  business_name?: string | null;
  city?: string | null;
  phone?: string | null;
  postal_code?: string | null;
  state?: string | null;
};

export type SalonDiscoveryReadinessItem = {
  complete: boolean;
  href: string;
  id: string;
  label: string;
};

export type SalonDiscoveryReadiness = {
  activeServiceCount: number;
  canEnable: boolean;
  items: SalonDiscoveryReadinessItem[];
  missingLabels: string[];
};

function requireCurrentAccountAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open Business settings from a Business workspace.");
  }

  if (!context.currentAccount) {
    throw new Error("Choose a salon workspace before managing salon settings.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    Account: context.currentAccount,
    salon: context.currentSalon,
  };
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function getSalonDiscoveryReadiness(input: {
  activeServiceCount: number;
  salonStatus?: string | null;
  setting: DiscoverySettingSnapshot;
}): SalonDiscoveryReadiness {
  const items: SalonDiscoveryReadinessItem[] = [
    {
      complete: input.salonStatus === "active",
      href: "/salons",
      id: "salon-status",
      label: "Active salon location",
    },
    {
      complete: hasText(input.setting.business_name),
      href: "#business-information",
      id: "business-name",
      label: "Public business name",
    },
    {
      complete: hasText(input.setting.phone),
      href: "#business-information",
      id: "phone",
      label: "Public phone",
    },
    {
      complete: hasText(input.setting.address_line1),
      href: "#business-information",
      id: "address",
      label: "Street address",
    },
    {
      complete: hasText(input.setting.city),
      href: "#business-information",
      id: "city",
      label: "City",
    },
    {
      complete: hasText(input.setting.state),
      href: "#business-information",
      id: "state",
      label: "State",
    },
    {
      complete: hasText(input.setting.postal_code),
      href: "#business-information",
      id: "postal-code",
      label: "ZIP code",
    },
    {
      complete: hasText(input.setting.business_description),
      href: "#business-information",
      id: "description",
      label: "Public description",
    },
    {
      complete: input.activeServiceCount > 0,
      href: "/services",
      id: "active-service",
      label: "At least one active service",
    },
  ];
  const missingLabels = items
    .filter((item) => !item.complete)
    .map((item) => item.label);

  return {
    activeServiceCount: input.activeServiceCount,
    canEnable: missingLabels.length === 0,
    items,
    missingLabels,
  };
}

async function countActiveServicesForSalon(input: {
  accountId: string;
  salonId: string;
}) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { count, error } = await supabase
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("salon_id", input.salonId)
    .eq("is_active", true);

  if (error) {
    console.error("Supabase count active services failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: input.salonId,
      accountId: input.accountId,
    });
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function getCurrentSalonDiscoveryReadiness(
  setting: SalonSetting,
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const { Account, salon } = requireCurrentAccountAndSalon(resolvedContext);
  const activeServiceCount = await countActiveServicesForSalon({
    accountId: Account.id,
    salonId: salon.id,
  });

  return getSalonDiscoveryReadiness({
    activeServiceCount,
    salonStatus: salon.status,
    setting,
  });
}

export async function getCurrentSalonSetting() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, setting: null };
  }

  await requirePermission(SALON_SETTING_PERMISSIONS.view, context);

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: existingSetting, error: loadError } = await supabase
    .from("salon_settings")
    .select(SALON_SETTING_SELECT)
    .eq("salon_id", salon.id)
    .maybeSingle<SalonSetting>();

  if (loadError) {
    console.error("Supabase load salon settings failed", {
      code: loadError.code,
      message: loadError.message,
      details: loadError.details,
      hint: loadError.hint,
      salonId: salon.id,
      accountId: Account.id,
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
      salon_id: salon.id,
      business_name: salon.name,
      phone: salon.phone,
      address_line1: salon.address_line1,
      address_line2: salon.address_line2,
      city: salon.city,
      state: salon.state,
      postal_code: salon.postal_code,
      country: salon.country,
      allow_staff_applications: false,
      public_discovery_enabled: false,
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
    accountId: Account.id,
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

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const businessName = input.business_name.trim();

  if (!businessName) {
    throw new Error("Business Name is required.");
  }

  await getCurrentSalonSetting();

  const publicDiscoveryEnabled = input.public_discovery_enabled ?? false;

  if (publicDiscoveryEnabled) {
    const activeServiceCount = await countActiveServicesForSalon({
      accountId: Account.id,
      salonId: salon.id,
    });
    const readiness = getSalonDiscoveryReadiness({
      activeServiceCount,
      salonStatus: salon.status,
      setting: {
        address_line1: input.address_line1,
        business_description: input.business_description,
        business_name: businessName,
        city: input.city,
        phone: input.phone,
        postal_code: input.postal_code,
        state: input.state,
      },
    });

    if (!readiness.canEnable) {
      throw new Error(
        `Complete public discovery requirements before enabling Explore: ${readiness.missingLabels.join(", ")}.`,
      );
    }
  }

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
      allow_staff_applications: input.allow_staff_applications ?? false,
      public_discovery_enabled: publicDiscoveryEnabled,
    })
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
      accountId: Account.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  await syncCurrentSalonMapLocationAddressState({
    context,
    setting: data,
  });

  return data;
}
