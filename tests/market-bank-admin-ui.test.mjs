import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({
  entryPoints: ['app/(app)/admin/market/billing-actions.ts'], bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': process.cwd() },
  plugins: [{ name: 'billing-action-fixtures', setup(builder) {
    builder.onResolve({ filter: /^(server-only|next\/navigation|next\/cache|@\/lib\/platform-admin\/auth|@\/lib\/supabase\/server)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path === 'server-only' ? '' :
      args.path === 'next/navigation' ? `export function notFound(){throw Error('Not found')}` :
      args.path === 'next/cache' ? `export function revalidatePath(path){globalThis.billingRevalidated.push(path)}` :
      args.path.includes('/auth') ? `export async function requirePlatformAdmin(permission){globalThis.billingPermission=permission;return{roleSlug:globalThis.billingRole??'platform_owner'}}` :
      `export async function createAuthenticatedSupabaseServerClient(){if(globalThis.billingNoSession)return null;return{async rpc(name,values){globalThis.billingCalls.push({name,values});return{data:{},error:globalThis.billingRpcError??null}}}}`,
    }));
  } }],
});
const actions = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const bankId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const refundId = '33333333-3333-4333-8333-333333333333';
const pastDate = () => `${new Date(Date.now() - 60_000).toISOString().slice(0, 16)}Z`;
function form(values) { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, String(value)); return result; }
function reset() { globalThis.billingCalls = []; globalThis.billingRevalidated = []; delete globalThis.billingRole; delete globalThis.billingRpcError; delete globalThis.billingNoSession; }
const settings = () => form({ version: '1', enabled: 'on', default_bank_account_id: bankId, order_expiry_hours: '48', tax: '8.25', fee: '2.50', fixed: '0.30', tax_label: 'Sales tax' });
const receipt = () => form({ order_id: orderId, bank_verified: 'on', bank_reference: 'BANK-IN-001', amount: '12.34', received_at: pastDate(), note: 'Matched settled bank credit and customer order reference.' });

test('every payment mutation requires a platform owner before validating or writing', async () => {
  for (const action of Object.values(actions)) {
    reset(); globalThis.billingRole = 'platform_admin';
    await assert.rejects(action(new FormData()), /Not found/);
    assert.equal(globalThis.billingPermission, 'admin.team.manage');
    assert.equal(globalThis.billingCalls.length, 0);
  }
  reset();
});

test('effective settings convert decimals exactly and pass an optimistic version', async () => {
  reset(); const result = await actions.saveMarketBillingSettings(settings());
  assert.equal(result.ok, true);
  assert.deepEqual(globalThis.billingCalls[0], { name: 'market_billing_save_settings', values: { p_version: 1, p_settings: {
    enabled: true, default_bank_account_id: bankId, order_expiry_hours: 48, tax_bps: 825, fee_bps: 250, fixed_fee_cents: 30, tax_label: 'Sales tax',
  } } });
  assert.ok(globalThis.billingRevalidated.includes('/admin/market'));
  assert.ok(globalThis.billingRevalidated.includes('/market'));
  assert.match(result.message, /existing orders keep their original price/i);
});

test('invalid rates, deadlines and account identifiers never reach payment storage', async () => {
  for (const [key, value] of [['tax', '100.01'], ['fee', '-1'], ['fixed', '1e2'], ['order_expiry_hours', '0'], ['default_bank_account_id', 'not-a-bank']]) {
    reset(); const input = settings(); input.set(key, value);
    assert.equal((await actions.saveMarketBillingSettings(input)).ok, false);
    assert.equal(globalThis.billingCalls.length, 0);
  }
});

test('receipt requires verified settled funds, exact cents, a real date and a note', async () => {
  reset(); let input = receipt(); input.delete('bank_verified');
  assert.equal((await actions.recordMarketBankReceipt(input)).ok, false);
  assert.equal(globalThis.billingCalls.length, 0);
  for (const [key, value] of [['amount', '0'], ['amount', '0.001'], ['amount', '1000000.01'], ['order_id', 'wrong'], ['received_at', '2026-02-30T12:00Z'], ['note', '']]) {
    reset(); input = receipt(); input.set(key, value);
    assert.equal((await actions.recordMarketBankReceipt(input)).ok, false);
    assert.equal(globalThis.billingCalls.length, 0);
  }
  reset(); const result = await actions.recordMarketBankReceipt(receipt());
  assert.equal(result.ok, true);
  assert.equal(globalThis.billingCalls[0].name, 'market_billing_record_receipt');
  assert.equal(globalThis.billingCalls[0].values.p_amount_cents, 1234);
  assert.equal(globalThis.billingCalls[0].values.p_order, orderId);
  assert.equal(globalThis.billingCalls[0].values.p_actor, undefined);
});

