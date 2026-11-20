import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function evaluate(source, bindings = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', 'require', ...Object.keys(bindings), output)(module, module.exports, name => {
    if (name === 'server-only') return {};
    if (name === '@/lib/pos-ticket-adjustment-history') return pure;
    throw new Error('Unexpected fixture import: ' + name);
  }, ...Object.values(bindings));
  return module.exports;
}
const pure = evaluate(readFileSync('lib/pos-ticket-adjustment-history.ts', 'utf8'));
const { loadVisibleTicketAdjustments } = evaluate(readFileSync('lib/pos-ticket-adjustment-history-server.ts', 'utf8'));
// Run the actual loader bodies, keeping their query and mapping behavior. Their
// unrelated route/auth imports are outside this focused read-consumer fixture.
function actualFunction(path, name, bindings) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return evaluate('export ' + declaration.getText(source), bindings)[name];
}
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const rows = ['draft', 'created', 'updated', 'updated'].map((event_action, i) => ({ id: uuid(i + 1), ticket_id: uuid(50), action: 'item_corrected', reason: i < 2 ? 'Initial entry' : 'Correct real receipt', before_snapshot: { ticket: { status: i < 2 ? 'open' : 'closed' } }, after_snapshot: { ticket: { status: 'closed' } }, created_at: '2026-10-30T12:00:00Z', created_by: uuid(90), fixtureAction: event_action }));
function clientFor(input = rows) {
  const calls = [], tables = { pos_ticket_adjustments: input, pos_tickets: [{ id: uuid(50), ticket_number: '104', opened_at: '2026-10-29T12:00:00Z' }], users: [{ id: uuid(90), display_name: 'Salon Owner', email: null }] };
  return { calls, async rpc(name, args) { calls.push({ rpc: name, args }); return { data: args.p_adjustment_ids.map(id => ({ adjustment_id: id, event_action: input.find(row => row.id === id)?.fixtureAction ?? 'updated' })), error: null }; }, from(table) { calls.push({ table }); const query = { select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; }, gte() { return query; }, lte() { return query; }, async returns() { return { data: tables[table] ?? [], error: null }; } }; return query; } };
}

test('shared read helper batches every requested correction, deduplicates IDs and preserves original immutable snapshots', async () => {
  const originals = Array.from({ length: 1001 }, (_, i) => ({ id: uuid(i + 100), before_snapshot: { captured: i }, fixtureAction: i % 3 === 0 ? 'draft' : i % 3 === 1 ? 'created' : 'updated' }));
  const frozen = JSON.stringify(originals), client = clientFor(originals);
  const visible = await loadVisibleTicketAdjustments(client, [...originals, originals[2]]);
  assert.deepEqual(client.calls.map(call => call.args.p_adjustment_ids.length), [500, 500, 1]);
  assert.ok(client.calls.every(call => call.rpc === 'get_pos_ticket_adjustment_metadata'));
  assert.equal(visible.length, 334); assert.ok(visible.every(row => row.event_action === 'updated'));
  assert.equal(JSON.stringify(originals), frozen); assert.equal(visible[0].before_snapshot, originals[2].before_snapshot);
});

test('missing, malformed or unauthorized classification fails safely instead of labeling initial entry as a correction', async () => {
  for (const response of [{ data: [], error: null }, { data: [{ adjustment_id: rows[0].id, event_action: 'unknown' }], error: null }, { data: null, error: { message: 'Denied' } }]) {
    await assert.rejects(loadVisibleTicketAdjustments({ rpc: async () => response }, [rows[0]]), /Ticket correction history/);
  }
  let called = false; assert.deepEqual(await loadVisibleTicketAdjustments({ rpc() { called = true; } }, []), []); assert.equal(called, false);
});

test('Owner ticket loader suppresses proven initial records before attaching actors, retaining real and sparse legacy corrections', async () => {
  const load = actualFunction('lib/pos-tickets.ts', 'loadAdjustmentsForTickets', { loadVisibleTicketAdjustments, normalizeUuid: value => value || null });
  const client = clientFor(); const byTicket = await load({ accountId: uuid(70), salonId: uuid(80), supabase: client, ticketIds: [uuid(50)] });
  assert.deepEqual(byTicket.get(uuid(50)).map(row => row.id), [rows[2].id, rows[3].id]);
  assert.ok(byTicket.get(uuid(50)).every(row => row.created_by_user.display_name === 'Salon Owner' && row.event_action === 'updated'));
  assert.equal(client.calls.filter(call => call.rpc).length, 1);
});

test('Payroll legacy correction loader applies the same lifecycle boundary without manufacturing a money delta', async () => {
  const load = actualFunction('lib/payroll.ts', 'loadTicketAdjustmentsForPeriod', {
    loadVisibleTicketAdjustments,
    getSalonBusinessTimezone: async () => 'UTC',
    getUtcBoundsForLocalDate: date => ({ openedFrom: date + 'T00:00:00Z', openedTo: date + 'T23:59:59Z' }),
    loadPayrollUserLabels: async () => new Map([[uuid(90), 'Salon Owner']]),
    summarizeCorrectionValue: value => JSON.stringify(value), serializeCorrectionValue: value => JSON.stringify(value),
  });
  const client = clientFor(); const visible = await load({ salon: { id: uuid(80) }, supabase: client }, { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.deepEqual(visible.map(row => row.id), [rows[2].id, rows[3].id]);
  assert.ok(visible.every(row => row.delta === null && row.source === 'ticket_adjustment' && row.ticketNumber === '104' && row.changedByName === 'Salon Owner'));
  assert.equal(client.calls.filter(call => call.rpc).length, 1);
});
