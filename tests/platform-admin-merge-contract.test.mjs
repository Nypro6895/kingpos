import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("platform admin route files are present after the merge", () => {
  for (const path of [
    "app/(app)/admin/page.tsx",
    "app/(app)/admin/layout.tsx",
    "app/(app)/admin/users/page.tsx",
    "app/(app)/admin/businesses/page.tsx",
    "app/(app)/admin/locations/page.tsx",
    "app/(app)/admin/reports/page.tsx",
    "app/(app)/admin/recovery/page.tsx",
    "app/(app)/admin/audit/page.tsx",
    "app/(app)/admin/team/page.tsx",
  ]) {
    assert.ok(existsSync(path), `${path} should exist`);
  }
});

test("platform admin uses current auth routing and stays outside the app shell", () => {
  const adminAuth = read("lib/platform-admin/auth.ts");
  const navigationShell = read("app/navigation-shell.tsx");
  const accountPage = read("app/(app)/account/page.tsx");

  assert.match(adminAuth, /loginHrefForReturnPath/);
  assert.doesNotMatch(adminAuth, /auth-redirects|buildLoginPath/);
  assert.match(navigationShell, /pathname === "\/admin"/);
  assert.match(navigationShell, /pathname\.startsWith\("\/admin\/"\)/);
  assert.match(accountPage, /getCurrentPlatformAdminContext/);
  assert.match(accountPage, /href="\/admin"/);
  assert.match(read("app/(app)/admin/_components/admin-ui.tsx"), /href: "\/admin\/recovery"/);
});

test("platform admin business UI does not expose legacy legal-name editing", () => {
  const businessListPage = read("app/(app)/admin/businesses/page.tsx");
  const businessDetailPage = read("app/(app)/admin/businesses/[businessId]/page.tsx");
  const actions = read("app/(app)/admin/actions.ts");

  assert.doesNotMatch(businessListPage, /legal_name \?\?/);
  assert.doesNotMatch(businessDetailPage, /label="Legal name"|name="legal_name"/);
  assert.match(actions, /legalName: null/);
});

test("platform admin migration targets the current account schema", () => {
  const migration = read(
    "supabase/migrations/202608300004_platform_admin_current_schema.sql",
  );
  const repairMigration = read(
    "supabase/migrations/202608300005_platform_admin_current_schema_lint_repair.sql",
  );
  const legacyParamRepairMigration = read(
    "supabase/migrations/202608300006_platform_admin_business_profile_legacy_param_repair.sql",
  );

  for (const oldPath of [
    "supabase/migrations/202607220001_platform_admin_foundation.sql",
    "supabase/migrations/202607220002_harden_public_users_access.sql",
    "supabase/migrations/202607220003_platform_admin_phase_1.sql",
    "supabase/migrations/202607220004_platform_admin_last_owner_lock_repair.sql",
  ]) {
    assert.equal(existsSync(oldPath), false, `${oldPath} should not be merged`);
  }

  assert.match(migration, /create table if not exists public\.platform_admin_roles/);
  assert.match(migration, /create table if not exists public\.platform_admin_memberships/);
  assert.match(migration, /'admin\.recovery\.read'/);
  assert.match(migration, /'admin\.recovery\.manage'/);
  assert.match(migration, /create or replace view public\.platform_admin_businesses_compat/);
  assert.match(migration, /from public\.accounts accounts/);
  assert.match(migration, /from public\.account_memberships memberships/);
  assert.match(migration, /references public\.accounts\(id\)/);
  assert.match(migration, /memberships\.account_id as organization_id/);
  assert.match(migration, /locations\.account_id/);
  assert.doesNotMatch(migration, /public\.organizations/);
  assert.doesNotMatch(migration, /public\.organization_memberships/);
  assert.doesNotMatch(migration, /locations\.organization_id/);
  assert.doesNotMatch(migration, /update_updated_at_column/);
  assert.match(repairMigration, /null::uuid as invited_by_user_id/);
  assert.match(repairMigration, /before_row public\.accounts%rowtype/);
  assert.match(repairMigration, /from public\.accounts\s+where id = p_business_id\s+for update/);
  assert.doesNotMatch(repairMigration, /for update;\s+[\s\S]{0,180}from public\.platform_admin_businesses_compat/);
  assert.match(legacyParamRepairMigration, /ignored_legacy_legal_name/);
  assert.match(legacyParamRepairMigration, /legacy_legal_name_ignored/);
});

test("platform admin recovery permission opens account recovery back office", () => {
  const adminRecoveryPage = read("app/(app)/admin/recovery/page.tsx");
  const accountSecurityBackOffice = read("lib/account-security-backoffice.ts");
  const backOfficeActions = read("app/settings/recovery-back-office/actions.ts");
  const migration = read(
    "supabase/migrations/202608300004_platform_admin_current_schema.sql",
  );

  assert.match(adminRecoveryPage, /PLATFORM_ADMIN_PERMISSIONS\.recoveryRead/);
  assert.match(read("app/(app)/admin/_components/admin-ui.tsx"), /label: "Recovery"/);
  assert.match(adminRecoveryPage, /RecoveryBackOfficePanel/);
  assert.match(accountSecurityBackOffice, /PLATFORM_ADMIN_PERMISSIONS\.recoveryRead/);
  assert.match(accountSecurityBackOffice, /PLATFORM_ADMIN_PERMISSIONS\.recoveryManage/);
  assert.match(backOfficeActions, /currentUserCanManageRecoveryBackOffice/);
  assert.match(backOfficeActions, /RECOVERY_ADMIN_PATH/);
  assert.match(migration, /account_recovery_current_user_can_read_support/);
  assert.match(migration, /account_recovery_current_user_can_manage_support/);
  assert.match(migration, /platform_admin_has_permission\('admin\.recovery\.read'\)/);
  assert.match(migration, /platform_admin_has_permission\('admin\.recovery\.manage'\)/);
  assert.match(migration, /not public\.account_recovery_current_user_can_manage_support\(\)/);
});
