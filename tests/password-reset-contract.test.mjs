import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("login exposes forgot password without losing the return path", () => {
  const loginForm = read("app/login/login-form.tsx");
  const forgotPage = read("app/(app)/forgot-password/page.tsx");
  const forgotForm = read("app/forgot-password/forgot-password-form.tsx");

  assert.match(loginForm, /Forgot password\?/);
  assert.match(
    loginForm,
    /href=\{`\/forgot-password\?next=\$\{encodeURIComponent\(nextPath\)\}`\}/,
  );
  assert.match(forgotPage, /sanitizeAuthReturnPath\(next\)/);
  assert.match(forgotForm, /fetch\("\/api\/auth\/forgot-password"/);
  assert.match(forgotForm, /Back to login/);
});

test("login shows account recovery help only after an auth failure", () => {
  const loginPage = read("app/(app)/login/page.tsx");
  const loginForm = read("app/login/login-form.tsx");

  assert.match(loginForm, /Lost access or recovery code\?/);
  assert.match(
    loginForm,
    /href=\{`\/account-recovery\?next=\$\{encodeURIComponent\(nextPath\)\}`\}/,
  );
  assert.match(loginPage, /showRecoveryHelpInitially=\{Boolean\(error\)\}/);
  assert.match(loginForm, /showRecoveryHelpInitially = false/);
  assert.match(loginForm, /const \[showRecoveryHelp, setShowRecoveryHelp\]/);
  assert.match(loginForm, /setShowRecoveryHelp\(true\)/);
  assert.match(loginForm, /setShowRecoveryHelp\(false\)/);
  assert.match(loginForm, /\{showRecoveryHelp \? \(/);
});

test("forgot password API sends a non-enumerating reset email", () => {
  const route = read("app/(app)/api/auth/forgot-password/route.ts");

  assert.match(route, /resetPasswordForEmail\(email,\s*\{/);
  assert.match(route, /redirectTo: resetPasswordRedirectUrl\(request, nextPath\)/);
  assert.match(route, /new URL\("\/reset-password", url\.origin\)/);
  assert.match(route, /sanitizeAuthReturnPath\(readString\(formData, "next"\)\)/);
  assert.match(route, /If a ReyLUMI account exists for this email/);
});

test("reset password page consumes recovery tokens and updates the user password", () => {
  const resetPage = read("app/(app)/reset-password/page.tsx");
  const resetForm = read("app/reset-password/reset-password-form.tsx");

  assert.match(resetPage, /sanitizeAuthReturnPath\(next\)/);
  assert.match(resetForm, /window\.location\.hash/);
  assert.match(resetForm, /params\.get\("type"\)/);
  assert.match(resetForm, /params\.get\("access_token"\)/);
  assert.match(resetForm, /params\.get\("refresh_token"\)/);
  assert.match(resetForm, /supabase\.auth\.setSession\(\{/);
  assert.match(resetForm, /supabase\.auth\.updateUser\(\{\s*password: newPassword,\s*\}\)/);
  assert.match(resetForm, /Password updated\. Please log in with your new password\./);
});

test("forgot and reset password routes are treated as auth surfaces", () => {
  const authRouting = read("lib/auth-routing.ts");
  const navigationShell = read("app/navigation-shell.tsx");

  assert.match(authRouting, /"\/account-recovery"/);
  assert.match(authRouting, /"\/forgot-password"/);
  assert.match(authRouting, /"\/reset-password"/);
  assert.match(navigationShell, /pathname === "\/account-recovery"/);
  assert.match(navigationShell, /pathname === "\/forgot-password"/);
  assert.match(navigationShell, /pathname === "\/reset-password"/);
});
