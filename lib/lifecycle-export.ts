import "server-only";

import { analyzeAccountDeletionImpact } from "@/lib/account-deletion";
import {
  listAccountDeletionRetentionPolicy,
  type RetentionCategory,
} from "@/lib/account-retention-policy";
import {
  createStoredLifecycleExport,
  type StoredLifecycleExport,
} from "@/lib/lifecycle-export-storage";
import {
  assertSalonOperationAllowed,
  getSalonLifecycle,
} from "@/lib/salon-lifecycle";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";

type SupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type ExportDomainId =
  | "bookings"
  | "customers"
  | "daily_log"
  | "lifecycle"
  | "payroll"
  | "pos"
  | "reviews"
  | "salon"
  | "services"
  | "settings"
  | "staff";

type ExportDomainResult = {
  category: RetentionCategory;
  id: ExportDomainId;
  included: boolean;
  label: string;
  reason?: string;
  recordCount: number;
};

type SalonExportArchive = {
  domains: Partial<Record<ExportDomainId, unknown>>;
  manifest: {
    createdAt: string;
    domains: ExportDomainResult[];
    exportType: "salon_lifecycle";
    schemaVersion: 1;
    salonId: string;
  };
};

const JSON_SUFFIX = ".json";

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function exportFilename(prefix: string) {
  return `${prefix}-${timestampSlug()}${JSON_SUFFIX}`;
}

async function requireExportAuth() {
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!supabase || !user) {
    throw new Error("Sign in before exporting lifecycle data.");
  }

  return { supabase, user };
}

async function rpcBoolean(
  supabase: SupabaseClient,
  rpcName: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(rpcName, args);

  if (error) {
    console.error("Supabase lifecycle export authorization RPC failed", {
      args,
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      rpcName,
    });
    throw new Error(error.message);
  }

  return data === true;
}

async function isSalonOwner(input: {
  salonId: string;
  supabase: SupabaseClient;
  userId: string;
}) {
  return rpcBoolean(input.supabase, "lifecycle_user_is_salon_owner", {
    p_count_pending_deletion: true,
    p_salon_id: input.salonId,
    p_user_id: input.userId,
  });
}

async function hasSalonPermission(input: {
  permissionCodes: string[];
  salonId: string;
  supabase: SupabaseClient;
}) {
  return rpcBoolean(input.supabase, "user_has_salon_permission", {
    permission_codes: input.permissionCodes,
    target_salon_id: input.salonId,
  });
}

