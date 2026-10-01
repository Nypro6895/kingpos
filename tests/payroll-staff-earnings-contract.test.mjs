import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portablePayrollMigration = readFileSync(
  "supabase/migrations/202608160001_portable_receipt_staff_earnings.sql",
  "utf8",
);
const staffEarningsService = readFileSync(
  "lib/pos-ticket-staff-earnings.ts",
  "utf8",
);
const posTicketActions = readFileSync("app/pos-tickets/actions.ts", "utf8");

function functionBlock(source, name, nextMarker) {
  const start = source.indexOf(`create or replace function public.${name}`);

  assert.ok(start >= 0, `${name} function is present`);

  const end = nextMarker ? source.indexOf(nextMarker, start + 1) : -1;

  assert.ok(end > start, `${name} function has a readable boundary`);

  return source.slice(start, end);
}

test("Portable POS receipt submission populates Payroll staff earnings source rows", () => {
  const submitBlock = functionBlock(
    portablePayrollMigration,
    "submit_pos_portable_receipt",
    "grant execute on function public.submit_pos_portable_receipt",
  );
  const paymentIndex = submitBlock.indexOf("insert into public.pos_payments");
  const earningsIndex = submitBlock.indexOf(
    "perform public.insert_missing_pos_ticket_staff_earnings_for_ticket(ticket_row.id)",
  );
  const auditIndex = submitBlock.indexOf("insert into public.pos_ticket_audit_logs");

  assert.ok(paymentIndex >= 0, "Portable POS still records payment rows");
  assert.ok(earningsIndex > paymentIndex, "Payroll source rows are created after payment");
  assert.ok(auditIndex > earningsIndex, "Payroll source rows are created before success audit");
});

test("staff earning insert helper only derives missing closed-ticket rows", () => {
  const helperBlock = functionBlock(
    portablePayrollMigration,
    "insert_missing_pos_ticket_staff_earnings_for_ticket",
    "revoke all on function public.insert_missing_pos_ticket_staff_earnings_for_ticket",
  );

  assert.match(helperBlock, /tickets\.status = 'closed'/);
  assert.match(helperBlock, /coalesce\(items\.is_removed, false\) = false/);
  assert.match(helperBlock, /on conflict \(ticket_id, staff_id\) do nothing/);
  assert.match(helperBlock, /round\(final_rows\.service_cents::numeric \/ 100, 2\)/);
  assert.match(helperBlock, /round\(final_rows\.final_tip_cents::numeric \/ 100, 2\)/);
});

test("authenticated staff earning recalculation excludes open tickets", () => {
  const loadTicketsBlock = staffEarningsService.match(
    /async function loadTicketsForDate[\s\S]*?return tickets\.map/,
  )?.[0];

  assert.ok(loadTicketsBlock, "loadTicketsForDate is present");
  assert.match(loadTicketsBlock, /\.from\("pos_tickets"\)/);
  assert.match(loadTicketsBlock, /\.eq\("status", "closed"\)/);
});

test("manual POS ticket checkout recalculates Payroll source rows", () => {
  const closeBlock = posTicketActions.match(
    /export async function closePosTicket[\s\S]*?export async function cancelPosTicket/,
  )?.[0];

  assert.ok(closeBlock, "closePosTicket action is present");
  assert.match(closeBlock, /recalculateTicketStaffEarnings\(ticketId\)/);
  assert.match(closeBlock, /revalidatePath\("\/payroll"\)/);
});
