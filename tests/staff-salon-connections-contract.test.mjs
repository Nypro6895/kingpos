import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baselineMigration = readFileSync(
  "supabase/migrations/202607240001_account_salon_baseline.sql",
  "utf8",
);
const phoneIdentityMigration = readFileSync(
  "supabase/migrations/202608180006_staff_connection_phone_identity.sql",
  "utf8",
);
const staffWorkspaceContextMigration = readFileSync(
  "supabase/migrations/202608170002_staff_workspace_context_rls.sql",
  "utf8",
);
const currentContext = readFileSync("lib/current-context.ts", "utf8");
const staffConnectionNormalization = readFileSync(
  "lib/staff-connection-normalization.ts",
  "utf8",
);
const staffSalonConnections = readFileSync(
  "lib/staff-salon-connections.ts",
  "utf8",
);

function functionBlock(source, name, nextMarker) {
  const start = source.indexOf(`create or replace function public.${name}`);

  assert.ok(start >= 0, `${name} function is present`);

  const end = nextMarker ? source.indexOf(nextMarker, start + 1) : -1;

  assert.ok(end > start, `${name} function has a readable boundary`);

  return source.slice(start, end);
}

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);

  assert.ok(start >= 0, `${startMarker} is present`);

  const end = source.indexOf(endMarker, start + 1);

  assert.ok(end > start, `${startMarker} has a readable boundary`);

  return source.slice(start, end);
}

