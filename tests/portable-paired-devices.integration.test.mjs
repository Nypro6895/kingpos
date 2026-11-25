import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { workstationFixture, credentialHash, fixtureId } from './helpers/portable-workstation-fixture.mjs';

const compiled = await build({ entryPoints: ['lib/portable-workstation-protocol.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const protocol = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const preview = (overrides = {}) => ({ cartId: 'fixture-cart', revision: 'fixture-revision-1', payload: { customer: null, selectedStaffId: null, staffLines: [], subtotal: 30, totalBeforeTip: 30, tax: 0, discount: 0, tip: 0, total: 30 }, ...overrides });

test('cross-device projection excludes the legacy bearer and rejects malformed amounts', () => {
  const valid = preview();
  assert.equal(protocol.validWorkstationPreview(valid), true);
  assert.equal(protocol.validWorkstationPreview({ ...valid, payload: { ...valid.payload, token: 'private-draft-bearer' } }), false);
  for (const field of ['subtotal', 'totalBeforeTip', 'tax', 'discount', 'tip', 'total']) {
    for (const invalid of [-1, Infinity, NaN, 10000001]) assert.equal(protocol.validWorkstationPreview({ ...valid, payload: { ...valid.payload, [field]: invalid } }), false, field + ': ' + invalid);
  }
  assert.equal(protocol.validWorkstationPreview({ ...valid, payload: { ...valid.payload, staffLines: Array(101).fill({}) } }), false);
  assert.equal(protocol.validWorkstationPreview({ ...valid, cartId: 'x'.repeat(129) }), false);
});

test('signed encoding is stable across object key order and binds nested intent fields', () => {
  const a = { workstationId: fixtureId(50), generation: 1, payload: { revision: '1', cartId: 'A', customer: { id: 'C', name: 'Sample' } }, kind: 'intent' };
  const b = { kind: 'intent', payload: { customer: { name: 'Sample', id: 'C' }, cartId: 'A', revision: '1' }, generation: 1, workstationId: fixtureId(50) };
  assert.equal(protocol.workstationCanonicalJSON(a), protocol.workstationCanonicalJSON(b));
  assert.notEqual(protocol.workstationCanonicalJSON(a), protocol.workstationCanonicalJSON({ ...b, payload: { ...b.payload, cartId: 'other' } }));
  assert.equal(protocol.workstationSignedBody({ ...a, signature: 'ignored' }), protocol.workstationCanonicalJSON(a));
});

// The SQL-backed cases below are intentionally run without provider credentials
// or a production-looking endpoint. Their fixture executes the migration itself.
const success = result => { assert.equal(result?.error, undefined, result?.error); return result; };
async function enrolled(f) {
  const staff = f.staff();
  const station = success(await f.command('create', staff, { label: 'Front desk', draftToken: 'fixture-private-draft' }));
  const scoped = { ...staff, workstationId: station.id };
  const codeHash = credentialHash(randomUUID());
  const coded = success(await f.command('code', scoped, { codeHash, replace: false }));
  const customer = f.customer(station.id);
  success(await f.command('pair', f.pair(), { codeHash, customerHash: customer.credentialHash }));
  return { staff: scoped, customer, station: coded, codeHash };
}
async function online(f, staff, cartId = 'cart-A', revision = 'revision-1', extra = {}) {
  return success(await f.command('heartbeat', staff, { dirty: true, pending: false, cartId, revision, ...extra }));
}
async function frame(f, actor, kind, payload) {
  const state = success(await f.command('reserveEvent', actor, { kind, payload }));
  const envelope = { version: 1, workstationId: state.id, generation: state.generation, sequence: state.event_sequence, kind, messageId: randomUUID(), issuedAt: Date.now(), expiresAt: Date.now() + 60000, payload, signature: 'fixture-signature-only-for-state-machine' };
  success(await f.command('commitEvent', actor, { envelope }));
  return envelope;
}

test('the real SQL boundary accepts only server authority and an active Portable key in the correct salon', { timeout: 30000 }, async () => {
  const f = await workstationFixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(f.command('list', f.staff(), {}, role), /permission denied/);
      const { rows } = await f.db.query(`select has_table_privilege($1,'public.portable_workstations','SELECT') as read,has_table_privilege($1,'public.portable_workstations','INSERT') as write`, [role]);
      assert.deepEqual(rows[0], { read: false, write: false });
    }
    await f.db.exec("set role service_role;select set_config('request.jwt.claim.role','',false)");
    await assert.rejects(f.db.query("select portable_workstation_command('list',$1::jsonb,'{}')", [JSON.stringify(f.staff())]), /Server authority required/);
    await f.db.exec('reset role');
    assert.equal((await f.command('create', { role: 'owner' }, { label: 'Wrong role', draftToken: 'fixture-private-draft' })).status, 401);
    assert.equal((await f.command('create', f.staff({ salonId: fixtureId(2) }), { label: 'Wrong salon', draftToken: 'fixture-private-draft' })).status, 401);
    assert.equal((await f.command('create', f.staff(), { label: 'Wrong draft', draftToken: 'fixture-other-private-draft' })).status, 409);
    await f.db.query('update pos_portable_access_keys set is_active=false where id=$1', [fixtureId(10)]);
    assert.equal((await f.command('list', f.staff())).status, 401);
  } finally { await f.close(); }
});

test('one-time enrollment survives employee logout and replacement revokes every old customer command', { timeout: 30000 }, async () => {
  const f = await workstationFixture();
  try {
    const { staff, customer, station, codeHash } = await enrolled(f);
    assert.equal((await f.command('pair', f.pair(), { codeHash, customerHash: credentialHash('replay') })).status, 400);
    assert.equal(success(await f.command('current', customer)).id, station.id);
    assert.equal((await f.command('code', customer, { codeHash: credentialHash('malicious') })).status, 400);
    assert.equal((await f.command('reserveEvent', customer, { kind: 'preview', payload: preview() })).status, 403);
    success(await f.command('logout', staff));
    const afterLogout = success(await f.command('current', customer));
    assert.equal(afterLogout.customer_hash, customer.credentialHash);
    assert.equal(afterLogout.lease_until, null);
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: { id: randomUUID(), kind: 'tip', amount: 4, cartId: 'A', revision: '1' } })).status, 409);
    assert.equal((await f.command('code', staff, { codeHash: credentialHash('unconfirmed-replace'), replace: false })).status, 409);
    const replacementCode = credentialHash('replacement');
    const replaced = success(await f.command('code', staff, { codeHash: replacementCode, replace: true }));
    assert.ok(replaced.generation > station.generation);
    assert.notEqual(replaced.topic, station.topic);
    for (const [action, input] of [['current', {}], ['reserveEvent', { kind: 'intent', payload: {} }], ['commitEvent', { envelope: {} }]]) assert.equal((await f.command(action, customer, input)).status, 401);
    const newCustomer = f.customer(station.id, 'replacement-customer');
    success(await f.command('pair', f.pair(), { codeHash: replacementCode, customerHash: newCustomer.credentialHash }));
    assert.equal(success(await f.command('current', newCustomer)).id, station.id);
  } finally { await f.close(); }
});

