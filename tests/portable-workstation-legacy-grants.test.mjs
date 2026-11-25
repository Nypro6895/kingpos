import test from 'node:test';
import assert from 'node:assert/strict';
import { workstationFixture } from './helpers/portable-workstation-fixture.mjs';

const legacyFunctions = [
  'sync_pos_portable_draft', 'update_pos_portable_live_draft', 'update_pos_portable_live_draft_customer',
  'select_pos_portable_customer_visit_for_live_draft', 'finalize_pos_portable_live_draft',
  'submit_pos_portable_receipt', 'replay_pos_portable_operation',
];
const restricted = new Set(['sync_pos_portable_draft', 'select_pos_portable_customer_visit_for_live_draft', 'submit_pos_portable_receipt', 'replay_pos_portable_operation']);
const argumentType = name => ['submit_pos_portable_receipt', 'replay_pos_portable_operation'].includes(name) ? 'jsonb' : 'text';
const effectiveRights = async db => (await db.query(`
  select p.proname,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any($1::text[]) order by p.proname
`, [legacyFunctions])).rows;
const nonServiceAcl = async db => (await db.query(`
  select p.proname,a.grantee::text,a.grantor::text,a.privilege_type,a.is_grantable
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where n.nspname='public' and p.proname=any($1::text[])
    and a.grantee<>(select oid from pg_roles where rolname='service_role')
  order by p.proname,a.grantee,a.grantor,a.privilege_type,a.is_grantable
`, [legacyFunctions])).rows;

test('migration adds exact server execution for production-style restricted Portable RPCs without changing legacy ACLs', { timeout: 30000 }, async () => {
  let beforeRights, beforeAcl;
  const f = await workstationFixture({ beforeMigration: async db => {
    for (const name of legacyFunctions) {
      const identity = `public.${name}(${argumentType(name)})`;
      if (restricted.has(name)) await db.exec(`revoke execute on function ${identity} from public,service_role;`);
      await db.exec(`grant execute on function ${identity} to anon,authenticated;`);
    }
    // Preserve a pre-existing grant option too, not merely the three API roles.
    await db.exec('create role portable_fixture_auditor;grant execute on function public.sync_pos_portable_draft(text) to portable_fixture_auditor with grant option;');
    beforeRights = await effectiveRights(db);
    beforeAcl = await nonServiceAcl(db);
    assert.equal(beforeRights.length, 7);
    for (const row of beforeRights) {
      assert.equal(row.service_execute, !restricted.has(row.proname), row.proname + ' pre-migration service right');
      assert.equal(row.public_execute, !restricted.has(row.proname));
      assert.equal(row.anon_execute, true);
      assert.equal(row.authenticated_execute, true);
    }
  } });
  try {
    const afterRights = await effectiveRights(f.db);
    assert.deepEqual(await nonServiceAcl(f.db), beforeAcl, 'every existing non-service ACL entry and grant option is preserved');
    for (const row of afterRights) {
      const before = beforeRights.find(previous => previous.proname === row.proname);
      assert.equal(row.service_execute, true, row.proname + ' server proxy is allowed');
      assert.equal(row.anon_execute, before.anon_execute);
      assert.equal(row.authenticated_execute, before.authenticated_execute);
      assert.equal(row.public_execute, before.public_execute, 'three PUBLIC grants retained; four restricted functions remain restricted');
    }
    const directGrants = (await f.db.query(`
      select count(*)::integer as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join lateral aclexplode(p.proacl) a
      where n.nspname='public' and p.proname=any($1::text[])
        and a.grantee=(select oid from pg_roles where rolname='service_role') and a.privilege_type='EXECUTE'
    `, [legacyFunctions])).rows[0].count;
    assert.equal(directGrants, 7, 'exact seven fenced functions have a direct existing server-role grant');
  } finally { await f.close(); }
});

test('new workstation tables and command/assertion RPCs remain server-only with RLS enabled', { timeout: 30000 }, async () => {
  const f = await workstationFixture();
  try {
    const tables = ['portable_workstations', 'portable_workstation_pair_limits', 'portable_workstation_intents'];
    const rows = (await f.db.query('select relname,relrowsecurity from pg_class where oid=any($1::regclass[]) order by relname', [tables.map(name => 'public.' + name)])).rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.relrowsecurity));
    const functions = ['public.portable_workstation_command(text,jsonb,jsonb)', 'public.portable_workstation_assert_legacy_draft(text)'];
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const table of tables) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const rights = (await f.db.query('select has_table_privilege($1,$2,$3) as allowed', [role, 'public.' + table, privilege])).rows[0].allowed;
          assert.equal(rights, role === 'service_role', role + ' ' + privilege + ' on ' + table);
        }
      }
      for (const fn of functions) {
        const rights = (await f.db.query('select has_function_privilege($1,$2,$3) as allowed', [role, fn, 'EXECUTE'])).rows[0].allowed;
        assert.equal(rights, role === 'service_role', role + ' function ' + fn);
      }
    }
    await f.db.exec("set role service_role;select set_config('request.jwt.claim.role','',false);");
    await assert.rejects(f.db.query("select public.portable_workstation_command('list',$1::jsonb,'{}')", [JSON.stringify(f.staff())]), /Server authority required/);
    await f.db.exec('reset role');
  } finally { await f.close(); }
});
