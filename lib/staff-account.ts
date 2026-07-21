import "server-only";

import type { CurrentBusinessContext } from "@/lib/current-context";
import type { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { Staff } from "@/types/staff";

export const STAFF_ACCOUNT_SELECT =
  "id, organization_id, salon_id, account_user_id, user_id, display_name, first_name, last_name, phone, email, job_title, public_profile_photo_path, public_bio, public_profile_visible, owner_public_enabled, staff_public_consent_status, online_booking_enabled, profile_display_order, salon_profile_content_posting_enabled, specialties, is_active, created_at, updated_at";

export const CURRENT_STAFF_NOT_FOUND_MESSAGE =
  "No active staff profile is linked to your account for this salon.";

export const CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE =
  "Multiple active staff profiles are linked to your account for this salon.";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type ResolveSource = "account_user_id" | "legacy_user_id";

export type StaffAccountResolution =
  | {
      source: null;
      staff: null;
      status: "not_found";
    }
  | {
      source: ResolveSource;
      staff: Staff;
      status: "found";
    }
  | {
      matches: Staff[];
      source: ResolveSource;
      staff: null;
      status: "multiple";
    };

type ResolveStaffAccountForSalonInput = {
  context: CurrentBusinessContext;
  supabase: SupabaseServerClient;
};

async function resolveByField(input: {
  field: "account_user_id" | "user_id";
  organizationId: string;
  salonId: string;
  supabase: SupabaseServerClient;
  value: string;
}): Promise<Staff[]> {
  const { data, error } = await input.supabase
    .from("staff")
    .select(STAFF_ACCOUNT_SELECT)
    .eq("organization_id", input.organizationId)
    .eq("salon_id", input.salonId)
    .eq("is_active", true)
    .eq(input.field, input.value)
    .limit(2)
    .returns<Staff[]>();

  if (error) {
    console.error("Supabase resolve staff account failed", {
      code: error.code,
      details: error.details,
      field: input.field,
      hint: error.hint,
      message: error.message,
      organizationId: input.organizationId,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function resolveStaffAccountForSalon({
  context,
  supabase,
}: ResolveStaffAccountForSalonInput): Promise<StaffAccountResolution> {
  if (!context.user || !context.currentOrganization || !context.currentSalon) {
    return { source: null, staff: null, status: "not_found" };
  }

  const organizationId = context.currentOrganization.id;
  const salonId = context.currentSalon.id;

  const accountMatches = await resolveByField({
    field: "account_user_id",
    organizationId,
    salonId,
    supabase,
    value: context.user.id,
  });

  if (accountMatches.length === 1) {
    return {
      source: "account_user_id",
      staff: accountMatches[0],
      status: "found",
    };
  }

  if (accountMatches.length > 1) {
    return {
      matches: accountMatches,
      source: "account_user_id",
      staff: null,
      status: "multiple",
    };
  }

  if (!context.user.auth_user_id) {
    return { source: null, staff: null, status: "not_found" };
  }

  const legacyMatches = await resolveByField({
    field: "user_id",
    organizationId,
    salonId,
    supabase,
    value: context.user.auth_user_id,
  });

  if (legacyMatches.length === 1) {
    return {
      source: "legacy_user_id",
      staff: legacyMatches[0],
      status: "found",
    };
  }

  if (legacyMatches.length > 1) {
    return {
      matches: legacyMatches,
      source: "legacy_user_id",
      staff: null,
      status: "multiple",
    };
  }

  return { source: null, staff: null, status: "not_found" };
}