test('dropping an enrollment cookie cannot reopen a managed draft through any legacy Portable RPC', { timeout: 30000 }, async () => {
  const f = await workstationFixture();
  try {
    const { station } = await enrolled(f);
    const managedToken = (await f.db.query('select token from pos_live_drafts where id=$1', [station.draft_id])).rows[0].token;
    assert.notEqual(managedToken, 'fixture-private-draft');
    assert.equal((await f.db.query('select token from pos_live_drafts where token=$1', ['fixture-private-draft'])).rows.length, 0, 'a pre-enrollment raw display link is retired');
    const calls = [
      ...['sync_pos_portable_draft', 'update_pos_portable_live_draft', 'update_pos_portable_live_draft_customer', 'select_pos_portable_customer_visit_for_live_draft', 'finalize_pos_portable_live_draft'].map(name => ({ name, arg: token => token, type: 'text' })),
      ...['submit_pos_portable_receipt', 'replay_pos_portable_operation'].map(name => ({ name, arg: token => JSON.stringify({ liveDraftToken: token }), type: 'jsonb' })),
    ];
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await f.db.exec(`set role ${role};select set_config('request.jwt.claim.role','${role}',false);`);
      try {
        for (const call of calls) {
          const query = `select public.${call.name}($1::${call.type}) as value`;
          if (role === 'service_role') assert.equal((await f.db.query(query, [call.arg(managedToken)])).rows[0].value.ok, true);
          else await assert.rejects(f.db.query(query, [call.arg(managedToken)]), /Workstation enrollment required/);
          assert.equal((await f.db.query(query, [call.arg('fixture-unmanaged-draft')])).rows[0].value.ok, true, 'ordinary unmanaged Windows/Portable contract is retained');
        }
      } finally { await f.db.exec('reset role'); }
    }
  } finally { await f.close(); }
});

