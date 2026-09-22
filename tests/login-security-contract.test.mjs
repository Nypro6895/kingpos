import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ACCOUNT_LOGIN_SESSION_COOKIE,
  getLoginRequestSnapshot,
  isAccountLoginSessionId,
  parseLoginUserAgent,
} from "../lib/account-security-shared.ts";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const settingsPage = read("app/(app)/settings/page.tsx");
const loginSecurityPage = read("app/(app)/settings/login-security/page.tsx");
const loginSecurityPanel = read(
  "app/settings/login-security/login-security-panel.tsx",
);
const loginSecurityQuickEditor = read(
  "app/settings/login-security/login-security-quick-editor.tsx",
);
const loginSecurityActions = read("app/settings/login-security/actions.ts");
const accountSecurity = read("lib/account-security.ts");
const accountSecurityShared = read("lib/account-security-shared.ts");
const loginSmsAlerts = read("lib/login-sms-alerts.ts");
const loginRoute = read("app/(app)/api/auth/login/route.ts");
const mfaVerifyRoute = read("app/(app)/api/auth/mfa/verify/route.ts");
const logoutRoute = read("app/(app)/api/auth/logout/route.ts");
const serverAuth = read("lib/supabase/server.ts");
const migration = read(
  "supabase/migrations/202608300001_account_login_security.sql",
);
const supabaseConfig = read("supabase/config.toml");

test("All Settings opens the dedicated Login Security route", () => {
  assert.ok(existsSync("app/(app)/settings/login-security/page.tsx"));
  assert.match(settingsPage, /href: "\/settings\/login-security"/);
  assert.match(settingsPage, /status: "Security center"/);
  assert.match(loginSecurityPage, /loadLoginSecurityOverview/);
  assert.match(loginSecurityPage, /redirect\("\/login\?next=\/settings\/login-security"\)/);
  assert.match(loginSecurityPage, /<LoginSecurityPanel overview=\{overview\} \/>/);
});

