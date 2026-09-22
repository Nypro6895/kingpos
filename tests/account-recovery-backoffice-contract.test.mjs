import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const accountRecoveryPage = read("app/(app)/account-recovery/page.tsx");
const accountRecoveryForm = read(
  "app/account-recovery/account-recovery-form.tsx",
);
const accountRecoveryActions = read("app/account-recovery/actions.ts");
const backOfficePage = read("app/(app)/settings/recovery-back-office/page.tsx");
const backOfficePanel = read(
  "app/settings/recovery-back-office/recovery-back-office-panel.tsx",
);
const backOfficeActions = read("app/settings/recovery-back-office/actions.ts");
const accountSecurityBackOffice = read("lib/account-security-backoffice.ts");
const settingsPage = read("app/(app)/settings/page.tsx");
const migration = read(
  "supabase/migrations/202608300001_account_login_security.sql",
);
const platformAdminMigration = read(
  "supabase/migrations/202608300004_platform_admin_current_schema.sql",
);

test("public account recovery page submits recovery codes without signing in", () => {
  assert.ok(existsSync("app/(app)/account-recovery/page.tsx"));
  assert.ok(existsSync("app/account-recovery/account-recovery-form.tsx"));
  assert.ok(existsSync("app/account-recovery/actions.ts"));

  assert.match(accountRecoveryPage, /<AccountRecoveryForm nextPath=\{nextPath\} \/>/);
  assert.match(accountRecoveryPage, /does not\s+sign anyone in automatically/);
  assert.match(accountRecoveryForm, /Account email or profile phone/);
  assert.match(accountRecoveryForm, /Recovery code/);
  assert.match(accountRecoveryForm, /role="alert"/);
  assert.match(accountRecoveryForm, /role="status"/);
  assert.match(accountRecoveryActions, /redeemRecoveryCodeAction/);
  assert.match(accountRecoveryActions, /createSupabaseServerClient/);
  assert.match(accountRecoveryActions, /redeem_account_recovery_code/);
  assert.match(accountRecoveryActions, /If the account and recovery code match/);
  assert.doesNotMatch(accountRecoveryActions, /signInWithPassword/);
  assert.doesNotMatch(accountRecoveryActions, /setSupabaseSessionCookies/);
  assert.doesNotMatch(accountRecoveryActions, /updateUser/);
});

test("recovery code redemption is one-time, non-enumerating, and support-reviewed", () => {
  assert.match(migration, /create or replace function public\.redeem_account_recovery_code/);
  assert.match(migration, /set used_at = now\(\)/);
  assert.match(migration, /'lost_access'/);
  assert.match(migration, /'reviewing'/);
  assert.match(migration, /'high'/);
  assert.match(migration, /'medium'/);
  assert.match(migration, /'verified_recovery_code', true/);
  assert.match(migration, /'recovery_code_redeemed'/);
  assert.match(migration, /jsonb_build_object\('submitted', true, 'accepted', false\)/);
  assert.match(migration, /to anon, authenticated/);
});

test("recovery back office reuses support admin controls and exposes secure actions", () => {
  assert.ok(existsSync("app/(app)/settings/recovery-back-office/page.tsx"));
  assert.ok(existsSync("app/(app)/admin/recovery/page.tsx"));
  assert.ok(existsSync("app/settings/recovery-back-office/recovery-back-office-panel.tsx"));
  assert.ok(existsSync("app/settings/recovery-back-office/actions.ts"));

  assert.match(settingsPage, /currentUserCanAccessRecoveryBackOffice/);
  assert.match(settingsPage, /href: "\/settings\/recovery-back-office"/);
  assert.match(accountSecurityBackOffice, /lifecycle_current_user_is_support_admin/);
  assert.match(accountSecurityBackOffice, /PLATFORM_ADMIN_PERMISSIONS\.recoveryRead/);
  assert.match(accountSecurityBackOffice, /PLATFORM_ADMIN_PERMISSIONS\.recoveryManage/);
  assert.match(accountSecurityBackOffice, /authorized: false/);
  assert.match(accountSecurityBackOffice, /recoveryCodeVerified/);
  assert.match(backOfficePage, /redirect\("\/login\?next=\/settings\/recovery-back-office"\)/);
  assert.match(backOfficePage, /RecoveryBackOfficePanel/);
  assert.match(backOfficePanel, /Recovery code verified/);
  assert.match(backOfficePanel, /Secure account/);
  assert.match(backOfficeActions, /currentUserCanManageRecoveryBackOffice/);
  assert.match(backOfficeActions, /account_recovery_support_update_request/);
  assert.match(backOfficeActions, /account_recovery_support_secure_account/);
  assert.match(backOfficeActions, /account_recovery_support_update_user_status/);
  assert.match(migration, /account_recovery_support_secure_account/);
  assert.match(migration, /revoked_at = now\(\)/);
  assert.match(migration, /removed_at = now\(\)/);
  assert.match(migration, /next_status not in \('active', 'suspended'\)/);
  assert.match(platformAdminMigration, /'admin\.recovery\.read'/);
  assert.match(platformAdminMigration, /'admin\.recovery\.manage'/);
  assert.match(platformAdminMigration, /account_recovery_current_user_can_manage_support/);
});