test('pairing expires, resists code replay and limits both device and network attempts', { timeout: 30000 }, async () => {
  const f = await workstationFixture();
  try {
    const staff = f.staff();
    const station = success(await f.command('create', staff, { label: 'Front desk', draftToken: 'fixture-private-draft' }));
    const scoped = { ...staff, workstationId: station.id }, codeHash = credentialHash('expired');
    success(await f.command('code', scoped, { codeHash }));
    await f.db.query("update portable_workstations set code_expires_at=clock_timestamp()-interval '1 second' where id=$1", [station.id]);
    assert.equal((await f.command('pair', f.pair(), { codeHash, customerHash: credentialHash('guest') })).status, 400);
    const networkHash = credentialHash('one-fixture-network');
    for (let i = 0; i < 20; i++) assert.equal((await f.command('pair', { ...f.pair(), networkHash }, { codeHash: credentialHash('wrong'), customerHash: credentialHash('guest') })).status, 400);
    assert.equal((await f.command('pair', { ...f.pair(), networkHash }, { codeHash: credentialHash('wrong'), customerHash: credentialHash('guest') })).status, 429);
    const attemptHash = credentialHash('one-fixture-device');
    for (let i = 0; i < 20; i++) assert.equal((await f.command('pair', { ...f.pair(), attemptHash }, { codeHash: credentialHash('wrong'), customerHash: credentialHash('guest') })).status, 400);
    assert.equal((await f.command('pair', { ...f.pair(), attemptHash }, { codeHash: credentialHash('wrong'), customerHash: credentialHash('guest') })).status, 429);
  } finally { await f.close(); }
});

test('employee handover requires a recently saved empty cart, retains enrollment and fences the old writer', { timeout: 30000 }, async () => {
  const f = await workstationFixture();
  try {
    const { staff, customer, station } = await enrolled(f);
    const otherStaff = f.staff({ workstationId: station.id, deviceId: fixtureId(101), credentialHash: credentialHash('fixture-writer-b') });
    assert.equal((await f.command('select', otherStaff)).status, 409);
    await online(f, staff);
    assert.equal((await f.command('select', otherStaff)).status, 409);
    await online(f, staff, 'empty-cart', 'empty-revision', { dirty: false, pending: true });
    assert.equal((await f.command('select', otherStaff)).status, 409);
    await online(f, staff, 'empty-cart', 'empty-revision', { dirty: false, pending: false });
    await frame(f, staff, 'preview', preview({ cartId: 'empty-cart', revision: 'empty-revision' }));
    assert.equal((await f.command('select', otherStaff)).status, 409, 'a falsely clean heartbeat cannot transfer a nonempty signed receipt');
    await f.db.query("update portable_workstations set heartbeat_at=clock_timestamp()-interval '25 seconds' where id=$1", [station.id]);
    assert.equal((await f.command('select', otherStaff)).status, 409);
    await online(f, staff, 'empty-cart', 'empty-revision', { dirty: false, pending: false });
    await frame(f, staff, 'preview', preview({ cartId: 'empty-cart', revision: 'empty-revision', payload: { ...preview().payload, staffLines: [], subtotal: 0, totalBeforeTip: 0, total: 0, customer: null } }));
    const retiredToken = (await f.db.query('select token from pos_live_drafts where id=$1', [station.draft_id])).rows[0].token;
    const transferred = success(await f.command('select', otherStaff));
    assert.equal(transferred.customer_hash, customer.credentialHash);
    assert.ok(transferred.generation > station.generation);
    assert.equal(transferred.draft_id, station.draft_id);
    assert.equal(success(await f.command('current', customer)).writer_device, fixtureId(101));
    assert.equal((await f.command('heartbeat', staff, { dirty: false, pending: false, cartId: 'stale', revision: 'stale' })).status, 409);
    assert.equal((await f.command('reserveEvent', staff, { kind: 'preview', payload: preview() })).status, 409);
    assert.equal((await f.db.query('select device_id,draft_id from pos_workspace_drafts where draft_id=$1', [station.draft_id])).rows.length, 1);
    assert.equal((await f.db.query('select device_id from pos_workspace_drafts where draft_id=$1', [station.draft_id])).rows[0].device_id, fixtureId(101));
    assert.equal((await f.db.query('select id from pos_live_drafts where token=$1', [retiredToken])).rows.length, 0, 'the retired staff device raw display bearer is invalid after handover');
  } finally { await f.close(); }
});

