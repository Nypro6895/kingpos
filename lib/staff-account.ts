import "server-only";

import type { CurrentBusinessContext } from "@/lib/current-context";
import type { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { Staff } from "@/types/staff";

export const STAFF_ACCOUNT_SELECT =
  "id, salon_id, account_user_id, user_id, display_name, first_name, last_name, phone, email, address_line1, address_line2, city, state, postal_code, job_title, pos_enabled, public_profile_photo_path, public_bio, public_profile_visible, owner_public_enabled, staff_public_consent_status, online_booking_enabled, profile_display_order, salon_profile_content_posting_enabled, specialties, is_active, created_at, updated_at";

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
  salonId: string;
  supabase: SupabaseServerClient;
  value: string;
}): Promise<Staff[]> {
  const { data, error } = await input.supabase
    .from("staff")
    .select(STAFF_ACCOUNT_SELECT)
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
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function resolveStaffAccountForSalon(input: ResolveStaffAccountForSalonInput): Promise<StaffAccountResolution> {
  const { context, supabase } = input;
  const user = context.user;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // OR uses raw PostgREST syntax. Keep older/non-UUID identity paths on the
  // original escaped eq filters rather than interpolating an unsafe value.
  if (!user || !context.currentSalon || !uuid.test(user.id) || !user.auth_user_id || !uuid.test(user.auth_user_id)) {
    return resolveStaffAccountSequential(input);
  }
  const { data, error } = await supabase.from("staff").select(STAFF_ACCOUNT_SELECT)
    .eq("salon_id", context.currentSalon.id).eq("is_active", true)
    .or(`account_user_id.eq.${user.id},user_id.eq.${user.auth_user_id}`)
    .order("account_user_id", { ascending: false, nullsFirst: false })
    .limit(2).returns<Staff[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  // Non-null account links sort before nullable legacy links. Thus two nullable
  // rows cannot hide a primary match. A cross-linked legacy row could sort
  // before the primary group, so retain the exact original two-query resolution
  // for that ambiguous case instead of accepting a truncated candidate set.
  if (rows.some(row => row.account_user_id !== null && row.account_user_id !== user.id)) {
    return resolveStaffAccountSequential(input);
  }
  const accountMatches = rows.filter(row => row.account_user_id === user.id);
  const matches = accountMatches.length ? accountMatches : rows;
  const source = accountMatches.length ? "account_user_id" : "legacy_user_id";
  if (matches.length > 1) return { matches, source, staff: null, status: "multiple" };
  if (matches.length === 1) return { source, staff: matches[0], status: "found" };
  return { source: null, staff: null, status: "not_found" };
}

async function resolveStaffAccountSequential({
  context,
  supabase,
}: ResolveStaffAccountForSalonInput): Promise<StaffAccountResolution> {
  if (!context.user || !context.currentSalon) {
    return { source: null, staff: null, status: "not_found" };
  }

  const salonId = context.currentSalon.id;

  const accountMatches = await resolveByField({
    field: "account_user_id",
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