async function querySalonRows<T extends Record<string, unknown>>(input: {
  column?: string;
  orderBy?: string;
  salonId: string;
  select: string;
  supabase: SupabaseClient;
  table: string;
}) {
  let query = input.supabase
    .from(input.table)
    .select(input.select)
    .eq(input.column ?? "salon_id", input.salonId);

  if (input.orderBy) {
    query = query.order(input.orderBy, { ascending: true });
  }

  const { data, error } = await query.returns<T[]>();

  if (error) {
    console.error("Supabase lifecycle export domain query failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: input.salonId,
      table: input.table,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

function includedDomain(input: {
  category: RetentionCategory;
  id: ExportDomainId;
  label: string;
  records: unknown;
}): ExportDomainResult {
  return {
    category: input.category,
    id: input.id,
    included: true,
    label: input.label,
    recordCount: countExportRecords(input.records),
  };
}

function countExportRecords(records: unknown): number {
  if (Array.isArray(records)) {
    return records.length;
  }

  if (records && typeof records === "object") {
    return Object.values(records).reduce((total, value) => {
      if (Array.isArray(value)) {
        return total + value.length;
      }

      return total + (value ? 1 : 0);
    }, 0);
  }

  return records ? 1 : 0;
}

function omittedDomain(input: {
  category: RetentionCategory;
  id: ExportDomainId;
  label: string;
  reason: string;
}): ExportDomainResult {
  return {
    category: input.category,
    id: input.id,
    included: false,
    label: input.label,
    reason: input.reason,
    recordCount: 0,
  };
}

async function includeIfAllowed(input: {
  allow: boolean;
  category: RetentionCategory;
  domains: Partial<Record<ExportDomainId, unknown>>;
  id: ExportDomainId;
  label: string;
  load: () => Promise<unknown>;
  omittedReason: string;
  results: ExportDomainResult[];
}) {
  if (!input.allow) {
    input.results.push(
      omittedDomain({
        category: input.category,
        id: input.id,
        label: input.label,
        reason: input.omittedReason,
      }),
    );
    return;
  }

  const records = await input.load();
  input.domains[input.id] = records;
  input.results.push(
    includedDomain({
      category: input.category,
      id: input.id,
      label: input.label,
      records,
    }),
  );
}

async function buildSalonExportArchive(input: {
  salonId: string;
  supabase: SupabaseClient;
  userId: string;
}): Promise<SalonExportArchive> {
  const generatedAt = new Date().toISOString();
  const owner = await isSalonOwner({
    salonId: input.salonId,
    supabase: input.supabase,
    userId: input.userId,
  });
  const [
    canViewBookings,
    canViewCustomers,
    canViewPayroll,
    canViewPos,
    canViewProfile,
    canViewServices,
    canViewSettings,
    canViewStaff,
  ] = await Promise.all([
    hasSalonPermission({
      permissionCodes: ["booking.view", "booking.manage"],
      salonId: input.salonId,
      supabase: input.supabase,
    }),
    hasSalonPermission({
      permissionCodes: ["customers.view", "customers.manage"],
      salonId: input.salonId,
      supabase: input.supabase,
    }),
    hasSalonPermission({
      permissionCodes: ["payroll.view", "payroll.manage", "payroll.tax_company"],
      salonId: input.salonId,
      supabase: input.supabase,
    }),
    hasSalonPermission({
      permissionCodes: ["tickets.view", "tickets.manage"],
      salonId: input.salonId,
      supabase: input.supabase,
    }),
    hasSalonPermission({
      permissionCodes: ["salon_profile.view", "salon_profile.manage"],
      salonId: input.salonId,
      supabase: input.supabase,
    }),
    hasSalonPermission({
      permissionCodes: ["services.view", "services.manage"],
      salonId: input.salonId,
      supabase: input.supabase,
    }),
    hasSalonPermission({
      permissionCodes: ["salon_settings.view", "salon_settings.manage"],
      salonId: input.salonId,
      supabase: input.supabase,
    }),
    hasSalonPermission({
      permissionCodes: ["staff.view", "staff.manage"],
      salonId: input.salonId,
      supabase: input.supabase,
    }),
  ]);

  if (!owner && !canViewSettings) {
    throw new Error("Owner or salon settings permission is required to export this salon.");
  }

  const domains: Partial<Record<ExportDomainId, unknown>> = {};
  const results: ExportDomainResult[] = [];
  const salonRows = await querySalonRows({
    column: "id",
    salonId: input.salonId,
    select:
      "id, account_id, name, phone, address_line1, address_line2, city, state, postal_code, country, status, disabled_at, disabled_reason, reactivated_at, reactivation_reason, closed_at, closure_reason, created_at, updated_at",
    supabase: input.supabase,
    table: "locations",
  });

  domains.salon = salonRows[0] ?? null;
  results.push(
    includedDomain({
      category: "BUSINESS_OPERATIONAL_HISTORY",
      id: "salon",
      label: "Salon identity and lifecycle state",
      records: salonRows,
    }),
  );

  await includeIfAllowed({
    allow: owner || canViewSettings,
    category: "BUSINESS_OPERATIONAL_HISTORY",
    domains,
    id: "settings",
    label: "Salon and booking settings",
    load: async () => ({
      booking: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, booking_enabled, online_booking_visible, confirmation_mode, minimum_lead_time_minutes, maximum_advance_window_days, slot_interval_minutes, same_day_booking_enabled, cancellation_window_minutes, late_cancellation_policy, no_show_policy, any_professional_enabled, split_staff_appointment_enabled, guest_booking_enabled, timezone_iana, ticket_creation_mode, payment_required_enabled, deposit_required_enabled, deposit_policy, created_at, updated_at",
        supabase: input.supabase,
        table: "booking_settings",
      }),
      salon: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, business_name, phone, email, website, address_line1, address_line2, city, state, postal_code, country, business_description, allow_staff_applications, public_discovery_enabled, public_discovery_published_at, public_profile_tagline, public_profile_story, public_profile_logo_path, public_profile_cover_path, created_at, updated_at",
        supabase: input.supabase,
        table: "salon_settings",
      }),
    }),
    omittedReason: "Salon settings permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewServices,
    category: "BUSINESS_OPERATIONAL_HISTORY",
    domains,
    id: "services",
    label: "Services and add-ons",
    load: async () => ({
      addOns: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, parent_service_id, add_on_service_id, salon_id, display_order, is_active, created_at, updated_at",
        supabase: input.supabase,
        table: "service_add_on_links",
      }),
      services: await querySalonRows({
        orderBy: "name",
        salonId: input.salonId,
        select:
          "id, salon_id, name, category, base_price, duration_minutes, description, is_active, online_booking_enabled, created_at, updated_at",
        supabase: input.supabase,
        table: "services",
      }),
    }),
    omittedReason: "Service permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewStaff,
    category: "BUSINESS_OPERATIONAL_HISTORY",
    domains,
    id: "staff",
    label: "Staff roster and scheduling",
    load: async () => ({
      assignments: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, staff_id, service_id, is_active, online_bookable, custom_duration_minutes, custom_price, effective_start_date, effective_end_date, created_at, updated_at",
        supabase: input.supabase,
        table: "staff_service_assignments",
      }),
      availability: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, staff_id, rule_type, day_of_week, starts_at_local, ends_at_local, timezone_iana, effective_start_date, effective_end_date, is_active, created_at, updated_at",
        supabase: input.supabase,
        table: "staff_availability_rules",
      }),
      roster: await querySalonRows({
        orderBy: "display_name",
        salonId: input.salonId,
        select:
          "id, salon_id, display_name, first_name, last_name, phone, email, job_title, public_profile_visible, online_booking_enabled, profile_display_order, specialties, is_active, created_at, updated_at",
        supabase: input.supabase,
        table: "staff",
      }),
      timeBlocks: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, staff_id, block_type, starts_at, ends_at, timezone_iana, reason, is_active, cancelled_at, created_at, updated_at",
        supabase: input.supabase,
        table: "staff_time_blocks",
      }),
    }),
    omittedReason: "Staff permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewBookings,
    category: "BUSINESS_OPERATIONAL_HISTORY",
    domains,
    id: "bookings",
    label: "Booking history",
    load: async () => ({
      bookingLines: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, booking_id, parent_booking_line_id, line_type, service_id, service_name_snapshot, service_category_snapshot, unit_price, quantity, line_total, duration_minutes, assigned_staff_id, scheduled_start_at, scheduled_end_at, line_status, started_at, completed_at, performed_by_staff_id, service_note, created_at, updated_at",
        supabase: input.supabase,
        table: "booking_lines",
      }),
      bookings: await querySalonRows({
        orderBy: "start_at",
        salonId: input.salonId,
        select:
          "id, salon_id, customer_id, customer_user_id, staff_id, start_at, end_at, notes, public_notes, internal_notes, status, source, confirmation_mode, confirmation_status, salon_timezone_snapshot, pos_ticket_id, source_reference_type, source_reference_id, cancellation_reason, cancelled_at, no_show_at, no_show_reason, payment_status, deposit_policy_snapshot, cancellation_policy_snapshot, created_at, updated_at",
        supabase: input.supabase,
        table: "bookings",
      }),
      statusEvents: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, booking_id, event_type, old_status, new_status, actor_user_id, actor_staff_id, actor_source, metadata, created_at",
        supabase: input.supabase,
        table: "booking_status_events",
      }),
    }),
    omittedReason: "Booking permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewCustomers,
    category: "CUSTOMER_TRANSACTION_HISTORY",
    domains,
    id: "customers",
    label: "Customer records",
    load: () =>
      querySalonRows({
        column: "location_id",
        orderBy: "name",
        salonId: input.salonId,
        select:
          "id, location_id, customer_user_id, name, phone, email, notes, staff_notes, internal_notes, source, status, created_at, updated_at",
        supabase: input.supabase,
        table: "customers",
      }),
    omittedReason: "Customer permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewPos,
    category: "BUSINESS_OPERATIONAL_HISTORY",
    domains,
    id: "pos",
    label: "POS history",
    load: async () => ({
      auditLogs: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, ticket_id, action, note, before_snapshot, after_snapshot, created_by, created_at",
        supabase: input.supabase,
        table: "pos_ticket_audit_logs",
      }),
      items: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, pos_ticket_id, service_id, assigned_staff_id, performed_by_staff_id, source_booking_id, source_booking_line_id, source_kind, service_name_snapshot, service_category_snapshot, booked_unit_price_snapshot, quantity, unit_price, line_total, notes, is_removed, removed_at, removal_reason, created_at, updated_at",
        supabase: input.supabase,
        table: "pos_ticket_items",
      }),
      payments: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, ticket_id, payment_method, amount, note, created_by, created_at",
        supabase: input.supabase,
        table: "pos_payments",
      }),
      tickets: await querySalonRows({
        orderBy: "opened_at",
        salonId: input.salonId,
        select:
          "id, salon_id, source_booking_id, ticket_number, ticket_sequence, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, notes, created_at, updated_at",
        supabase: input.supabase,
        table: "pos_tickets",
      }),
      turns: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, ticket_id, ticket_item_id, staff_id, amount, turn_type, turn_index, work_date, created_at",
        supabase: input.supabase,
        table: "pos_ticket_item_turn_parts",
      }),
    }),
    omittedReason: "POS permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewPos,
    category: "BUSINESS_OPERATIONAL_HISTORY",
    domains,
    id: "daily_log",
    label: "Daily closing and corrections",
    load: async () => ({
      adjustments: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, correction_request_id, target_type, target_id, ticket_id, staff_id, business_date, service_delta, tip_delta, turn_delta, expected_total_delta, actual_total_delta, cash_delta, credit_card_delta, other_delta, discount_delta, gift_card_delta, note, created_by, created_at",
        supabase: input.supabase,
        table: "pos_financial_adjustments",
      }),
      closingStaffSnapshots: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, closing_id, report_date, staff_id, staff_name_snapshot, total_earned_snapshot, tip_snapshot, big_turn_count_snapshot, small_turn_count_snapshot, total_turns_snapshot, created_at",
        supabase: input.supabase,
        table: "pos_daily_closing_staff_snapshots",
      }),
      closings: await querySalonRows({
        orderBy: "report_date",
        salonId: input.salonId,
        select:
          "id, salon_id, report_date, status, cash_amount, credit_card_amount, other_amount, note, closed_at, approved_at, locked_at, lock_type, lock_reason, actual_total_snapshot, cash_amount_snapshot, credit_card_amount_snapshot, difference_snapshot, discount_snapshot, expected_total_snapshot, finalized_ticket_count_snapshot, gift_card_snapshot, note_snapshot, other_amount_snapshot, snapshot_created_at, staff_earned_snapshot, ticket_count_snapshot, tip_snapshot, created_at, updated_at",
        supabase: input.supabase,
        table: "pos_daily_closings",
      }),
      correctionRequests: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, target_type, target_id, ticket_id, business_date, correction_type, reason, requested_by, approved_by, rejected_by, status, money_delta, old_value_json, requested_value_json, admin_note, requested_at, approved_at, rejected_at, applied_at, created_at, updated_at",
        supabase: input.supabase,
        table: "pos_financial_correction_requests",
      }),
    }),
    omittedReason: "POS or daily-log permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewPayroll,
    category: "PAYROLL",
    domains,
    id: "payroll",
    label: "Payroll and tax records",
    load: async () => ({
      dailyTotals: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, payroll_run_id, salon_id, staff_id, business_date, gross_sales, tip_amount, correction_delta, pay_type_used, commission_rate_used, fixed_pay_amount_used, check_rate_used, tax_rate_used, settings_used_snapshot, note, created_at, updated_at",
        supabase: input.supabase,
        table: "payroll_staff_daily_totals",
      }),
      paystubs: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, payroll_run_id, salon_id, staff_id, uploaded_by, file_name, mime_type, size_bytes, note, created_at, updated_at",
        supabase: input.supabase,
        table: "payroll_paystubs",
      }),
      runs: await querySalonRows({
        orderBy: "period_start",
        salonId: input.salonId,
        select:
          "id, salon_id, period_start, period_end, cycle_type, status, version, settings_snapshot, correction_snapshot, generated_at, printed_at, locked_at, paid_at, created_at, updated_at",
        supabase: input.supabase,
        table: "payroll_runs",
      }),
      settings: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, staff_id, legal_name, pay_type, commission_rate, fixed_pay_amount, check_rate, tax_rate, apply_tax_to_fixed_pay, tax_tips, tax_bonus, tax_company_enabled, cash_to_tax_company, tip_payout_method, bonus_payout_method, effective_from, effective_to, created_at, updated_at",
        supabase: input.supabase,
        table: "staff_payroll_settings",
      }),
      staffLines: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, payroll_run_id, salon_id, staff_id, staff_display_name_snapshot, staff_legal_name_snapshot, gross_sales, pay_type_used, commission_rate_used, fixed_pay_amount_used, staff_commission_gross, shop_share, check_rate_used, base_check_amount, base_cash_amount, cash_amount, check_gross, tax_rate_used, tax_withheld, check_net, check_number, tip_amount, tip_check_amount, tip_cash_amount, tip_payout_method_snapshot, tip_allocation_method, bonus_amount, bonus_check_amount, bonus_cash_amount, bonus_payout_method_snapshot, earned_amount, final_check_amount, final_cash_amount, final_staff_income, tax_bonus_snapshot, tax_tips_snapshot, tax_company_reported_wage_gross, tax_company_taxable_gross, tax_company_enabled_snapshot, cash_to_tax_company_snapshot, tax_company_check_amount, tax_company_cash_amount, is_mixed_rate, settings_used_snapshot, period_staff_input_snapshot, note, created_at, updated_at",
        supabase: input.supabase,
        table: "payroll_staff_lines",
      }),
    }),
    omittedReason: "Payroll permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewProfile,
    category: "REVIEWS_CONTENT",
    domains,
    id: "reviews",
    label: "Reviews and public profile content",
    load: async () => ({
      comments: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, look_id, update_id, parent_comment_id, author_user_id, author_display_name, body, is_salon_reply, status, created_at, updated_at",
        supabase: input.supabase,
        table: "salon_profile_comments",
      }),
      looks: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, author_user_id, author_display_name, author_staff_id, service_id, recommended_staff_id, title, caption, emotional_description, why_love_it, mood, duration_minutes, starting_price, palette, badge, media_path, booking_note, is_pinned, status, published_at, created_at, updated_at",
        supabase: input.supabase,
        table: "salon_profile_looks",
      }),
      replies: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, review_id, author_user_id, body, moderation_status, created_at, updated_at",
        supabase: input.supabase,
        table: "salon_profile_review_replies",
      }),
      reviews: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, author_user_id, rating, title, body, verification_status, verified_booking_id, moderation_status, moderation_reason, edited_at, created_at, updated_at",
        supabase: input.supabase,
        table: "salon_profile_reviews",
      }),
      updates: await querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, author_user_id, author_display_name, author_staff_id, service_id, staff_id, update_type, title, caption, summary, media_path, starts_at, ends_at, cta_label, status, published_at, created_at, updated_at",
        supabase: input.supabase,
        table: "salon_profile_updates",
      }),
    }),
    omittedReason: "Salon profile permission is required.",
    results,
  });

  await includeIfAllowed({
    allow: owner || canViewSettings,
    category: "AUDIT",
    domains,
    id: "lifecycle",
    label: "Lifecycle audit",
    load: () =>
      querySalonRows({
        salonId: input.salonId,
        select:
          "id, salon_id, actor_user_id, event_type, old_status, new_status, reason, metadata, created_at",
        supabase: input.supabase,
        table: "salon_lifecycle_events",
      }),
    omittedReason: "Salon settings permission is required.",
    results,
  });

  return {
    domains,
    manifest: {
      createdAt: generatedAt,
      domains: results,
      exportType: "salon_lifecycle",
      salonId: input.salonId,
      schemaVersion: 1,
    },
  };
}