test('refund request reserves funds and completing it requires a confirmed outgoing transfer', async () => {
  reset(); const requested = await actions.requestMarketBillingRefund(form({ order_id: orderId, amount: '2.50', reason: 'Return overpayment' }));
  assert.equal(requested.ok, true);
  assert.equal(globalThis.billingCalls[0].values.p_amount_cents, 250);
  assert.match(requested.message, /complete the bank transfer/i);
  reset(); const refund = form({ refund_id: refundId, bank_reference: 'BANK-OUT-001', note: 'Confirmed customer refund' });
  assert.equal((await actions.completeMarketBillingRefund(refund)).ok, false);
  assert.equal(globalThis.billingCalls.length, 0);
  refund.set('bank_verified', 'on');
  assert.equal((await actions.completeMarketBillingRefund(refund)).ok, true);
  assert.equal(globalThis.billingCalls[0].name, 'market_billing_complete_refund');
});

test('cancelling an erroneous pending refund requires a reason and no completed bank transfer', async () => {
  reset(); const cancellation = form({ refund_id: refundId, reason: 'Incorrect duplicate refund request' });
  assert.equal((await actions.cancelMarketBillingRefund(cancellation)).ok, false);
  assert.equal(globalThis.billingCalls.length, 0);
  cancellation.set('no_bank_transfer', 'on'); cancellation.set('reason', 'x');
  assert.equal((await actions.cancelMarketBillingRefund(cancellation)).ok, false);
  assert.equal(globalThis.billingCalls.length, 0);
  cancellation.set('reason', 'Incorrect duplicate refund request');
  const result = await actions.cancelMarketBillingRefund(cancellation);
  assert.equal(result.ok, true);
  assert.deepEqual(globalThis.billingCalls[0], { name: 'market_billing_cancel_refund', values: { p_refund: refundId, p_reason: 'Incorrect duplicate refund request' } });
  assert.match(result.message, /no cash movement/i);
});

test('bank accounts preserve identifiers and leading zeros', async () => {
  reset(); const result = await actions.saveMarketBankAccount(form({ bank_id: '', version: '', label: 'Primary USD', bank_name: 'Example bank', beneficiary: 'Reylumi', account_number: '001234567', routing: '00001', instructions: 'Use the order reference.', active: 'on' }));
  assert.equal(result.ok, true);
  assert.equal(globalThis.billingCalls[0].values.p_version, null);
  assert.equal(globalThis.billingCalls[0].values.p_bank.account_number, '001234567');
  assert.equal(globalThis.billingCalls[0].values.p_bank.routing, '00001');
});

test('external plugin configuration is created with paid fulfillment unavailable', async () => {
  reset(); const result = await actions.saveMarketBillingCatalog(form({ plugin_id: 'partner-example', version: '', name: 'Partner example', publisher: 'Example partner', price: '9.99', commission: '20', fulfillment_ready: 'on' }));
  assert.equal(result.ok, true);
  assert.equal(globalThis.billingCalls[0].values.p_version, null);
  assert.equal(globalThis.billingCalls[0].values.p_values.fulfillment_ready, false);
  assert.equal(globalThis.billingCalls[0].values.p_values.price_cents, 999);
  assert.equal(globalThis.billingCalls[0].values.p_values.commission_bps, 2000);
  reset(); const free = form({ plugin_id: 'booking-deposit', version: '1', price: '0', commission: '0' });
  assert.equal((await actions.saveMarketBillingCatalog(free)).ok, false);
  assert.equal(globalThis.billingCalls.length, 0);
});

test('business expenses require verified outgoing money without spoofing a customer refund', async () => {
  reset(); const expense = form({ bank_id: bankId, bank_reference: 'BANK-EXPENSE-001', amount: '0.29', received_at: pastDate(), note: 'Bank transaction charge', bank_verified: 'on' });
  assert.equal((await actions.recordMarketBankExpense(expense)).ok, true);
  assert.equal(globalThis.billingCalls[0].name, 'market_billing_record_expense');
  assert.equal(globalThis.billingCalls[0].values.p_amount_cents, 29);
  assert.equal(globalThis.billingCalls[0].values.p_order, undefined);
});

test('conflicts and duplicates return useful messages without leaking storage details', async () => {
  reset(); globalThis.billingRpcError = { code: '40001', message: 'raw schema settings version detail' };
  const conflict = await actions.saveMarketBillingSettings(settings());
  assert.equal(conflict.ok, false); assert.match(conflict.message, /another admin changed/i); assert.doesNotMatch(conflict.message, /schema/);
  reset(); globalThis.billingRpcError = { code: '23505', message: 'raw bank_reference constraint detail' };
  const duplicate = await actions.recordMarketBankReceipt(receipt());
  assert.equal(duplicate.ok, false); assert.match(duplicate.message, /already been recorded/i);
  reset(); globalThis.billingNoSession = true;
  assert.match((await actions.saveMarketBillingSettings(settings())).message, /sign in again/i);
  assert.equal(globalThis.billingCalls.length, 0);
});