test('customer identity intents require the exact recently approved phone-lookup result in the current cart', { timeout: 30000 }, async () => {
  const f = await workstationFixture();
  try {
    const { staff, customer, station } = await enrolled(f);
    await online(f, staff);
    await frame(f, staff, 'preview', preview({ revision: 'identity-revision-1' }));
    const person = { id: fixtureId(500), name: 'Verified fixture customer', phone: '+15551234567' };
    const intent = { id: randomUUID(), kind: 'customer', cartId: 'fixture-cart', revision: 'identity-revision-1', customer: person };
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: intent })).status, 403);
    success(await f.command('allowCustomer', customer, { cartId: intent.cartId, revision: intent.revision, customer: person }));
    success(await f.command('reserveEvent', customer, { kind: 'intent', payload: intent }));
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: { ...intent, id: randomUUID(), customer: { ...person, name: 'Forged replacement' } } })).status, 403);
    await frame(f, staff, 'preview', preview({ revision: 'identity-revision-2' }));
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: { ...intent, id: randomUUID(), revision: 'identity-revision-2' } })).status, 403);
    success(await f.command('allowCustomer', customer, { cartId: intent.cartId, revision: 'identity-revision-2', customer: person }));
    await f.db.query("update portable_workstations set customer_selection=jsonb_set(customer_selection,'{expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=$1", [station.id]);
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: { ...intent, id: randomUUID(), revision: 'identity-revision-2' } })).status, 403);
  } finally { await f.close(); }
});

test('SQL stream sequencing retains the newest preview and rejects stale, busy, completed and reused customer intents', { timeout: 30000 }, async () => {
  const f = await workstationFixture();
  try {
    const { staff, customer } = await enrolled(f);
    await online(f, staff);
    const first = await frame(f, staff, 'preview', preview({ revision: '1' }));
    const second = await frame(f, staff, 'preview', preview({ revision: '2' }));
    success(await f.command('commitEvent', staff, { envelope: first }));
    assert.equal(success(await f.command('current', customer)).latest_envelope.sequence, second.sequence);
    const intent = { id: randomUUID(), kind: 'tip', amount: 5, cartId: 'fixture-cart', revision: '1' };
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: intent })).status, 409);
    const currentIntent = { ...intent, revision: '2' };
    success(await f.command('reserveEvent', customer, { kind: 'intent', payload: currentIntent }));
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: { ...currentIntent, amount: 500 } })).status, 409);
    await frame(f, staff, 'ack', { id: currentIntent.id, cartId: currentIntent.cartId, revision: currentIntent.revision, accepted: true });
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: currentIntent })).status, 409);
    await frame(f, staff, 'preview', preview({ revision: '3', busy: true }));
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: { ...intent, id: randomUUID(), revision: '3' } })).status, 409);
    await frame(f, staff, 'preview', preview({ revision: '4', completedAt: new Date().toISOString() }));
    assert.equal((await f.command('reserveEvent', customer, { kind: 'intent', payload: { ...intent, id: randomUUID(), revision: '4' } })).status, 409);
    assert.equal((await f.command('commitEvent', staff, { envelope: { ...second, generation: 0 } })).status, 409);
  } finally { await f.close(); }
});