test("public staff application search remains a narrow security-definer RPC and is callable by anon", () => {
  const searchBlock = functionBlock(
    baselineMigration,
    "search_public_staff_application_salons",
    "create or replace function public.submit_staff_salon_application",
  );

  assert.match(searchBlock, /security definer/);
  assert.match(searchBlock, /settings\.allow_staff_applications = true/);
  assert.match(searchBlock, /salons\.status = 'active'/);
  assert.match(searchBlock, /returns table \(\s*salon_id uuid/);
  assert.doesNotMatch(searchBlock, /staff_salon_connection_requests/);
  assert.doesNotMatch(searchBlock, /public\.users/);
  assert.match(
    phoneIdentityMigration,
    /grant execute on function public\.search_public_staff_application_salons\(text, text, text, integer\) to anon;/,
  );
});

test("staff invitation phones reuse the centralized account identity normalizer", () => {
  assert.match(
    staffConnectionNormalization,
    /import \{ normalizePhoneForIdentity \} from "@\/lib\/phone-normalization";/,
  );
  assert.match(staffConnectionNormalization, /normalizePhoneForIdentity\(trimmed\)/);
  assert.doesNotMatch(staffConnectionNormalization, /const PHONE_PATTERN/);
  assert.doesNotMatch(staffConnectionNormalization, /replace\(\/\\D\/g/);
});

test("existing-account staff invites reuse the exact account resolver", () => {
  const resolverBlock = sourceBlock(
    staffSalonConnections,
    "async function resolveExistingInviteAccount",
    "async function assertAccountNotConnectedToSalon",
  );
  const createInviteBlock = sourceBlock(
    staffSalonConnections,
    "async function createExistingAccountInvite",
    "async function createNewAccountInvite",
  );

  assert.match(resolverBlock, /requireStaffConnectionContact\(input\)/);
  assert.match(resolverBlock, /search_staff_connection_account_exact/);
  assert.match(resolverBlock, /result\.account\.id !== input\.account_user_id/);
  assert.doesNotMatch(resolverBlock, /\.from\("users"\)/);
  assert.match(createInviteBlock, /resolveExistingInviteAccount\(auth, input\)/);
  assert.match(createInviteBlock, /const targetEmail = account\.email;/);
  assert.match(createInviteBlock, /const targetPhone = account\.phone;/);
});

test("staff invitation matching uses canonical verified account phones", () => {
  const phoneStatusBlock = functionBlock(
    phoneIdentityMigration,
    "staff_connection_invite_phone_status",
    "create or replace function public.staff_connection_invite_identity_status",
  );
  const identityStatusBlock = functionBlock(
    phoneIdentityMigration,
    "staff_connection_invite_identity_status",
    "revoke all on function public.staff_connection_invite_phone_status",
  );

  assert.match(phoneStatusBlock, /public\.normalize_customer_claim_phone\(p_target_phone\)/);
  assert.match(phoneStatusBlock, /public\.normalize_customer_claim_phone\(users\.phone\)/);
  assert.match(phoneStatusBlock, /from public\.customer_verified_phones verified/);
  assert.match(phoneStatusBlock, /return 'phone_verified';/);
  assert.match(identityStatusBlock, /public\.staff_connection_invite_phone_status/);
  assert.match(identityStatusBlock, /'phone_unverified'/);
  assert.match(identityStatusBlock, /'phone_mismatch'/);
  assert.match(identityStatusBlock, /return phone_status;/);
  assert.doesNotMatch(
    phoneIdentityMigration,
    /regexp_replace\(coalesce\(current_user_row\.phone/,
  );
});

test("listing and acceptance share the invitation identity resolver", () => {
  const acceptBlock = functionBlock(
    phoneIdentityMigration,
    "apply_staff_connection_invite_decision",
    "revoke all on function public.apply_staff_connection_invite_decision",
  );
  const listBlock = functionBlock(
    phoneIdentityMigration,
    "list_my_staff_salon_connection_requests",
    "grant execute on function public.list_my_staff_salon_connection_requests",
  );

  assert.match(acceptBlock, /public\.staff_connection_invite_identity_status/);
  assert.match(listBlock, /public\.staff_connection_invite_identity_status/);
  assert.match(acceptBlock, /This invitation was sent to a different phone number\./);
  assert.match(
    acceptBlock,
    /Verify the invited phone in Account Settings before accepting this invitation\./,
  );
  assert.match(acceptBlock, /This invitation is no longer pending\./);
  assert.match(acceptBlock, /This invitation has expired\./);
  assert.match(acceptBlock, /This invitation belongs to a different account\./);
  assert.match(
    phoneIdentityMigration,
    /revoke all on function public\.apply_staff_connection_invite_decision\(uuid, text, text\) from public;/,
  );
});

test("stored invitation phones are migrated and constrained to canonical E.164 form", () => {
  assert.match(
    phoneIdentityMigration,
    /set target_phone_e164 = public\.normalize_customer_claim_phone\(target_phone_e164\)/,
  );
  assert.match(
    phoneIdentityMigration,
    /staff_connection_target_phone_e164_canonical_check/,
  );
  assert.match(
    phoneIdentityMigration,
    /target_phone_e164 = public\.normalize_customer_claim_phone\(target_phone_e164\)/,
  );
});

test("staff-linked salon and account rows are readable only for active linked staff", () => {
  assert.match(
    staffWorkspaceContextMigration,
    /create policy "staff_member_read_linked_locations" on public\.locations/,
  );
  assert.match(
    staffWorkspaceContextMigration,
    /status = 'active'\s+and exists \(\s+select 1\s+from public\.staff linked_staff/,
  );
  assert.match(
    staffWorkspaceContextMigration,
    /linked_staff\.account_user_id = public\.current_public_user_id\(\)/,
  );
  assert.match(staffWorkspaceContextMigration, /linked_staff\.is_active = true/);
  assert.match(
    staffWorkspaceContextMigration,
    /create policy "staff_member_read_linked_accounts" on public\.accounts/,
  );
  assert.match(
    staffWorkspaceContextMigration,
    /join public\.staff linked_staff\s+on linked_staff\.salon_id = linked_location\.id/,
  );
});

test("staff-linked accounts remain available after staff salon hydration", () => {
  const contextBlock = sourceBlock(
    currentContext,
    "export async function getCurrentBusinessContext",
    "async function setPersistentCookie",
  );
  const staffLoadIndex = contextBlock.indexOf(
    "const staffLinkedContext = await loadStaffSalons",
  );
  const availableAccountsIndex = contextBlock.indexOf(
    "const availableAccounts = dedupeById([...accountsById.values()])",
  );

  assert.ok(staffLoadIndex > 0, "staff salons are loaded in current context");
  assert.ok(
    availableAccountsIndex > staffLoadIndex,
    "available accounts include staff-linked accounts loaded by loadStaffSalons",
  );
  assert.match(contextBlock, /const memberAccounts = dedupeById/);
  assert.match(contextBlock, /const accountIds = memberAccounts\.map/);

  const staffContextBlock = sourceBlock(
    currentContext,
    "export async function getCurrentStaffBusinessContext",
    "async function getCurrentBusinessContextAuth",
  );

  assert.match(staffContextBlock, /context\.availableAccounts\.find/);
});
