import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { normalizePhoneForIdentity } from "../lib/phone-normalization.ts";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("normalizes claim phones into a canonical E.164-compatible value", () => {
  assert.equal(normalizePhoneForIdentity("(469) 555-1234"), "+14695551234");
  assert.equal(normalizePhoneForIdentity("1 469 555 1234"), "+14695551234");
  assert.equal(normalizePhoneForIdentity("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhoneForIdentity("555-1234"), null);
  assert.equal(normalizePhoneForIdentity(""), null);
});

test("customer identity claim migration keeps authorization on owned customers", () => {
  const migration = read("supabase/migrations/202608100003_customer_identity_claims.sql");

  for (const fragment of [
    "create table public.customer_claim_tokens",
    "create table public.customer_verified_phones",
    "create or replace function public.claim_customer_from_token",
    "create or replace function public.claim_customers_for_verified_phone",
    "create trigger auto_link_customer_to_verified_phone",
    "create trigger release_customer_identity_for_deleted_user",
    "and customer_user_id is null",
    "customers.customer_user_id",
  ]) {
    assert.ok(migration.includes(fragment), `Missing migration fragment: ${fragment}`);
  }

  assert.ok(
    !migration.includes("pos_tickets.customer_id in"),
    "Activity authorization must not be rewritten to direct ticket/customer id checks.",
  );
});

test("POS claim QR uses the local QR renderer instead of an external QR service", () => {
  const posClient = read("app/pos/pos-desk-client.tsx");
  const qrComponent = read("components/qr-code-tile.tsx");

  assert.ok(posClient.includes("Save receipt & visit history to ReyLUMI"));
  assert.ok(posClient.includes("dataKind=\"claim\""));
  assert.ok(qrComponent.includes("data-customer-claim-qr"));
  assert.ok(!posClient.includes("api.qrserver.com"));
});

test("phone OTP provider delegates delivery and verification to Supabase Auth", () => {
  const provider = read("lib/phone-otp.ts");

  assert.ok(provider.includes("sendPhoneVerificationOtp"));
  assert.ok(provider.includes("verifyPhoneVerificationOtp"));
  assert.ok(provider.includes("supabase.auth.getUser"));
  assert.ok(provider.includes("supabase.auth.updateUser"));
  assert.ok(provider.includes("supabase.auth.resend"));
  assert.ok(provider.includes("supabase.auth.verifyOtp"));
  assert.ok(provider.includes('type: "phone_change"'));
  assert.ok(provider.includes("userHasConfirmedPhone"));
  assert.ok(provider.includes('status: "already_confirmed"'));
  assert.ok(provider.includes("userHasPendingPhoneChange"));
  assert.ok(provider.includes("phone_change_not_created"));
  assert.ok(provider.includes("sms_send_failed"));
  assert.ok(
    provider.includes("Verification code could not be sent. Please try again."),
  );
  assert.ok(provider.includes("beforeAuthUserId"));
  assert.ok(provider.includes("afterAuthUserId"));
  assert.ok(provider.includes("PHONE_OTP_RESEND_COOLDOWN_SECONDS"));
  assert.ok(provider.includes("PHONE_OTP_ATTEMPT_LIMIT"));
  assert.ok(
    provider.includes("if (getSupabaseConfig())"),
    "Supabase Auth provider detection should not depend on NODE_ENV.",
  );
  assert.ok(
    !provider.includes('process.env.NODE_ENV !== "production" && getSupabaseConfig()'),
    "Local production-mode servers must not disable Supabase Auth OTP detection.",
  );
  assert.ok(!provider.toLowerCase().includes("twilio"));
  assert.ok(!provider.includes("message_service_sid"));
  assert.ok(!provider.includes("signInWithOtp"));
  assert.ok(!provider.includes("signUp"));
  assert.ok(!provider.toLowerCase().includes("service_role"));
});

test("account OTP actions only claim after provider verification succeeds", () => {
  const actions = read("app/account/actions.ts");
  const verifyActionStart = actions.indexOf("export async function verifyAccountPhoneOtpAction");
  const verifyProviderCall = actions.indexOf("verifyPhoneVerificationOtp", verifyActionStart);
  const recordVerifiedCall = actions.indexOf(
    "recordCustomerVerifiedPhoneFromAuth",
    verifyActionStart,
  );
  const claimCall = actions.indexOf("claimCustomersForVerifiedPhone", verifyActionStart);
  const failureRecordCall = actions.indexOf(
    "recordCustomerPhoneOtpVerificationFailure",
    verifyActionStart,
  );

  assert.ok(verifyActionStart > -1, "Missing verify account phone OTP action.");
  assert.ok(verifyProviderCall > verifyActionStart, "Provider verification must run.");
  assert.ok(
    recordVerifiedCall > verifyProviderCall,
    "Verified phone ownership must be recorded after provider verification.",
  );
  assert.ok(
    claimCall > recordVerifiedCall,
    "Customer records must be claimed only after verified ownership is recorded.",
  );
  assert.ok(
    failureRecordCall > verifyProviderCall,
    "Wrong provider codes must record failed attempts.",
  );
});

test("account phone-change OTP uses a Supabase Auth session client", () => {
  const actions = read("app/account/actions.ts");
  const provider = read("lib/phone-otp.ts");
  const server = read("lib/supabase/server.ts");
  const sendActionStart = actions.indexOf("export async function sendAccountPhoneVerificationOtpAction");
  const verifyActionStart = actions.indexOf("export async function verifyAccountPhoneOtpAction");
  const sendSessionClient = actions.indexOf(
    "createAuthenticatedSupabaseAuthSessionServerClient()",
    sendActionStart,
  );
  const sendProviderCall = actions.indexOf("sendPhoneVerificationOtp", sendActionStart);
  const confirmedAuthPhoneCheck = actions.indexOf(
    "getConfirmedAuthPhoneMatch",
    sendActionStart,
  );
  const beginChallengeCall = actions.indexOf(
    "beginCustomerPhoneOtpChallenge",
    sendActionStart,
  );
  const verifySessionClient = actions.indexOf(
    "createAuthenticatedSupabaseAuthSessionServerClient()",
    verifyActionStart,
  );
  const verifyProviderCall = actions.indexOf("verifyPhoneVerificationOtp", verifyActionStart);
  const sameUserGuard = actions.indexOf(
    "verifyResult.authUserId !== user.auth_user_id",
    verifyActionStart,
  );
  const recordVerifiedCall = actions.indexOf(
    "recordCustomerVerifiedPhoneFromAuth",
    verifyActionStart,
  );
  const profileActionStart = actions.indexOf("export async function updateAccountProfileAction");
  const currentProfilePhoneGuard = actions.indexOf(
    "const currentProfilePhone = normalizePhoneForIdentity(user.phone)",
    profileActionStart,
  );
  const changedPhoneRequirement = actions.indexOf(
    "} else if (phoneChanged) {",
    currentProfilePhoneGuard,
  );

  assert.ok(sendActionStart > -1, "Missing send account phone OTP action.");
  assert.ok(verifyActionStart > -1, "Missing verify account phone OTP action.");
  assert.ok(
    currentProfilePhoneGuard > profileActionStart,
    "Profile saves should compare the requested phone with the existing profile phone.",
  );
  assert.ok(
    changedPhoneRequirement > currentProfilePhoneGuard &&
      changedPhoneRequirement < sendActionStart,
    "Only changed unverified profile phones should require a phone OTP challenge.",
  );
  assert.ok(
    sendSessionClient > sendActionStart && sendSessionClient < sendProviderCall,
    "Phone-change sends must use the request-backed Supabase Auth session client.",
  );
  assert.ok(
    confirmedAuthPhoneCheck > sendActionStart &&
      confirmedAuthPhoneCheck < beginChallengeCall,
    "Already confirmed Auth phones must bypass local OTP challenge creation.",
  );
  assert.ok(
    verifySessionClient > verifyActionStart && verifySessionClient < verifyProviderCall,
    "Phone-change verifies must use the request-backed Supabase Auth session client.",
  );
  assert.ok(
    sameUserGuard > verifyProviderCall && sameUserGuard < recordVerifiedCall,
    "Verified phone records must not be written until the Auth user id is unchanged.",
  );

  assert.ok(actions.includes("deliveryMode: challenge.data.deliveryMode"));
  assert.ok(actions.includes("connectCurrentConfirmedAuthPhone"));
  assert.ok(actions.includes("alreadyConfirmedPhoneOtpResult"));
  assert.ok(actions.includes('"phone_change_not_created"'));
  assert.ok(actions.includes('"sms_send_failed"'));
  assert.ok(server.includes("getSupabaseSessionTokensFromRequest"));
  assert.ok(server.includes("REFRESH_TOKEN_COOKIE"));
  assert.ok(server.includes("supabase.auth.setSession"));
  assert.ok(actions.includes("sessionExpiredOtpResult"));
  assert.ok(actions.includes('"session_expired"'));
  assert.ok(provider.includes("session_expired"));
  assert.ok(
    !actions.includes("signInWithOtp") && !provider.includes("signInWithOtp"),
    "Existing-user phone changes must not use anonymous phone sign-in OTP.",
  );
});

test("account profile UI uses the personal shell and a modal phone OTP flow", () => {
  const page = read("app/account/page.tsx");
  const editor = read("app/account/account-profile-editor.tsx");
  const navigation = read("app/navigation-shell.tsx");
  const switcher = read("app/salon-switcher.tsx");
  const editableFieldsIndex = editor.indexOf("EditableField");
  const saveActionIndex = editor.indexOf('{saving ? "Saving..." : "Save"}');

  for (const fragment of [
    "Reylumi Account",
    "User Profile",
    "View your account details and update your personal information.",
    "routes.salons.list()",
    'href="/permissions"',
    "LogoutButton",
  ]) {
    assert.ok(!page.includes(fragment), `Account page still has redundant header fragment: ${fragment}`);
  }

  for (const fragment of [
    "function PhoneVerificationDialog",
    'role="dialog"',
    'aria-modal="true"',
    "Verify phone number",
    "Enter the verification code sent to",
    "sendAccountPhoneVerificationOtpAction",
    "verifyAccountPhoneOtpAction",
    "setPhoneVerificationOpen(true)",
    "phoneVerificationClaim ?",
    "profilePayload(verifiedPhone)",
    "maxLength={6}",
  ]) {
    assert.ok(editor.includes(fragment), `Missing account profile UI fragment: ${fragment}`);
  }

  assert.ok(
    editableFieldsIndex > -1 && saveActionIndex > editableFieldsIndex,
    "Profile Save should render after the editable fields, not at the top.",
  );
  assert.ok(
    !editor.includes("Phone verification required"),
    "Large inline OTP verification block should not return.",
  );
  assert.ok(!editor.includes("signInWithOtp"));
  assert.ok(!editor.toLowerCase().includes("twilio"));
  assert.ok(
    switcher.includes('label: "Salons"') &&
      switcher.includes('label: "Account Permissions"'),
    "Salons and Permissions should remain available through account navigation.",
  );
  assert.ok(
    navigation.includes("<LogoutButton") &&
      navigation.includes('href="/settings"') &&
      navigation.includes("More"),
    "Logout/settings/more capabilities should remain in the personal shell.",
  );
});

test("OTP migration enforces cooldowns, expiry, attempts, auth confirmation, and conflicts", () => {
  const claimMigration = read("supabase/migrations/202608100003_customer_identity_claims.sql");
  const migration = read("supabase/migrations/202608100004_customer_phone_otp_verification.sql");
  const combinedMigration = `${claimMigration}\n${migration}`;
  const sqlTest = read("supabase/tests/customer_identity_claims.sql");

  for (const fragment of [
    "create table if not exists public.customer_phone_otp_challenges",
    "failed_attempt_count",
    "locked_until",
    "interval '60 seconds'",
    "interval '10 minutes'",
    "begin_customer_phone_otp_challenge",
    "record_customer_phone_otp_verify_failure",
    "record_customer_verified_phone_from_auth",
    "auth_user.phone_confirmed_at",
    "phone_conflict",
    "already_verified",
    "'deliveryMode', delivery_mode",
    "delivery_mode := 'resend'",
  ]) {
    assert.ok(
      combinedMigration.includes(fragment),
      `Missing OTP migration fragment: ${fragment}`,
    );
  }

  for (const fragment of [
    "Immediate OTP resend was not throttled",
    "Expired OTP challenge was not rejected",
    "Wrong OTP attempts did not lock verification",
    "Verified phone was recorded before provider confirmation",
    "Phone change verification changed auth user id",
    "Phone change verification did not set phone_confirmed_at",
    "Verified phone record was not created after provider confirmation",
    "Confirmed Auth phone bypass created an OTP challenge",
    "Confirmed Auth phone did not create verified phone record",
    "Confirmed Auth phone did not claim eligible records",
    "Repeated confirmed Auth phone record was not idempotent",
    "Different Auth phone was allowed to bypass OTP",
    "Unconfirmed Auth phone was allowed to bypass OTP",
    "Verified OTP phone did not claim eligible records",
    "Already verified phone would trigger repeated SMS",
    "Verified phone conflict was not blocked",
  ]) {
    assert.ok(sqlTest.includes(fragment), `Missing OTP SQL test fragment: ${fragment}`);
  }
});
