import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202607250005_staff_check_in_and_turn_adjustment.sql",
  "utf8",
);
const posActions = readFileSync("app/pos/actions.ts", "utf8");
const posDeskClient = readFileSync("app/pos/pos-desk-client.tsx", "utf8");
const posSettingsActions = readFileSync("app/pos/settings/actions.ts", "utf8");
const posSettingsPage = readFileSync("app/pos/settings/page.tsx", "utf8");
const portableActions = readFileSync("app/pos/portable/actions.ts", "utf8");
const portableCapabilities = readFileSync(
  "lib/pos-portable-capabilities.ts",
  "utf8",
);
const staffService = readFileSync("lib/staff.ts", "utf8");

function functionBlock(name, nextMarker) {
  const start = migration.indexOf(`create or replace function public.${name}`);

  assert.ok(start >= 0, `${name} function is present`);

  const end = nextMarker ? migration.indexOf(nextMarker, start + 1) : -1;

  assert.ok(end > start, `${name} function has a readable boundary`);

  return migration.slice(start, end);
}

test("staff check-in migration creates the operational queue and audit surface", () => {
  assert.match(migration, /staff_check_in_enabled boolean not null default false/);
  assert.match(migration, /queue_turn_count integer not null default 0/);
  assert.match(migration, /create table if not exists public\.staff_attendance_events/);
  assert.match(migration, /create table if not exists public\.staff_passcode_attempts/);
  assert.match(migration, /'MANUAL_TURN_ADJUSTMENT'/);
  assert.match(migration, /'AUTOMATIC_TURN_CATCH_UP'/);
  assert.match(migration, /create trigger set_staff_default_passcode/);
  assert.match(migration, /create or replace function public\.validate_staff_passcode_or_raise/);
  assert.match(migration, /next_failed_count >= 5 then now\(\) \+ interval '5 minutes'/);
});

test("manual turn adjustment only changes staff_workdays queue counts", () => {
  const adjustBlock = functionBlock(
    "adjust_pos_portable_staff_turn",
    "alter table public.pos_portable_access_keys",
  );

  assert.match(adjustBlock, /update public\.staff_workdays/);
  assert.match(adjustBlock, /set queue_turn_count = new_turn/);
  assert.match(adjustBlock, /old_turn \+ p_delta/);
  assert.match(adjustBlock, /greatest\(0, old_turn \+ p_delta\)/);
  assert.doesNotMatch(adjustBlock, /set[\s\S]*check_in_sequence/);
  assert.doesNotMatch(adjustBlock, /set[\s\S]*status =/);
  assert.doesNotMatch(adjustBlock, /pos_ticket_item_turn_parts/);
  assert.doesNotMatch(adjustBlock, /pos_ticket_items/);
  assert.doesNotMatch(adjustBlock, /pos_tickets/);
  assert.match(adjustBlock, /'MANUAL_TURN_ADJUSTMENT'/);
  assert.match(adjustBlock, /p_operator_staff_id/);
  assert.match(adjustBlock, /record_staff_attendance_event\([\s\S]*p_key_id/);
});

test("receipt submit preserves turn facts and increments the queue counter", () => {
  const portableReceiptBlock = functionBlock(
    "submit_pos_portable_receipt",
    "create or replace function public.get_pos_setting_payload",
  );

  assert.match(portableReceiptBlock, /insert into public\.pos_ticket_item_turn_parts/);
  assert.match(portableReceiptBlock, /public\.increment_staff_queue_turns/);
  assert.match(posActions, /"increment_staff_queue_turns"/);
});

test("portable access exposes check-in by default but keeps turn adjustment gated", () => {
  assert.match(portableCapabilities, /checkInUse: "portable\.checkin\.use"/);
  assert.match(portableCapabilities, /turnAdjust: "portable\.turn\.adjust"/);
  assert.match(portableCapabilities, /PORTABLE_POS_CAPABILITIES\.checkInUse/);
  assert.doesNotMatch(
    portableCapabilities.match(/DEFAULT_PORTABLE_POS_CAPABILITIES[\s\S]*?\] as const/)?.[0] ?? "",
    /PORTABLE_POS_CAPABILITIES\.turnAdjust/,
  );
});

test("portable check-in migration updates capability constraint before backfill", () => {
  const constraintIndex = migration.indexOf(
    "add constraint pos_portable_access_keys_capabilities_valid",
  );
  const defaultIndex = migration.indexOf("alter column capabilities set default");
  const backfillIndex = migration.indexOf(
    "where not ('portable.checkin.use' = any(coalesce(capabilities, '{}'::text[])))",
  );
  const constraintBlock =
    migration.match(
      /add constraint pos_portable_access_keys_capabilities_valid[\s\S]*?\);\n\nalter table public\.pos_portable_access_keys\nalter column capabilities set default/,
    )?.[0] ?? "";
  const defaultBlock =
    migration.match(
      /alter column capabilities set default array\[[\s\S]*?\]::text\[\];/,
    )?.[0] ?? "";
  const backfillBlock =
    migration.match(
      /update public\.pos_portable_access_keys[\s\S]*?where not \('portable\.checkin\.use' = any\(coalesce\(capabilities, '\{\}'::text\[\]\)\)\);/,
    )?.[0] ?? "";

  assert.ok(constraintIndex >= 0, "capability constraint is recreated");
  assert.ok(defaultIndex > constraintIndex, "default is updated after constraint");
  assert.ok(backfillIndex > defaultIndex, "check-in backfill runs after constraint");

  for (const capability of [
    "portable.pos.use",
    "portable.today.view",
    "portable.checkin.use",
    "portable.turn.adjust",
    "portable.book.view",
    "portable.book.create",
    "portable.book.cancel",
    "portable.report.view",
  ]) {
    assert.match(constraintBlock, new RegExp(capability.replaceAll(".", "\\.")));
  }

  assert.match(defaultBlock, /portable\.checkin\.use/);
  assert.match(defaultBlock, /portable\.report\.view/);
  assert.doesNotMatch(defaultBlock, /portable\.turn\.adjust/);
  assert.match(backfillBlock, /coalesce\(capabilities, '\{\}'::text\[\]\)/);
  assert.match(backfillBlock, /select distinct capability/);
  assert.match(backfillBlock, /where capability is not null/);
});

