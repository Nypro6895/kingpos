import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const portableTicketPage = readFileSync(
  "app/pos/portable/ticket/page.tsx",
  "utf8",
);
const portableActions = readFileSync("app/pos/portable/actions.ts", "utf8");
const ownerTicketActions = readFileSync("app/pos-tickets/actions.ts", "utf8");
const correctionForm = readFileSync(
  "app/pos-tickets/closed-ticket-correction-form.tsx",
  "utf8",
);
const portableTicketEditMigration = readFileSync(
  "supabase/migrations/202608190004_portable_ticket_edit.sql",
  "utf8",
);
const portableTicketOptionalServiceMigration = readFileSync(
  "supabase/migrations/202608190006_portable_ticket_edit_optional_service.sql",
  "utf8",
);

test("portable ticket page reuses the owner closed-ticket edit card", () => {
  assert.match(portableTicketPage, /DailyPosTicketCard/);
  assert.match(portableTicketPage, /correctPortableClosedPosTicketInline/);
  assert.match(portableTicketPage, /function resolvePortableTicketServiceId/);
  assert.match(portableTicketPage, /toEditableTicket\(ticket,\s*services\)/);
  assert.match(portableTicketPage, /requireServiceForActiveLines=\{false\}/);
  assert.match(
    portableTicketPage,
    /actions=\{\{\s*correctClosedTicket:\s*correctPortableClosedPosTicketInline,\s*\}\}/s,
  );
  assert.match(portableTicketPage, /canEdit=\{canEdit && !isBusinessDateLocked\}/);
  assert.match(portableTicketPage, /returnTo=\{returnTo\}/);
});

test("closed-ticket edit card accepts injected correction actions", () => {
  assert.match(correctionForm, /export type TicketCorrectionFormActions/);
  assert.match(correctionForm, /actions\?: TicketCorrectionFormActions/);
  assert.match(correctionForm, /OWNER_TICKET_CORRECTION_ACTIONS/);
  assert.match(correctionForm, /formAction=\{correctClosedTicketAction\}/);
  assert.match(
    correctionForm,
    /submitLockedStaffFinancialCorrectionAction=\{lockedCorrectionAction\}/,
  );
  assert.match(correctionForm, /requireServiceForActiveLines = true/);
});

test("portable correction action uses portable auth capabilities and RPC mutation", () => {
  assert.match(portableActions, /export async function correctPortableClosedPosTicketInline/);
  assert.match(portableActions, /PORTABLE_POS_CAPABILITIES\.posUse/);
  assert.match(portableActions, /PORTABLE_POS_CAPABILITIES\.todayView/);
  assert.match(portableActions, /correct_pos_portable_closed_ticket/);
  assert.match(portableActions, /revalidatePath\("\/pos\/portable\/ticket"\)/);
  assert.match(portableActions, /broadcastPosStaffChange\(portableSession\.salon_id, "pos"\)/);
});

test("portable ticket edit migration keeps mutation behind a locked-date RPC guard", () => {
  assert.match(
    portableTicketEditMigration,
    /create or replace function public\.correct_pos_portable_closed_ticket/,
  );
  assert.match(
    portableTicketEditMigration,
    /pos_portable_access_has_capability\(\s*p_key_id,\s*p_session_signature,\s*'portable\.pos\.use'\s*\)/,
  );
  assert.match(portableTicketEditMigration, /'portable\.today\.view'/);
  assert.match(
    portableTicketEditMigration,
    /closing_status in \('auto_locked', 'locked', 'approved', 'payroll_locked'\)/,
  );
  assert.match(portableTicketEditMigration, /isBusinessDateLocked/);
  assert.match(portableTicketEditMigration, /recalculate_pos_ticket_staff_earnings_for_date/);
});

test("portable ticket edit allows legacy portable lines without service ids", () => {
  assert.match(portableTicketOptionalServiceMigration, /pg_get_functiondef/);
  assert.match(
    portableTicketOptionalServiceMigration,
    /correct_pos_portable_closed_ticket\(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text\)/,
  );
  assert.match(portableTicketOptionalServiceMigration, /service_id uuid,/);
  assert.match(
    portableTicketOptionalServiceMigration,
    /where final_items\.staff_id is null/,
  );
  assert.match(
    portableTicketOptionalServiceMigration,
    /changed_services\.service_id is not null\s+and not exists/s,
  );
});

test("owner closed-ticket inline edits persist recalculated line_total values", () => {
  const inlineStart = ownerTicketActions.indexOf(
    "export async function correctClosedPosTicketInline",
  );

  assert.notEqual(inlineStart, -1);

  const inlineAction = ownerTicketActions.slice(inlineStart);
  const lineTotalWrites = inlineAction.match(/line_total: lineTotal/g) ?? [];

  assert.ok(
    lineTotalWrites.length >= 4,
    "replacement, update, unchanged refresh, and added branches should write line_total",
  );
});
