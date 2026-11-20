import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const forward = '20261119203000_session_denial_account_erasure.sql';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('validated denial retention follows actual Auth hard deletion without restoring an old JWT', {
  skip: process.env.RUN_ISOLATED_SUPABASE !== '1', timeout: 900000,
}, async () => {
  const root = process.cwd();
  const output = process.env.BOOKING_TEST_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'session-denial-erasure-'));
  fs.mkdirSync(output, {recursive: true});
  const migrations = path.join(root, 'supabase/migrations');
  const files = fs.readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
  assert.equal(files.length, 453);
  assert.equal(files.at(-1), forward);
  const inherited = files.filter(name => name !== forward).map(file => ({file, sha256: sha256(fs.readFileSync(path.join(migrations, file)))}));
  assert.equal(inherited.length, 452);
  const forwardBytes = fs.readFileSync(path.join(migrations, forward));
  const forwardSql = forwardBytes.toString().replaceAll('\r\n', '\n');
  // The unchanged fixture loads every migration from cwd. Give this one owned
  // instance a staged, byte-identical452 baseline so existing tombstones really
  // precede the new constraint. No shared fixture or source helper is changed.
  const staging = path.join(output, 'baseline452');
  fs.mkdirSync(path.join(staging, 'supabase/migrations'), {recursive: true});
  for (const {file, sha256: expected} of inherited) {
    const bytes = fs.readFileSync(path.join(migrations, file));
    assert.equal(sha256(bytes), expected);
    fs.writeFileSync(path.join(staging, 'supabase/migrations', file), bytes);
  }
  const images = JSON.parse(process.env.TEST_SUPABASE_IMAGES || '{"db":"public.ecr.aws/supabase/postgres:17.11.0.006","auth":"public.ecr.aws/supabase/gotrue:v2.197.0","storage":"public.ecr.aws/supabase/storage-api:v1.84.19","rest":"public.ecr.aws/supabase/postgrest:v16.5"}');
  let f;
  try {
    process.chdir(staging);
    f = await startIsolatedSupabase('session-denial-erasure', images, {allowConcurrentFixtureCleanup: true});
  } finally {
    process.chdir(root);
  }
  const checkNames = [];
  const check = (name, assertion) => { assertion(); checkNames.push(name); };
  const tokens = [];
  const redact = value => tokens.reduce((text, token) => text.replaceAll(token, '[fixture-redacted]'), f.redact(value));
  const aclSnapshot = () => f.sql(`select jsonb_build_object(
    'schema',(select jsonb_build_object('owner',nspowner::regrole::text,'acl',nspacl::text) from pg_namespace where nspname='reylumi_security'),
    'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner::regrole::text,'acl',c.relacl::text) order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='reylumi_security' and c.relkind='r'),
    'columns',(select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'acl',a.attacl::text) order by c.relname,a.attnum)
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='reylumi_security' and a.attnum>0 and not a.attisdropped))::text`);
  function anotherDevice(person) {
    const link = f.request(9999, '/admin/generate_link', 'POST', {type: 'magiclink', email: person.email}, f.serviceToken);
    const login = f.request(9999, '/verify', 'POST', {type: 'magiclink', token_hash: link.hashed_token});
    assert.ok(login.access_token); assert.ok(login.refresh_token);
    tokens.push(login.access_token, login.refresh_token);
    return {...person, token: login.access_token, refreshToken: login.refresh_token};
  }
  try {
    check('actual baseline452 loaded unchanged', () => assert.deepEqual(f.evidence.migrationHashes.map(({file, sha256}) => ({file, sha256})), inherited));
    const accountA = f.person('erasure-a'), accountB = f.person('erasure-b');
    const deviceA = anotherDevice(accountA), deviceB = anotherDevice(accountB);
    const sessionA = f.rpc(accountA, 'check_account_login_session').session_id;
    const sessionB = f.rpc(accountB, 'check_account_login_session').session_id;
    f.rpc(deviceA, 'check_account_login_session');
    f.rpc(deviceB, 'check_account_login_session');
    assert.equal(f.rpc(deviceA, 'revoke_account_login_session', {p_session_id: sessionA, p_scope: 'one'}), 1);
    assert.equal(f.rpc(deviceB, 'revoke_account_login_session', {p_session_id: sessionB, p_scope: 'one'}), 1);
    const tombstones = () => f.json(`select coalesce(jsonb_agg(to_jsonb(d) order by d.auth_session_id),'[]'::jsonb) from reylumi_security.denied_legacy_sessions d
      where auth_user_id in ('${accountA.authId}','${accountB.authId}')`);
    const before = tombstones();
    check('both real revocations created existing tombstones while Auth users remain', () => {
      assert.equal(before.length, 2);
      assert.equal(f.sql(`select count(*) from auth.users where id in ('${accountA.authId}','${accountB.authId}')`), '2');
    });
    const otherBefore = before.filter(row => row.auth_user_id === accountB.authId);
    const privateAclBefore = aclSnapshot();
    // Validate instead of silently deleting orphan metadata during deployment.
    const orphanUser = randomUUID(), orphanSession = randomUUID();
    f.sql(`insert into reylumi_security.denied_legacy_sessions(auth_session_id,auth_user_id) values('${orphanSession}','${orphanUser}')`);
    let validationFailure;
    try { f.sql(forwardSql); } catch (error) { validationFailure = redact(error.message); }
    check('orphan preimage rejects migration and preserves all seeded rows', () => {
      assert.ok(validationFailure?.includes('violates foreign key constraint'));
      assert.equal(f.sql(`select count(*) from reylumi_security.denied_legacy_sessions where auth_session_id='${orphanSession}'`), '1');
      assert.equal(f.sql(`select count(*) from pg_constraint where conrelid='reylumi_security.denied_legacy_sessions'::regclass and conname='denied_legacy_sessions_auth_user_fk'`), '0');
      assert.deepEqual(tombstones(), before);
    });
    f.save('expected-orphan-validation-failure.json', {expected: true, message: validationFailure, sourceSha256: sha256(forwardBytes), noRowsRemoved: true});
    // Remove only this intentionally invalid, owned setup row before the
    // positive upgrade; normal probes never disable or drop a gate/constraint.
    f.sql(`delete from reylumi_security.denied_legacy_sessions where auth_session_id='${orphanSession}' and auth_user_id='${orphanUser}'`);
    f.sql(forwardSql);
    f.evidence.forwardMigration = {file: forward, sha256: sha256(forwardBytes), executedSha256: sha256(forwardSql), phase: 'after seeded452 and expected orphan-validation failure'};
    check('FK fully validated, immediate and cascade targets Auth user id', () => {
      assert.deepEqual(f.json(`select jsonb_build_object('validated',convalidated,'deferrable',condeferrable,'delete_action',confdeltype::text,
        'target',confrelid::regclass::text,'local_columns',(select jsonb_agg(attname order by ord) from unnest(conkey) with ordinality cols(attnum,ord)
          join pg_attribute a on a.attrelid=conrelid and a.attnum=cols.attnum),
        'target_columns',(select jsonb_agg(attname order by ord) from unnest(confkey) with ordinality cols(attnum,ord)
          join pg_attribute a on a.attrelid=confrelid and a.attnum=cols.attnum))
        from pg_constraint where conrelid='reylumi_security.denied_legacy_sessions'::regclass and conname='denied_legacy_sessions_auth_user_fk'`),
      {validated: true, deferrable: false, delete_action: 'c', target: 'auth.users', local_columns: ['auth_user_id'], target_columns: ['id']});
    });
    check('upgrade preserves existing tombstones and exact private ACLs', () => {
      assert.deepEqual(tombstones(), before); assert.equal(aclSnapshot(), privateAclBefore);
    });
    const bucket = 'erasure-private-fixture';
    f.request(5000, '/bucket', 'POST', {id: bucket, name: bucket, public: false}, f.serviceToken);
    f.sql(`create policy fixture_erasure_storage_read on storage.objects for select to authenticated using(bucket_id='${bucket}');
      create function public.fixture_erasure_guard_definer() returns integer language sql security definer set search_path='' as $$select 7$$;
      revoke all on function public.fixture_erasure_guard_definer() from public,anon;
      grant execute on function public.fixture_erasure_guard_definer() to authenticated;
      notify pgrst,'reload schema';`);
    f.request(5000, '/object/' + bucket + '/proof.json', 'POST', {fixture: true}, f.serviceToken);
    let definerReady = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (f.http(3000, '/rpc/fixture_erasure_guard_definer', 'POST', {}, deviceB.token).status === 200) { definerReady = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    check('effective hook positive control and surviving device access before deletion', () => {
      assert.ok(definerReady);
      assert.equal(f.rpc(deviceA, 'fixture_erasure_guard_definer'), 7);
      assert.equal(f.http(5000, '/object/authenticated/' + bucket + '/proof.json', 'GET', undefined, deviceA.token).status, 200);
      assert.equal(f.http(3000, '/rpc/check_account_login_session', 'POST', {}, accountA.token).status, 401);
    });
    const deleted = f.http(9999, '/admin/users/' + accountA.authId, 'DELETE', {should_soft_delete: false}, f.serviceToken);
    check('actual Auth hard delete removes only target tombstones', () => {
      assert.equal(deleted.status, 200);
      assert.equal(f.sql(`select count(*) from auth.users where id='${accountA.authId}'`), '0');
      assert.equal(f.sql(`select count(*) from auth.sessions where user_id='${accountA.authId}'`), '0');
      assert.equal(f.sql(`select count(*) from reylumi_security.denied_legacy_sessions where auth_user_id='${accountA.authId}'`), '0');
      assert.deepEqual(tombstones(), otherBefore);
    });
    check('revoked old JWT stays denied on private table, definer, enrollment and Storage', () => {
      assert.equal(f.http(3000, '/users?select=id', 'GET', undefined, accountA.token).status, 401);
      assert.equal(f.http(3000, '/rpc/fixture_erasure_guard_definer', 'POST', {}, accountA.token).status, 401);
      assert.equal(f.http(3000, '/rpc/check_account_login_session', 'POST', {}, accountA.token).status, 401);
      assert.ok(f.http(5000, '/object/authenticated/' + bucket + '/proof.json', 'GET', undefined, accountA.token).status >= 400);
    });
    check('hard-deleted formerly active device is denied and cannot refresh', () => {
      assert.equal(f.http(3000, '/rpc/fixture_erasure_guard_definer', 'POST', {}, deviceA.token).status, 401);
      assert.equal(f.http(3000, '/rpc/check_account_login_session', 'POST', {}, deviceA.token).status, 401);
      assert.ok(f.http(9999, '/token?grant_type=refresh_token', 'POST', {refresh_token: deviceA.refreshToken}).status >= 400);
    });
    let orphanInsertError;
    try {
      f.sql(`insert into reylumi_security.denied_legacy_sessions(auth_session_id,auth_user_id) values('${randomUUID()}','${accountA.authId}')`);
    } catch (error) { orphanInsertError = redact(error.message); }
    check('orphan insertion is rejected after actual account deletion', () => assert.ok(orphanInsertError?.includes('violates foreign key constraint')));
    check('other account tombstone, authenticated private access and refresh survive', () => {
      assert.deepEqual(tombstones(), otherBefore);
      assert.equal(f.rpc(deviceB, 'fixture_erasure_guard_definer'), 7);
      assert.equal(f.rpc(deviceB, 'check_account_login_session').allowed, true);
      assert.equal(f.http(5000, '/object/authenticated/' + bucket + '/proof.json', 'GET', undefined, deviceB.token).status, 200);
      assert.equal(f.http(9999, '/token?grant_type=refresh_token', 'POST', {refresh_token: deviceB.refreshToken}).status, 200);
      assert.equal(aclSnapshot(), privateAclBefore);
    });
    check('all inherited452 and new453 migration source bytes unchanged', () => {
      assert.deepEqual(inherited.map(({file}) => ({file, sha256: sha256(fs.readFileSync(path.join(migrations, file)))})), inherited);
      assert.equal(sha256(fs.readFileSync(path.join(migrations, forward))), sha256(forwardBytes));
    });
    f.save('session-denial-erasure-acceptance.json', {
      passed: true, baselineMigrations: 452, targetMigrations: 453,
      forward: f.evidence.forwardMigration, checks: checkNames, checkCount: checkNames.length,
      realAuthHardDelete: true, onlyOwnedSyntheticAccounts: true,
      earlyTombstonePurge: false, privateAclUnchanged: true, inherited452Unchanged: true,
      productionChanged: false, physicalDeviceAcceptance: false,
    });
  } catch (error) {
    f.save('session-denial-erasure-failure.json', {passed: false, completedChecks: checkNames, error: redact(error.stack)});
    throw Error(redact(error.stack));
  } finally {
    f.close();
  }
});
