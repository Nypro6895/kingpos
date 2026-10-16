import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startIsolatedSupabase } from './helpers/isolated-supabase-fixture.mjs';

test('staff consent through actual full schema, Auth JWTs, PostgREST RLS and existing invitation/application RPCs', {
  skip: process.env.RUN_ISOLATED_SUPABASE !== '1' ? 'Requires opt-in isolated cached Supabase containers' : false,
  timeout: 900000,
}, async t => {
  const rpcHashQuery = "select coalesce(json_object_agg(proname,md5(pg_get_functiondef(oid))),'{}') from pg_proc where pronamespace='public'::regnamespace and proname in('apply_staff_connection_invite_decision','resend_staff_connection_invite','review_staff_salon_application')";
  let beforeRpcHashes;
  const f = await startIsolatedSupabase('staff-offline-binding', { beforeMigration({file,json}) { if(file==='20261016080000_staff_offline_binding_attestation.sql') beforeRpcHashes=json(rpcHashQuery); } });
  t.after(() => f.close());
  const report = { transport: 'Actual repository migrations, Auth JWTs, PostgREST and existing RPC definitions', cases: [], productionCalls: 0, externalMessages: 0 };
  const check = async (name, run) => t.test(name, () => {
    try { run(); report.cases.push({ name, result: 'passed' }); }
    catch (error) { report.cases.push({ name, result: 'failed', message: f.redact(error.message) }); throw error; }
    finally { f.save('staff-offline-binding-results.json', report); }
  });
  assert.ok(f.evidence.migrationHashes.some(item => item.file === '20261016080000_staff_offline_binding_attestation.sql'));
  assert.ok(!f.evidence.migrationHashes.some(item => /20261016.*(?:financial|ledger|payroll)/.test(item.file)), 'no unrelated financial migrations selected');
  assert.deepEqual(f.json(rpcHashQuery), beforeRpcHashes, 'existing invitation/review/resend definitions remain byte-for-byte unchanged');
  f.save('onboarding-rpc-preservation.json', { before: beforeRpcHashes, after: f.json(rpcHashQuery), unchanged: true });
  const owner = f.person('binding-owner'), otherOwner = f.person('other-owner'), invited = f.person('invited'), applicant = f.person('applicant'), outsider = f.person('outsider'), historical = f.person('historical');
  function salon(who) {
    const account = f.rpc(who, 'ensure_personal_account_for_current_user', { p_account_name: 'Isolated staff consent fixture' })[0].account_id;
    return f.rpc(who, 'create_account_salon_with_owner_staff', { p_account_id: account, p_create_request_key: crypto.randomUUID(), p_name: 'Isolated consent salon', p_owner_is_staff: false, p_phone: null, p_address_line1: null, p_address_line2: null, p_city: null, p_state: null, p_postal_code: null, p_country: 'US' }).salon_id;
  }
  const salonId = salon(owner), otherSalon = salon(otherOwner);
  f.rest(owner, `/salon_settings?salon_id=eq.${salonId}`, 'PATCH', { allow_staff_applications: true });
  const manual = () => f.rest(owner, '/staff', 'POST', { salon_id: salonId, display_name: 'Synthetic staff', is_active: true })[0].id;
  const call = (who, name, body) => f.http(3000, `/rpc/${name}`, 'POST', body, who?.token);
  const denied = result => result.status >= 400 || Array.isArray(result.data) && result.data.length === 0;
  const binding = (who, staffId) => f.rpc(who, 'get_my_staff_offline_binding', { p_staff_id: staffId });
  const attest = (who, staffId, viewer = who) => f.rpc(who, 'attest_staff_offline_binding', { p_staff_id: staffId, p_expected_viewer_id: viewer.profileId });
  const invite = (staffId, who) => {
    const token = `fixture-${crypto.randomUUID()}`;
    const row = f.rest(owner, '/staff_salon_connection_requests', 'POST', { salon_id: salonId, staff_id: staffId, account_user_id: who.profileId, initiated_by_user_id: owner.profileId, direction: 'salon_invite', status: 'pending', target_email_normalized: who.email, token_hash: crypto.createHash('sha256').update(token).digest('hex'), expires_at: new Date(Date.now() + 86400000).toISOString() })[0];
    return { ...row, token };
  };
  const invitedStaff = manual(), legitimate = invite(invitedStaff, invited), victim = manual();
  await check('new owner-created invitation accepts through actual existing RPC; wrong account remains denied', () => {
    assert.ok(denied(call(outsider, 'accept_staff_connection_invite', { p_token: legitimate.token })));
    const result = f.rpc(invited, 'accept_staff_connection_invite', { p_token: legitimate.token });
    assert.equal(result.staff_id, invitedStaff); assert.equal(result.status, 'accepted');
    assert.equal(binding(invited, invitedStaff), null, 'accepted link is not implicitly an offline approval');
  });
  await check('unrelated user cannot self-target invite, forge owner-looking fields, or write attestation rows', () => {
    const attempt = f.http(3000, '/staff_salon_connection_requests', 'POST', { salon_id: salonId, staff_id: victim, account_user_id: outsider.profileId, initiated_by_user_id: owner.profileId, reviewed_by_user_id: owner.profileId, direction: 'salon_invite', status: 'pending', target_email_normalized: outsider.email }, outsider.token);
    assert.ok(denied(attempt));
    assert.ok(denied(call(outsider, 'attest_staff_offline_binding', { p_staff_id: victim, p_expected_viewer_id: outsider.profileId })));
    assert.ok(denied(f.http(3000, '/staff_offline_bindings', 'POST', { staff_id: victim, salon_id: salonId, viewer_user_id: outsider.profileId, approved_by_user_id: owner.profileId }, outsider.token)));
    assert.equal(f.sql(`select account_user_id is null from staff where id='${victim}'`), 't');
  });
  const application = f.rpc(applicant, 'submit_staff_salon_application', { p_salon_id: salonId, p_message: 'Synthetic application', p_requested_job_title: 'Technician' });
  await check('application RPC remains pending; direct review-field forgery and applicant self-review are denied', () => {
    assert.ok(denied(f.http(3000, `/staff_salon_connection_requests?id=eq.${application.request_id}`, 'PATCH', { status: 'accepted', direction: 'salon_invite', staff_id: victim, reviewed_by_user_id: owner.profileId }, applicant.token, ['Prefer: return=representation'])));
    assert.ok(denied(call(applicant, 'review_staff_salon_application', { p_request_id: application.request_id, p_decision: 'accepted', p_staff_id: victim })));
    assert.equal(f.rest(applicant, `/staff_salon_connection_requests?id=eq.${application.request_id}&select=status`)[0].status, 'pending');
  });
  let applicantStaff;
  await check('actual owner review preserves legitimate application and selected staff linking', () => {
    const result = f.rpc(owner, 'review_staff_salon_application', { p_request_id: application.request_id, p_decision: 'accepted', p_staff_id: victim });
    applicantStaff = result.staff_id; assert.equal(applicantStaff, victim); assert.equal(result.status, 'accepted');
    assert.equal(binding(applicant, applicantStaff), null);
  });
  const historicalStaff = manual(), oldRequest = crypto.randomUUID();
  // Privileged fixture seed represents a pre-migration row with no trusted
  // creation marker. No existing production row is changed or contacted.
  f.sql(`insert into staff_salon_connection_requests(id,salon_id,staff_id,account_user_id,initiated_by_user_id,direction,status,target_email_normalized,expires_at)values('${oldRequest}','${salonId}','${historicalStaff}','${historical.profileId}','${historical.profileId}','salon_invite','pending','${historical.email}',now()+interval '1 day')`);
  await check('historical pending invite cannot accept without owner resend; attempted staff link rolls back', () => {
    const rejected = call(historical, 'accept_staff_connection_invite_by_request', { p_request_id: oldRequest });
    assert.ok(denied(rejected)); assert.match(rejected.data.message, /resend/i);
    assert.equal(f.sql(`select account_user_id is null from staff where id='${historicalStaff}'`), 't');
    assert.equal(f.sql(`select status from staff_salon_connection_requests where id='${oldRequest}'`), 'pending');
  });
  await check('owner resend reconfirms historical invite without replacing or deleting request; acceptance then works', () => {
    f.rpc(owner, 'resend_staff_connection_invite', { p_request_id: oldRequest, p_token_hash: crypto.createHash('sha256').update('isolated-new-token').digest('hex'), p_expires_at: new Date(Date.now() + 86400000).toISOString() });
    const result = f.rpc(historical, 'accept_staff_connection_invite_by_request', { p_request_id: oldRequest });
    assert.equal(result.staff_id, historicalStaff); assert.equal(result.status, 'accepted');
    assert.equal(binding(historical, historicalStaff), null);
  });
  let revision;
  await check('only authorized owner confirms exact currently linked account; cross-salon and stale account approvals fail', () => {
    assert.ok(denied(call(invited, 'attest_staff_offline_binding', { p_staff_id: invitedStaff, p_expected_viewer_id: invited.profileId })));
    assert.ok(denied(call(otherOwner, 'attest_staff_offline_binding', { p_staff_id: invitedStaff, p_expected_viewer_id: invited.profileId })));
    assert.ok(denied(call(owner, 'attest_staff_offline_binding', { p_staff_id: invitedStaff, p_expected_viewer_id: outsider.profileId })));
    revision = attest(owner, invitedStaff, invited);
    const own = binding(invited, invitedStaff); assert.equal(own.version, 1); assert.equal(own.viewerId, invited.profileId); assert.equal(own.staffId, invitedStaff); assert.equal(own.revision, revision); assert.equal(own.revoked, false);
    assert.equal(binding(outsider, invitedStaff), null);
    assert.equal(binding(applicant, invitedStaff), null);
    assert.equal(f.sql(`select count(*) from staff_invite_owner_authorizations where salon_id='${otherSalon}'`), '0');
  });
  await check('owner revoke is revision guarded; ordinary online link remains untouched and explicit reconfirmation issues new revision', () => {
    assert.ok(denied(call(owner, 'revoke_staff_offline_binding', { p_staff_id: invitedStaff, p_expected_revision: crypto.randomUUID() })));
    f.rpc(owner, 'revoke_staff_offline_binding', { p_staff_id: invitedStaff, p_expected_revision: revision });
    assert.equal(binding(invited, invitedStaff).revoked, true);
    assert.equal(f.rest(owner, `/staff?id=eq.${invitedStaff}&select=account_user_id`)[0].account_user_id, invited.profileId);
    const next = attest(owner, invitedStaff, invited); assert.notEqual(next, revision); revision = next;
  });
  await check('suspended owner cannot use an already issued JWT to attest, revoke or create an authorized invitation', () => {
    const target = manual();
    const pending = invite(target, outsider);
    f.sql(`update users set status='suspended' where id='${owner.profileId}'`);
    try {
      assert.ok(denied(call(owner, 'attest_staff_offline_binding', { p_staff_id: invitedStaff, p_expected_viewer_id: invited.profileId })));
      assert.ok(denied(call(owner, 'revoke_staff_offline_binding', { p_staff_id: invitedStaff, p_expected_revision: revision })));
      assert.ok(denied(f.http(3000, '/staff_salon_connection_requests', 'POST', { salon_id: salonId, staff_id: target, account_user_id: outsider.profileId, initiated_by_user_id: owner.profileId, direction: 'salon_invite', status: 'pending', target_email_normalized: outsider.email }, owner.token)));
      assert.ok(denied(call(owner, 'resend_staff_connection_invite', { p_request_id: pending.id, p_token_hash: pending.token_hash, p_expires_at: new Date(Date.now() + 172800000).toISOString() })), 'a definer resend cannot extend an old owner authorization using a suspended actor');
    } finally { f.sql(`update users set status='active' where id='${owner.profileId}'`); }
    assert.equal(binding(invited, invitedStaff).revision, revision, 'denied old-JWT calls cannot change an existing approval');
  });
  await check('deactivation/rebind revoke offline attestation; reconnecting same account never resurrects old approval', () => {
    f.rest(owner, `/staff?id=eq.${invitedStaff}`, 'PATCH', { is_active: false });
    f.rest(owner, `/staff?id=eq.${invitedStaff}`, 'PATCH', { is_active: true });
    assert.equal(binding(invited, invitedStaff).revoked, true);
    attest(owner, invitedStaff, invited);
    f.rest(owner, `/staff?id=eq.${invitedStaff}`, 'PATCH', { account_user_id: null });
    f.rest(owner, `/staff?id=eq.${invitedStaff}`, 'PATCH', { account_user_id: invited.profileId });
    assert.equal(binding(invited, invitedStaff).revoked, true);
  });
  f.save('staff-offline-binding-schema.json', {
    policies: f.json("select coalesce(json_agg(p),'[]') from(select tablename,policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in('staff_salon_connection_requests','staff_offline_bindings','staff_invite_owner_authorizations'))p"),
    functions: f.json("select coalesce(json_agg(p),'[]') from(select proname,prosecdef,proacl::text from pg_proc where pronamespace='public'::regnamespace and proname in('attest_staff_offline_binding','revoke_staff_offline_binding','get_my_staff_offline_binding','require_owner_authorized_staff_invite'))p"),
  });
});