test("portable access capability constraint remains a strict allow-list", () => {
  const constraintBlock =
    migration.match(
      /add constraint pos_portable_access_keys_capabilities_valid[\s\S]*?\);/,
    )?.[0] ?? "";

  assert.match(constraintBlock, /coalesce\(capabilities, '\{\}'::text\[\]\) <@ array\[/);
  assert.doesNotMatch(constraintBlock, /portable\.invalid\.test/);
  assert.doesNotMatch(constraintBlock, /jsonb_typeof|array_length|cardinality/);
});

test("standard POS rejects non-working staff when check-in is enabled", () => {
  assert.match(posActions, /async function validateWorkingStaffIds/);
  assert.match(posActions, /Assigned staff must be checked in and working/);
  assert.match(posActions, /requireWorkingStaff: settings\.staffCheckInEnabled/);
  assert.match(posActions, /if \(settings\.staffCheckInEnabled\)/);
});

test("POS settings exposes a dedicated staff check-in save path", () => {
  assert.match(posSettingsPage, /Save staff check-in/);
  assert.match(posSettingsPage, /name="staff_check_in_enabled"/);
  assert.match(
    posSettingsActions,
    /settingsPayload\.staff_check_in_enabled[\s\S]*Staff check-in cannot be enabled until the staff check-in database migration is applied/,
  );
});

test("staff passcodes are hashed and raw passcodes are not returned by staff service selects", () => {
  assert.match(migration, /new\.salon_id::text \|\| ':' \|\| new\.id::text \|\| ':1234:' \|\| new\.passcode_salt/);
  assert.match(migration, /passcode_is_default boolean not null default true/);
  assert.match(staffService, /passcode_is_default/);
  assert.doesNotMatch(
    staffService.match(/export const STAFF_SELECT =\s*"[^"]+"/)?.[0] ?? "",
    /passcode_(digest|salt)/,
  );
});

test("late check-in and same-day re-check-in use the requested queue formula", () => {
  const attendanceBlock = functionBlock(
    "submit_pos_portable_attendance_event",
    "create or replace function public.adjust_pos_portable_staff_turn",
  );

  assert.match(attendanceBlock, /when working_count = 0 then 0/);
  assert.match(attendanceBlock, /when all_same then greatest\(current_min_turn - 1, 0\)/);
  assert.match(attendanceBlock, /else current_min_turn/);
  assert.match(attendanceBlock, /check_in_sequence = next_sequence/);
  assert.match(attendanceBlock, /queue_turn_count = greatest\(queue_turn_count, late_start_turn\)/);
  assert.match(attendanceBlock, /Same-day late re-check-in/);
});

test("leave and return catch-up is based on the leave cohort, not the current global minimum", () => {
  const attendanceBlock = functionBlock(
    "submit_pos_portable_attendance_event",
    "create or replace function public.adjust_pos_portable_staff_turn",
  );

  assert.match(attendanceBlock, /leave_cohort_staff_ids = coalesce\(cohort, '\{\}'::uuid\[\]\)/);
  assert.match(attendanceBlock, /staff_id = any\(coalesce\(workday_row\.leave_cohort_staff_ids, '\{\}'::uuid\[\]\)\)/);
  assert.match(attendanceBlock, /catch_up_turn := greatest\(/);
  assert.match(attendanceBlock, /old_turn,\s+coalesce\(current_min_turn, workday_row\.leave_baseline_turn_count, old_turn\)/);
  assert.match(attendanceBlock, /'AUTOMATIC_TURN_CATCH_UP'/);
});

test("portable check-in and POS mutations broadcast staff invalidations after commits", () => {
  assert.match(portableActions, /broadcastPosStaffChange\(portableSession\.salon_id, "attendance"\)/);
  assert.match(portableActions, /broadcastPosStaffChange\(portableSession\.salon_id, "turn_adjust"\)/);
  assert.match(portableActions, /broadcastPosStaffChange\(portableSession\.salon_id, "pos"\)/);
  assert.match(posDeskClient, /POS_STAFF_BROADCAST_EVENT/);
  assert.match(posDeskClient, /router\.refresh\(\)/);
});

test("portable POS staff-card long press has cancellation and keyboard contracts", () => {
  assert.match(posDeskClient, /const STAFF_TURN_HOLD_MS = 3000/);
  assert.match(posDeskClient, /const STAFF_TURN_HOLD_MOVE_CANCEL_PX = 10/);
  assert.match(posDeskClient, /setPointerCapture\(event\.pointerId\)/);
  assert.match(posDeskClient, /releasePointerCapture\(hold\.pointerId\)/);
  assert.match(posDeskClient, /onPointerCancel=\{handleStaffPointerEnd\}/);
  assert.match(posDeskClient, /useEffect\(\(\) => clearStaffTurnHold, \[clearStaffTurnHold, pathname\]\)/);
  assert.match(posDeskClient, /window\.addEventListener\("blur", clearStaffTurnHold\)/);
  assert.match(posDeskClient, /event\.key === "ContextMenu"/);
  assert.match(posDeskClient, /event\.key === "Enter" && event\.shiftKey/);
  assert.match(posDeskClient, /suppressNextStaffClickRef\.current = true/);
});
