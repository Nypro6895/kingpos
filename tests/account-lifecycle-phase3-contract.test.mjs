import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

const migration = read("supabase/migrations/202608210006_account_lifecycle_phase3.sql");
const accountActions = read("app/account/actions.ts");
const accountDeletionPanel = read("app/account/account-deletion-panel.tsx");
const currentUser = read("lib/users/current-user.ts");
const lifecycleExport = read("lib/lifecycle-export.ts");
const lifecycleExportStorage = read("lib/lifecycle-export-storage.ts");
const ownerTransfer = read("lib/owner-transfer.ts");
const retentionPolicy = read("lib/account-retention-policy.ts");
const salonLifecycle = read("lib/salon-lifecycle.ts");
const server = read("lib/supabase/server.ts");
const validationScript = read("scripts/validate-account-salon-foundation.ps1");

test("Phase 3 migration adds finalization, tombstone, export, transfer, and recovery primitives", () => {
  for (const tableName of [
    "deleted_auth_identities",
    "lifecycle_exports",
    "lifecycle_support_admins",
    "salon_owner_transfer_invites",
  ]) {
    assert.match(
      migration,
      new RegExp(`create table if not exists public\\.${tableName}`),
    );
  }

  for (const functionName of [
    "auth_identity_is_deleted",
    "create_salon_owner_transfer_invite",
    "accept_salon_owner_transfer_invite",
    "relinquish_current_salon_ownership",
    "finalize_account_deletion",
    "finalize_due_account_deletions",
    "recover_permanently_closed_salon",
  ]) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${functionName}`),
    );
  }

  assert.match(migration, /status = 'pending_deletion'/);
  assert.match(migration, /deletion_scheduled_for <= now\(\)/);
  assert.match(migration, /account_deletion_unresolved_owned_salon_count/);
  assert.match(migration, /status = 'deleted'/);
  assert.match(migration, /auth_user_id = null/);
  assert.match(migration, /on conflict \(auth_user_id\)/);
  assert.match(migration, /cron\.schedule/);
});

test("owner transfer is tokenized, accepted server-side, and integrated in Delete Account", () => {
  assert.match(ownerTransfer, /randomBytes\(32\)/);
  assert.match(ownerTransfer, /createHash\("sha256"\)/);
  assert.match(ownerTransfer, /create_salon_owner_transfer_invite/);
  assert.match(ownerTransfer, /accept_salon_owner_transfer_invite/);
  assert.match(ownerTransfer, /accept_salon_owner_transfer_invite_by_id/);
  assert.match(accountActions, /createOwnerTransferInviteAction/);
  assert.match(accountActions, /acceptOwnerTransferInviteAction/);
  assert.match(accountDeletionPanel, /Create invite/);
  assert.match(accountDeletionPanel, /transfer_ownership/);
  assert.doesNotMatch(accountDeletionPanel, /invite sent[\s\S]*deletion can proceed/i);
});

test("private export pipeline uses explicit serializers and Supabase storage abstraction", () => {
  assert.match(lifecycleExportStorage, /LIFECYCLE_EXPORT_BUCKET = "lifecycle-exports"/);
  assert.match(lifecycleExportStorage, /\.from\("lifecycle_exports"\)/);
  assert.match(lifecycleExportStorage, /\.storage\s*\n\s*\.from\(LIFECYCLE_EXPORT_BUCKET\)/);
  assert.match(lifecycleExportStorage, /createSignedUrl/);
  assert.doesNotMatch(lifecycleExportStorage, /storage\/v1\/object\/public/);

  for (const domain of [
    "bookings",
    "customers",
    "daily_log",
    "lifecycle",
    "payroll",
    "pos",
    "reviews",
    "services",
    "settings",
    "staff",
  ]) {
    assert.match(lifecycleExport, new RegExp(`id: "${domain}"`));
  }

  assert.match(lifecycleExport, /user_has_salon_permission/);
  assert.match(lifecycleExport, /lifecycle_user_is_salon_owner/);
  assert.doesNotMatch(lifecycleExport, /customer_cancellation_token_hash/);
  assert.doesNotMatch(lifecycleExport, /select\("\*"\)/);
});

test("retention and deleted-user presentation are centralized", () => {
  for (const category of [
    "PERSONAL_PROFILE",
    "AUTH_IDENTITY",
    "BUSINESS_OPERATIONAL_HISTORY",
    "PAYROLL",
    "TAX",
    "AUDIT",
    "REVIEWS_CONTENT",
    "CUSTOMER_TRANSACTION_HISTORY",
    "EXPORT_ARCHIVES",
    "RECOVERY_METADATA",
  ]) {
    assert.match(retentionPolicy, new RegExp(`"${category}"`));
  }

  assert.ok(existsSync("lib/deleted-user-display.ts"));
  assert.match(migration, /display_name = 'Deleted user'/);
  assert.match(migration, /update public\.beauty_profiles/);
  assert.match(migration, /visibility = 'self'/);
  assert.match(migration, /delete from public\.beauty_profile_follows/);
  assert.match(migration, /delete from public\.account_post_saves/);
  assert.match(migration, /public_profile_visible = false/);
  assert.match(migration, /delete from public\.salon_profile_follows/);
  assert.match(migration, /delete from public\.account_favorite_customers/);
});

test("auth fallback cannot recreate finalized deleted identities", () => {
  assert.match(server, /auth_identity_is_deleted/);
  assert.match(currentUser, /authIdentityWasFinalized/);
  assert.match(currentUser, /Deleted auth identity tombstone blocked public user fallback/);
});

test("RLS hardening supports accepted salon-level owners without broad account membership", () => {
  for (const policyName of [
    "salon_member_read_accounts",
    "salon_member_read_locations_by_membership",
    "salon_member_read_roles",
    "salon_member_read_own_role_permissions",
    "salon_member_read_account_memberships_for_salon_account",
  ]) {
    assert.match(migration, new RegExp(`create policy "${policyName}"`));
  }

  assert.match(migration, /or exists \(\s*select 1\s*from public\.salon_memberships/);
  assert.match(migration, /user_has_salon_permission/);
});

test("privileged recovery remains separate from normal reactivation", () => {
  assert.match(salonLifecycle, /recoverPermanentlyClosedSalon/);
  assert.match(migration, /lifecycle_current_user_is_support_admin/);
  assert.match(migration, /status = 'disabled'/);
  assert.match(migration, /SALON_RECOVERY_APPROVED/);
  assert.doesNotMatch(accountDeletionPanel, /recoverPermanentlyClosedSalon/);
});

test("Phase 3 SQL test is part of local validation", () => {
  assert.ok(existsSync("supabase/tests/account_lifecycle_phase3.sql"));
  assert.match(validationScript, /account_lifecycle_phase3\.sql/);
});
