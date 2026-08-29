import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

function exists(path) {
  return existsSync(path);
}

const accountDeletionService = read("lib/account-deletion.ts");
const salonLifecycleService = read("lib/salon-lifecycle.ts");
const accountActions = read("app/account/actions.ts");
const accountPage = read("app/(app)/account/page.tsx");
const accountPanel = read("app/account/account-deletion-panel.tsx");
const settingsPage = read("app/(app)/settings/page.tsx");
const salonSettingsActions = read("app/salon-settings/actions.ts");
const salonSettingsPage = read("app/(app)/salon-settings/page.tsx");
const salonLifecycleSection = read("app/salon-settings/salon-lifecycle-section.tsx");
const currentContext = read("lib/current-context.ts");
const migration = read("supabase/migrations/202608210003_account_deletion_flow.sql");
const validationScript = read("scripts/validate-account-salon-foundation.ps1");

test("Phase 2 account deletion service keeps ownership analysis server-side", () => {
  for (const exportName of [
    "analyzeAccountDeletionImpact",
    "requestAccountDeletion",
    "cancelAccountDeletion",
    "generateAccountDeletionBackup",
  ]) {
    assert.match(
      accountDeletionService,
      new RegExp(`export async function ${exportName}`),
    );
  }

  assert.match(accountDeletionService, /account_memberships/);
  assert.match(accountDeletionService, /salon_memberships/);
  assert.match(accountDeletionService, /OWNER/);
  assert.match(accountDeletionService, /get_account_deletion_owner_counts/);
  assert.match(accountDeletionService, /activeOwnerCounts/);
  assert.doesNotMatch(accountActions, /isLastOwner/);
  assert.doesNotMatch(accountPanel, /isLastOwner\s*:/);
});

test("Phase 2 migration owns transactional request and cancel semantics", () => {
  for (const functionName of [
    "account_deletion_other_active_owner_exists",
    "request_account_deletion",
    "cancel_account_deletion",
  ]) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${functionName}`),
    );
  }

  assert.match(migration, /account_lifecycle_events/);
  assert.match(migration, /interval '30 days'/);
  assert.match(migration, /public\.close_salon_permanently/);
  assert.match(migration, /p_continue_without_transfer/);
  assert.match(migration, /p_backup_acknowledged/);
  assert.match(migration, /status = 'pending_deletion'/);
  assert.match(migration, /status = 'active'/);
  assert.match(migration, /deletion_requested_at = null/);
  assert.match(migration, /user_row\.status not in \('active', 'pending_deletion'\)/);
  assert.doesNotMatch(migration, /permanently_closed[\s\S]*reactivate_salon/);
  assert.ok(exists("supabase/tests/account_deletion_flow.sql"));
  assert.match(validationScript, /account_deletion_flow\.sql/);
});

test("Account Settings exposes backup, no-transfer, pending, and cancel UX", () => {
  assert.match(accountPage, /analyzeAccountDeletionImpact/);
  assert.match(accountPage, /AccountDeletionPanel/);
  assert.match(accountPanel, /Download backup/);
  assert.match(accountPanel, /Continue without transfer/);
  assert.match(accountPanel, /permanently close my last-owner/);
  assert.match(accountPanel, /Account deletion scheduled/);
  assert.match(accountPanel, /Cancel account deletion/);
  assert.match(accountPanel, /Type DELETE to confirm/);
  assert.match(settingsPage, /Delete account/);
  assert.match(settingsPage, /Account deletion scheduled/);
});

test("Salon Settings exposes lifecycle actions through shared service actions", () => {
  assert.match(salonSettingsPage, /SalonLifecycleSection/);
  assert.match(salonSettingsPage, /getSalonClosureReview/);
  assert.match(salonSettingsPage, /getSalonLifecycle/);
  assert.match(salonLifecycleSection, /Disable salon/);
  assert.match(salonLifecycleSection, /Reactivate salon/);
  assert.match(salonLifecycleSection, /Permanently close salon/);
  assert.match(salonLifecycleSection, /Historical access only/);
  assert.match(salonLifecycleSection, /Download backup/);

  for (const actionName of [
    "disableCurrentSalonAction",
    "reactivateCurrentSalonAction",
    "closeCurrentSalonPermanentlyAction",
    "generateCurrentSalonBackupAction",
  ]) {
    assert.match(
      salonSettingsActions,
      new RegExp(`export async function ${actionName}`),
    );
  }

  assert.match(salonSettingsActions, /disableSalon/);
  assert.match(salonSettingsActions, /reactivateSalon/);
  assert.match(salonSettingsActions, /closeSalonPermanently/);
  assert.match(salonSettingsActions, /getSalonClosureReview/);
  assert.doesNotMatch(salonSettingsActions, /\.from\("locations"\)\.update/);
});

test("Lifecycle service provides closure review and lightweight backup summary", () => {
  assert.match(salonLifecycleService, /export async function getSalonClosureReview/);
  assert.match(salonLifecycleService, /export async function generateSalonLifecycleBackup/);
  assert.match(salonLifecycleService, /futureBookings/);
  assert.match(salonLifecycleService, /openPosTickets/);
  assert.match(salonLifecycleService, /payroll\.view/);
  assert.match(salonLifecycleService, /customers\.view/);
  assert.match(salonLifecycleService, /Full private archives/);
});

test("Historical salon workspaces do not promote active POS or Today actions", () => {
  assert.match(currentContext, /normalizeSalonLifecycleStatus/);
  assert.match(currentContext, /getHistoricalManageDefaultRoute/);
  assert.match(currentContext, /Ticket history/);
  assert.match(currentContext, /\/pos-tickets/);
  assert.match(currentContext, /historicalMode/);
  assert.match(currentContext, /Temporarily disabled/);
  assert.match(currentContext, /Permanently closed/);
});
