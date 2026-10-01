import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const quickAccesses = read("lib/today-quick-accesses.ts");
const quickAccessEditor = read("app/staff/today/quick-access-editor.tsx");
const quickAccessActions = read("app/staff/today/actions.ts");
const quickAccessMigration = read(
  "supabase/migrations/202608150001_today_quick_access_preferences.sql",
);
const quickAccessGrants = read(
  "supabase/migrations/202608150002_today_quick_access_preferences_grants.sql",
);

test("Quick Access table keeps RLS and grants only authenticated table privileges", () => {
  assert.match(quickAccessMigration, /enable row level security/);
  assert.match(
    quickAccessMigration,
    /constraint today_quick_access_preferences_unique unique \(user_id, salon_id\)/,
  );
  assert.match(quickAccessMigration, /user_id = public\.current_public_user_id\(\)/);
  assert.match(
    quickAccessMigration,
    /public\.user_has_salon_permission\(salon_id, array\['staff\.view'\]\)/,
  );
  assert.match(
    quickAccessGrants,
    /grant select, insert, update, delete\s+on table public\.today_quick_access_preferences\s+to authenticated;/,
  );
  assert.doesNotMatch(quickAccessGrants, /\bto anon\b/i);
});

test("Quick Access load uses stored order when present and defaults only without a row", () => {
  assert.match(quickAccesses, /readResult\.exists\s*\?\s*filterAuthorizedIds\(readResult\.ids, authorizedDefinitions\)\s*:\s*defaultSelectedIds\(authorizedDefinitions\)/);
  assert.match(quickAccesses, /selectedIds\s*=\s*readResult\.exists/);
  assert.match(quickAccesses, /defaultSelectedIds/);
  assert.match(quickAccesses, /filterAuthorizedIds/);
  assert.match(quickAccesses, /\.slice\(0, TODAY_QUICK_ACCESS_MAX_SELECTED\)/);
});

test("Quick Access save rejects invalid, duplicate, unauthorized, and oversized payloads", () => {
  assert.match(quickAccesses, /TODAY_QUICK_ACCESS_MAX_SELECTED = 8/);
  assert.match(quickAccesses, /Too many quick access shortcuts/);
  assert.match(quickAccesses, /That shortcut is not recognized/);
  assert.match(quickAccesses, /You do not have permission to save that shortcut/);
  assert.match(quickAccesses, /Duplicate shortcuts are not allowed/);
  assert.match(quickAccesses, /validateAuthorizedIds\(ids, authorizedDefinitions\)/);
  assert.doesNotMatch(quickAccessActions, /href|url|destination/i);
});

test("Quick Access persistence remains scoped by authenticated user and salon", () => {
  assert.match(quickAccesses, /\.eq\("salon_id", input\.salonId\)/);
  assert.match(quickAccesses, /\.eq\("user_id", input\.userId\)/);
  assert.match(quickAccesses, /user_id: identity\.userId/);
  assert.match(quickAccesses, /salon_id: identity\.salonId/);
  assert.match(quickAccesses, /onConflict: "user_id,salon_id"/);
  assert.match(quickAccessActions, /requireSalonManagePageContext\("\/staff\/today"\)/);
});

test("Quick Access diagnostics are safe and failure UX is non-blocking", () => {
  const loadLogBlock =
    quickAccesses.match(/console\.error\("Supabase load Today quick accesses failed"[\s\S]*?\}\);/)?.[0] ??
    "";
  const saveLogBlock =
    quickAccesses.match(/console\.error\("Supabase save Today quick accesses failed"[\s\S]*?\}\);/)?.[0] ??
    "";

  for (const block of [loadLogBlock, saveLogBlock]) {
    assert.match(block, /code: error\.code/);
    assert.match(block, /details: error\.details/);
    assert.match(block, /hint: error\.hint/);
    assert.match(block, /message: error\.message/);
    assert.match(block, /hasAuthenticatedUserContext/);
    assert.match(block, /hasSalonContext/);
    assert.match(block, /operation:/);
    assert.doesNotMatch(block, /\buserId:/);
    assert.doesNotMatch(block, /\bsalonId:/);
  }

  assert.match(quickAccesses, /error\.code === "42501"/);
  assert.match(quickAccessEditor, /configuration\.loadError/);
  assert.match(quickAccessEditor, /text-xs font-medium text-amber-700/);
  assert.doesNotMatch(
    quickAccessEditor,
    /configuration\.loadError[\s\S]{0,120}rounded-lg border border-amber/,
  );
});