export async function createSalonLifecycleExport(input: {
  salonId: string;
}): Promise<StoredLifecycleExport> {
  const { supabase, user } = await requireExportAuth();
  await assertSalonOperationAllowed({
    operation: "EXPORT_DATA",
    salonId: input.salonId,
  });
  const lifecycle = await getSalonLifecycle(input.salonId);

  if (!lifecycle) {
    throw new Error("Salon was not found.");
  }

  const archive = await buildSalonExportArchive({
    salonId: input.salonId,
    supabase,
    userId: user.id,
  });
  const payload = {
    archive,
    retentionPolicy: listAccountDeletionRetentionPolicy(),
  };

  return createStoredLifecycleExport({
    accountId: lifecycle.account_id,
    exportType: "salon_lifecycle",
    filename: exportFilename(`salon-${lifecycle.id}-export`),
    manifest: archive.manifest,
    payload,
    salonId: lifecycle.id,
  });
}

export async function createAccountDeletionExport(): Promise<StoredLifecycleExport> {
  const { supabase, user } = await requireExportAuth();
  const impact = await analyzeAccountDeletionImpact();
  const salonArchives = [];

  for (const salon of impact.ownedSalons) {
    try {
      salonArchives.push(
        await buildSalonExportArchive({
          salonId: salon.id,
          supabase,
          userId: user.id,
        }),
      );
    } catch (error) {
      salonArchives.push({
        error:
          error instanceof Error
            ? error.message
            : "Salon export could not be included.",
        manifest: {
          createdAt: new Date().toISOString(),
          domains: [],
          exportType: "salon_lifecycle" as const,
          salonId: salon.id,
          schemaVersion: 1 as const,
        },
      });
    }
  }

  const { data: accountEvents, error: accountEventsError } = await supabase
    .from("account_lifecycle_events")
    .select("id, user_id, actor_user_id, event_type, metadata, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .returns<Record<string, unknown>[]>();

  if (accountEventsError) {
    console.error("Supabase account lifecycle export events failed", {
      code: accountEventsError.code,
      details: accountEventsError.details,
      hint: accountEventsError.hint,
      message: accountEventsError.message,
      userId: user.id,
    });
    throw new Error(accountEventsError.message);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    domains: [
      {
        category: "PERSONAL_PROFILE",
        id: "account",
        included: true,
        label: "Personal account deletion state",
        recordCount: 1,
      },
      {
        category: "AUDIT",
        id: "account_lifecycle",
        included: true,
        label: "Account lifecycle audit",
        recordCount: accountEvents?.length ?? 0,
      },
      {
        category: "BUSINESS_OPERATIONAL_HISTORY",
        id: "owned_salons",
        included: true,
        label: "Owned salon exports",
        recordCount: salonArchives.length,
      },
    ],
    exportType: "account_deletion",
    schemaVersion: 1,
    subjectUserId: user.id,
  };
  const payload = {
    accountLifecycleEvents: accountEvents ?? [],
    generatedAt: manifest.createdAt,
    impact,
    retentionPolicy: listAccountDeletionRetentionPolicy(),
    salonArchives,
    user: {
      deletionRequestedAt: user.deletion_requested_at ?? null,
      deletionScheduledFor: user.deletion_scheduled_for ?? null,
      displayName: user.display_name,
      email: user.email,
      id: user.id,
      status: user.status,
    },
  };

  return createStoredLifecycleExport({
    exportType: "account_deletion",
    filename: exportFilename(`account-${user.id}-deletion-export`),
    manifest,
    payload,
    subjectUserId: user.id,
  });
}
