import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202608210001_account_salon_lifecycle_foundation.sql",
  "utf8",
);
const lifecycleRules = readFileSync("lib/salon-lifecycle-rules.ts", "utf8");
const lifecycleService = readFileSync("lib/salon-lifecycle.ts", "utf8");
const permissions = readFileSync("lib/permissions.ts", "utf8");
const currentContext = readFileSync("lib/current-context.ts", "utf8");
const userTypes = readFileSync("types/user.ts", "utf8");
const locationTypes = readFileSync("types/location.ts", "utf8");

test("migration extends existing users and locations lifecycle fields", () => {
  assert.match(migration, /alter table public\.users[\s\S]*deletion_requested_at/);
  assert.match(migration, /deletion_scheduled_for timestamptz/);
  assert.match(migration, /deleted_at timestamptz/);
  assert.match(migration, /add column if not exists disabled_at timestamptz/);
  assert.match(migration, /add column if not exists closed_at timestamptz/);
  assert.match(migration, /closure_reason text/);
  assert.match(migration, /locations_lifecycle_status_check/);
  assert.match(migration, /'active', 'inactive', 'disabled', 'permanently_closed'/);
});

test("migration defines transition audit and owner-only lifecycle RPCs", () => {
  for (const functionName of [
    "normalize_salon_lifecycle_status",
    "salon_has_active_owner",
    "disable_salon",
    "reactivate_salon",
    "close_salon_permanently",
  ]) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${functionName}`),
    );
  }

  assert.match(migration, /create table if not exists public\.salon_lifecycle_events/);
  assert.match(migration, /record_salon_lifecycle_status_change/);
  assert.match(migration, /Only Account owners can change salon lifecycle/);
  assert.match(migration, /permanently closed salon requires a privileged recovery workflow/i);
});

test("database guard blocks operational writes without changing read policies", () => {
  assert.match(migration, /prevent_non_operational_salon_write/);
  assert.match(migration, /Salon is not active\. New operational activity is not allowed/);

  for (const guardedTable of [
    "bookings",
    "customers",
    "payroll_runs",
    "pos_tickets",
    "services",
    "staff",
    "staff_time_blocks",
  ]) {
    assert.match(
      migration,
      new RegExp(`\\('${guardedTable}', 'salon_id'\\)|\\('${guardedTable}', 'location_id'\\)`),
      `${guardedTable} should be guarded by salon lifecycle`,
    );
  }

  assert.doesNotMatch(
    migration,
    /drop policy if exists "salon_member_read_bookings"/,
    "Phase 1 should preserve historical read policies.",
  );
});

test("app rule and service layers centralize lifecycle checks", () => {
  assert.match(lifecycleRules, /export function canPerformSalonOperation/);
  assert.match(lifecycleRules, /inactive/);
  assert.match(lifecycleRules, /PERMISSION_OPERATION_MAP/);
  assert.match(lifecycleService, /export async function assertSalonOperationAllowed/);
  assert.match(lifecycleService, /export async function getSalonLifecycle/);
  assert.match(lifecycleService, /export function getAccountDeletionState/);
  assert.match(permissions, /getSalonOperationForPermissionCode/);
  assert.match(permissions, /getSalonLifecyclePermissionDenial/);
});

test("current context exposes active and historical salon buckets", () => {
  assert.match(currentContext, /activeManageSalons: Location\[\]/);
  assert.match(currentContext, /historicalManageSalons: Location\[\]/);
  assert.match(currentContext, /inactiveManageSalons: Location\[\]/);
  assert.match(currentContext, /isActiveSalonLifecycle/);
  assert.match(currentContext, /isHistoricalSalonLifecycle/);
});

test("public types include account and salon lifecycle states", () => {
  assert.match(userTypes, /"pending_deletion"/);
  assert.match(userTypes, /deletion_requested_at\?: string \| null/);
  assert.match(locationTypes, /"disabled"/);
  assert.match(locationTypes, /"permanently_closed"/);
  assert.match(locationTypes, /closed_at\?: string \| null/);
});