test("Login Security UI covers password, sessions, trusted devices, MFA, alerts, recovery, and secure account", () => {
  const loginSecurityUi = `${loginSecurityPanel}\n${loginSecurityQuickEditor}`;

  for (const label of [
    "Change password",
    "Where you're logged in",
    "Log out all devices",
    "Trusted devices",
    "Remember this device",
    "Two-factor authentication",
    "Set up authenticator",
    "Phone SMS",
    "Send SMS code",
    "SMS code",
    "Verify phone 2FA",
    "SMS alerts",
    "phone in Profile",
    "Login alerts & recovery contacts",
    "Recovery codes",
    "Account recovery",
    "Secure my account",
    "Recent login activity",
  ]) {
    assert.match(loginSecurityUi, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(loginSecurityUi, /pendingKey/);
  assert.match(loginSecurityUi, /role="alert"/);
  assert.match(loginSecurityUi, /role="status"/);
  assert.match(loginSecurityUi, /EmptyState/);
});

test("Login Security actions are authenticated and implement the requested mutations", () => {
  for (const actionName of [
    "updateLoginSecurityPreferencesAction",
    "changeAccountPasswordAction",
    "revokeLoginSessionAction",
    "logOutCurrentSessionAction",
    "logOutAllSessionsAction",
    "trustCurrentDeviceAction",
    "removeTrustedDeviceAction",
    "beginTotpEnrollmentAction",
    "verifyTotpEnrollmentAction",
    "beginPhoneMfaEnrollmentAction",
    "verifyPhoneMfaEnrollmentAction",
    "disableMfaFactorAction",
    "disableTotpFactorAction",
    "generateRecoveryCodesAction",
    "createRecoveryRequestAction",
    "secureMyAccountAction",
  ]) {
    assert.match(loginSecurityActions, new RegExp(`export async function ${actionName}`));
  }

  assert.match(loginSecurityActions, /createAuthenticatedSupabaseServerClient/);
  assert.match(loginSecurityActions, /createAuthenticatedSupabaseAuthSessionServerClient/);
  assert.match(loginSecurityActions, /signInWithPassword/);
  assert.match(loginSecurityActions, /auth\.updateUser\(\{\s*password: newPassword/);
  assert.match(loginSecurityActions, /factorType: "phone"/);
  assert.match(loginSecurityActions, /normalizePhoneForIdentity\(context\.user\.phone\)/);
  assert.doesNotMatch(loginSecurityActions, /readActionString\(input, "phone"\)/);
  assert.match(loginSecurityActions, /channel: "sms"/);
  assert.match(loginSecurityActions, /signOut\(\{ scope \}\)/);
  assert.match(loginSecurityActions, /scope: "global" \| "local" \| "others"/);
  assert.match(loginSecurityActions, /account_login_sessions/);
  assert.match(loginSecurityActions, /account_trusted_devices/);
  assert.match(loginSecurityActions, /account_recovery_codes/);
  assert.match(loginSecurityActions, /account_recovery_requests/);
  assert.match(loginSecurityActions, /account_login_activity/);
});

test("Login Security MFA loader supports authenticator and phone factors", () => {
  assert.match(accountSecurity, /factorType: "phone" \| "totp"/);
  assert.match(accountSecurity, /mfaData\?\.totp/);
  assert.match(accountSecurity, /mfaData\?\.phone/);
  assert.match(accountSecurity, /phone: string \| null/);
  assert.match(supabaseConfig, /\[auth\.mfa\.phone\][\s\S]*enroll_enabled = true/);
  assert.match(supabaseConfig, /\[auth\.mfa\.phone\][\s\S]*verify_enabled = true/);
});

test("SMS login alerts default to profile phone and never block login", () => {
  assert.match(accountSecurity, /smsLoginAlertsEnabled: Boolean\(user\.phone\)/);
  assert.match(accountSecurity, /row\.sms_login_alerts_enabled \?\? Boolean\(input\.user\.phone\)/);
  assert.match(accountSecurity, /maybeSendLoginSmsAlert/);
  assert.match(accountSecurity, /sendLoginSmsAlert/);
  assert.match(accountSecurity, /login_sms_alert_sent/);
  assert.match(accountSecurity, /login_sms_alert_failed/);
  assert.match(accountSecurity, /\.catch\(\(smsError: unknown\) =>/);
  assert.match(loginSecurityActions, /sms_login_alerts_enabled: context\.user\.phone/);
  assert.match(loginSmsAlerts, /TWILIO_ACCOUNT_SID/);
  assert.match(loginSmsAlerts, /SMS login alerts are not configured/);
});

test("Login and logout routes wire app-owned session tracking", () => {
  assert.match(accountSecurityShared, /ACCOUNT_LOGIN_SESSION_COOKIE = "kingpos-login-session-id"/);
  assert.match(loginRoute, /randomUUID\(\)/);
  assert.match(loginRoute, /recordAccountLoginForSession/);
  assert.match(loginRoute, /response\.cookies\.set\(\s*ACCOUNT_LOGIN_SESSION_COOKIE/);
  assert.match(loginRoute, /loginMfaRequiredResponse/);
  assert.match(loginRoute, /setPendingMfaSessionCookieWriter/);
  assert.match(mfaVerifyRoute, /auth\.mfa\.verify/);
  assert.match(mfaVerifyRoute, /recordAccountLoginForSession/);
  assert.match(mfaVerifyRoute, /ACCOUNT_LOGIN_SESSION_COOKIE/);
  assert.match(logoutRoute, /recordCurrentAccountSessionLogout/);
  assert.match(logoutRoute, /response\.cookies\.delete\(ACCOUNT_LOGIN_SESSION_COOKIE\)/);
  assert.match(serverAuth, /isAppLoginSessionCookieAllowed/);
  assert.match(serverAuth, /PENDING_MFA_ACCESS_TOKEN_COOKIE/);
  assert.match(serverAuth, /clearPendingMfaSessionCookieWriter/);
  assert.match(serverAuth, /ACCOUNT_LOGIN_SESSION_COOKIE/);
  assert.match(serverAuth, /revoked_at/);
  assert.doesNotMatch(serverAuth, /readSessionFromCookieValue/);
});

test("Account Login Security migration adds tables, RLS, grants, and login alert RPC", () => {
  for (const tableName of [
    "account_security_preferences",
    "account_login_sessions",
    "account_trusted_devices",
    "account_login_activity",
    "account_recovery_codes",
    "account_recovery_requests",
    "account_recovery_request_events",
  ]) {
    assert.match(
      migration,
      new RegExp(`create table if not exists public\\.${tableName}`),
    );
    assert.match(
      migration,
      new RegExp(`alter table public\\.${tableName} enable row level security`),
    );
  }

  assert.match(migration, /create or replace function public\.record_account_login_session/);
  assert.match(migration, /create or replace function public\.redeem_account_recovery_code/);
  assert.match(migration, /public\.current_public_user_id\(\)/);
  assert.match(migration, /insert into public\.app_notifications/);
  assert.match(migration, /'login_alert'/);
  assert.match(migration, /grant execute on function public\.record_account_login_session/);
  assert.match(migration, /grant execute on function public\.redeem_account_recovery_code/);
});

test("Login request snapshot parses device and approximate location headers", () => {
  const chromeWindows =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  const parsed = parseLoginUserAgent(chromeWindows);
  const snapshot = getLoginRequestSnapshot(
    new Headers({
      "user-agent": chromeWindows,
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "x-vercel-ip-city": "Chicago",
      "x-vercel-ip-country": "US",
      "x-vercel-ip-country-region": "IL",
    }),
  );

  assert.equal(ACCOUNT_LOGIN_SESSION_COOKIE, "kingpos-login-session-id");
  assert.equal(isAccountLoginSessionId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isAccountLoginSessionId("not-a-session"), false);
  assert.equal(parsed.deviceLabel, "Chrome on Windows");
  assert.equal(snapshot.ipAddress, "203.0.113.10");
  assert.equal(snapshot.locationLabel, "Chicago, IL, US");
  assert.equal(snapshot.deviceType, "desktop");
});
