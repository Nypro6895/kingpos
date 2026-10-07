import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('earnings writer uses the salon timezone and fails instead of using operator timezone', async () => {
  const source = readFileSync('lib/pos-ticket-staff-earnings.ts', 'utf8') + '\nexport { requireEarningContext };';
  const context = { user: { timezone: 'Pacific/Auckland' }, currentSalon: { id: 'salon' } };
  const supabase = { rpc: async (name, params) => {
    assert.equal(name, 'get_salon_business_timezone');
    assert.deepEqual(params, { p_salon_id: 'salon' });
    return { data: 'America/Chicago', error: null };
  } };
  const mocks = { 'server-only': {}, '@/lib/current-context': { getCurrentBusinessContext: async () => context },
    '@/lib/permissions': { hasPermission: async () => true }, '@/lib/pos-desk': { POS_DESK_DEFAULTS: {} },
    '@/lib/pos-desk-amounts': {}, '@/lib/pos-ticket-calculations': {},
    '@/lib/pos-tickets': { POS_TICKET_PERMISSIONS: {} },
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => supabase } };
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(name => {
    assert.ok(name in mocks, name); return mocks[name];
  }, exports);
  assert.equal((await exports.requireEarningContext()).timeZone, 'America/Chicago');
  supabase.rpc = async () => ({ data: null, error: { message: 'unavailable' } });
  await assert.rejects(exports.requireEarningContext(), /timezone could not be loaded/);
});

test('Staff Daily maps a single salon snapshot and excludes cancelled/voided earnings', async () => {
  const ticket = (id, status = 'closed') => ({ id, status, opened_at: '2026-09-24T12:00Z', customer: null });
  const earning = (id, status) => ({ ticket_id: id, staff_id: 'staff', ticket: ticket(id, status), service_total: '50', tip_amount: '10', total_earning: '60', big_turn_count: 1, small_turn_count: 0 });
  const source = readFileSync('lib/staff-workdays.ts', 'utf8');
  const module = { exports: {} };
  const calls = [];
  const snapshot = { staff_id: 'staff', date: '2026-09-24', earnings: [earning('paid'), earning('void', 'voided'), earning('cancel', 'cancelled')], items: [
    { id: 'line', pos_ticket_id: 'paid', ticket: ticket('paid'), service: { name: 'Service' }, line_total: '50', quantity: 1, unit_price: '50' },
    { id: 'pending', pos_ticket_id: 'open', ticket: ticket('open', 'open'), service: { name: 'Custom' }, line_total: '25', quantity: 1, unit_price: '25' },
  ] };
  const supabase = { rpc: async (...args) => { calls.push(args); return { data: snapshot, error: null }; } };
  const mocks = {
    '@/lib/salon-business-clock': { getContextBusinessDate: async () => '2026-09-24' },
    'server-only': {}, '@/lib/current-context': {},
    '@/lib/staff-account': { resolveStaffAccountForSalon: async () => ({ status: 'found', staff: { id: 'staff' } }) },
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => supabase },
    '@/lib/supabase/postgrest-errors': {},
    '@/lib/staff-portal-identity': { getStaffPortalIdentity: async () => ({ context, staff: { id: 'staff' }, supabase }) },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'exports', compiled)(name => {
    assert.ok(name in mocks, `unexpected dependency ${name}`); return mocks[name];
  }, module.exports);
  const context = { user: { id: 'user', timezone: 'Pacific/Auckland' }, currentAccount: { id: 'account' }, currentSalon: { id: 'salon' } };
  const result = await module.exports.getCurrentStaffAssignedWork(context);
  assert.deepEqual(calls, [['get_my_staff_daily_snapshot', { p_salon_id: 'salon' }]]);
  assert.equal(result.today, '2026-09-24');
  assert.equal(result.excludedTicketCount, 2);
  assert.equal(result.workTickets.length, 2);
  const paid = result.workTickets.find(x => x.id === 'paid');
  assert.deepEqual([paid.serviceTotal, paid.tipAmount, paid.totalEarning, paid.totalTurns], [50, 10, 60, 1]);
  assert.equal(result.workTickets.find(x => x.id === 'open').hasEarning, false);
  const sharedIdentityResult = await module.exports.getCurrentStaffAssignedWork();
  assert.deepEqual(sharedIdentityResult.workTickets, result.workTickets);
  snapshot.staff_id = 'someone-else';
  await assert.rejects(module.exports.getCurrentStaffAssignedWork(context), /could not be verified/);
  supabase.rpc = async () => ({ data: null, error: { message: 'RPC unavailable' } });
  await assert.rejects(module.exports.getCurrentStaffAssignedWork(context), /RPC unavailable/);
});
