import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const migration = await readFile(new URL('../supabase/migrations/20261019220000_hidden_posts_actor_reads.sql', import.meta.url), 'utf8');
const source = async file => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const baseline = await source('202607240001_account_salon_baseline.sql');
const abuse = await source('202610070008_abuse_prevention.sql');
const persistence = await source('202610070009_report_persistence.sql');
const blocking = await source('202610140002_user_blocking.sql');
const definition = (sql, name) => {
  const escaped = name.replaceAll('.', '\\.');
  const match = sql.match(new RegExp(`create (?:or replace )?function ${escaped}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `Existing SQL definition ${name}`);
  return match[0];
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const signedHeaders = (device = 'a'.repeat(64), { valid = true, expired = false } = {}) => {
  const payload = `${device}||US|${Math.floor(Date.now() / 1000) - (expired ? 1000 : 0)}`;
  return JSON.stringify({
    'x-reylumi-safety': payload,
    'x-reylumi-safety-signature': valid ? createHmac('sha256', 'local-fixture-secret').update(payload).digest('hex') : '0'.repeat(64),
  });
};

test('hidden posts retain signed guest, account and block semantics without scanning unrelated authors', { timeout: 60000 }, async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role unrelated_client; create role service_role;
    create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    grant usage on schema auth to anon,authenticated;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table users(id uuid primary key,auth_user_id uuid unique);
    create table abuse_system_settings(id boolean primary key,signing_key text);
    insert into abuse_system_settings values(true,'local-fixture-secret');
    create table post_safety_hidden(user_id uuid,source_type text,source_id uuid,primary key(user_id,source_type,source_id));
    create table post_safety_guest_hidden(guest_key uuid,source_type text,source_id uuid,primary key(guest_key,source_type,source_id));
    create table beauty_posts(id uuid primary key,author_user_id uuid);
    create index beauty_posts_author_idx on beauty_posts(author_user_id);
    create table salon_profile_looks(id uuid primary key,author_user_id uuid);
    create table salon_profile_updates(id uuid primary key,author_user_id uuid);
    alter table post_safety_hidden enable row level security;
    alter table post_safety_guest_hidden enable row level security;
    alter table beauty_posts enable row level security;
    alter table salon_profile_looks enable row level security;
    alter table salon_profile_updates enable row level security;
    create sequence fixture_identity_calls;
    ${definition(baseline, 'public.current_public_user_id').replace('public.current_public_user_id()', 'public.fixture_current_public_user_id()')}
    -- Instrument only the boundary; the resolved identity still comes from the
    -- unchanged production function and auth.uid(). nextval gives deterministic
    -- work counts, avoiding a hardware-dependent latency threshold.
    create function public.current_public_user_id() returns uuid language plpgsql stable security definer set search_path=public as $$
      begin perform nextval('fixture_identity_calls'); return public.fixture_current_public_user_id(); end $$;
    ${definition(abuse, 'public.abuse_signed_context')}
    ${definition(persistence, 'public.get_my_hidden_posts')}
    revoke all on function public.get_my_hidden_posts() from public;
    grant execute on function public.get_my_hidden_posts() to anon,authenticated;
    ${blocking.slice(blocking.indexOf('create table public.user_blocks'), blocking.indexOf('create function public.social_user_is_blocked'))}
    ${blocking.slice(blocking.indexOf('alter function public.get_my_hidden_posts()'), blocking.indexOf('-- Triggers also protect'))}
    grant execute on function public.get_my_hidden_posts() to service_role;
    insert into users select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      ('00000000-0000-4000-8000-'||lpad((i+100)::text,12,'0'))::uuid from generate_series(1,5) i;
    insert into user_blocks(blocker_user_id,blocked_user_id) values('${id(1)}','${id(2)}'),('${id(2)}','${id(1)}'),('${id(3)}','${id(1)}'),('${id(4)}','${id(2)}');
    insert into beauty_posts values('${id(201)}','${id(2)}'),('${id(202)}','${id(3)}'),('${id(203)}','${id(4)}'),('${id(204)}',null);
    insert into salon_profile_looks values('${id(211)}','${id(2)}'),('${id(212)}','${id(3)}'),('${id(213)}','${id(4)}');
    insert into salon_profile_updates values('${id(221)}','${id(2)}'),('${id(222)}','${id(3)}'),('${id(223)}','${id(4)}');
    insert into post_safety_hidden values('${id(1)}','beauty_post','${id(201)}'),('${id(1)}','beauty_post','${id(203)}'),('${id(1)}','beauty_post','${id(299)}'),('${id(2)}','salon_profile_update','${id(223)}');
    insert into post_safety_guest_hidden values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','beauty_post','${id(203)}'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','salon_profile_look','${id(211)}');
    revoke all on all tables in schema public from public,anon,authenticated,unrelated_client;
  `);
  const scenarios = [
    { name: 'outgoing, reciprocal and incoming blocks with overlapping explicit hide', role: 'authenticated', auth: id(101) },
    { name: 'other account cannot read first account explicit hides', role: 'authenticated', auth: id(102) },
    { name: 'incoming-only block', role: 'authenticated', auth: id(103) },
    { name: 'unrelated actor with an outgoing block', role: 'authenticated', auth: id(104) },
    { name: 'account without blocks', role: 'authenticated', auth: id(105) },
    { name: 'signed guest device A', role: 'anon', headers: signedHeaders() },
    { name: 'signed guest device B', role: 'anon', headers: signedHeaders('b'.repeat(64)) },
    { name: 'guest without signed identity', role: 'anon' },
    { name: 'invalid guest signature', role: 'anon', headers: signedHeaders('a'.repeat(64), { valid: false }) },
    { name: 'expired guest signature', role: 'anon', headers: signedHeaders('a'.repeat(64), { expired: true }) },
    { name: 'signed in actor ignores unrelated guest hides', role: 'authenticated', auth: id(105), headers: signedHeaders() },
    { name: 'unmapped JWT retains original signed-guest resolution', role: 'authenticated', auth: id(199), headers: signedHeaders() },
  ];
  async function as(scenario, sql = 'select * from public.get_my_hidden_posts() order by source_type,source_id') {
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.headers',$2,false)", [scenario.auth ?? '', scenario.headers ?? '{}']);
    await db.exec(`set role ${scenario.role}`);
    try { return await db.query(sql); } finally { await db.exec('reset role'); }
  }
  async function boundaries() {
    return (await db.query(`select p.proname,p.proowner::regrole::text owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('get_my_hidden_posts','get_my_hidden_posts_before_blocks','abuse_signed_context') order by p.proname`)).rows;
  }
  const before = [];
  for (const scenario of scenarios) before.push((await as(scenario)).rows);
  assert.deepEqual(before[5], [{ source_type: 'beauty_post', source_id: id(203) }]);
  assert.deepEqual(before[6], [{ source_type: 'salon_profile_look', source_id: id(211) }]);
  for (const index of [4, 7, 8, 9, 10]) assert.deepEqual(before[index], []);
  assert.equal(before[0].length, 8);
  const securityBefore = await boundaries();
  const policyBefore = (await db.query("select relname,relrowsecurity from pg_class where relname in ('user_blocks','post_safety_hidden','post_safety_guest_hidden','beauty_posts','salon_profile_looks','salon_profile_updates') order by relname")).rows;
  const dataBefore = await db.query(`select (select jsonb_agg(to_jsonb(t) order by t.user_id,t.source_type,t.source_id) from post_safety_hidden t) hides,
    (select jsonb_agg(to_jsonb(t) order by t.guest_key,t.source_type,t.source_id) from post_safety_guest_hidden t) guest_hides,
    (select jsonb_agg(to_jsonb(t) order by t.blocker_user_id,t.blocked_user_id) from user_blocks t) blocks`);
  // A public catalog has 6,000 posts from 2,000 unrelated authors. Before migration,
  // even an anonymous request reevaluates identity across every social row.
  await db.exec(`insert into users select ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
    ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,2000) i`);
  for (const table of ['beauty_posts', 'salon_profile_looks', 'salon_profile_updates']) {
    await db.exec(`insert into ${table} select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
      ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,2000) i`);
  }
  await db.exec('alter sequence fixture_identity_calls restart with 1');
  await as(scenarios[7]);
  const oldCalls = Number((await db.query('select last_value from fixture_identity_calls')).rows[0].last_value);
  assert.ok(oldCalls >= 6000, `Baseline identity reads unexpectedly bounded: ${oldCalls}`);
  await db.exec(migration);
  await t.test('original result sets match for every account and signed-guest boundary', async () => {
    for (let i = 0; i < scenarios.length; i++) assert.deepEqual((await as(scenarios[i])).rows, before[i], scenarios[i].name);
  });
  await t.test('guest and account-without-blocks do bounded identity work despite unrelated posts', async () => {
    for (const scenario of [scenarios[7], scenarios[5], scenarios[4], scenarios[0]]) {
      await db.exec('alter sequence fixture_identity_calls restart with 1');
      await as(scenario);
      const calls = Number((await db.query('select last_value from fixture_identity_calls')).rows[0].last_value);
      assert.ok(calls <= 2, `${scenario.name}: ${calls} identity resolutions after migration`);
    }
    t.diagnostic(`Actual SQL baseline guest: ${oldCalls} identity resolutions; migrated guest/no-block account: at most 2.`);
  });
  await t.test('blocked-actor query visits matching authors through indexes in a multi-author catalog', async () => {
    const query = migration.match(/return query\s+(with blocked_users[\s\S]*?);/i)?.[1].replace(/\bactor\b/g, '$1::uuid');
    assert.ok(query, 'Explain the actual migrated read body');
    await db.exec('analyze user_blocks; analyze beauty_posts; analyze salon_profile_looks; analyze salon_profile_updates');
    const plan = (await db.query(`explain (analyze,buffers,format json) ${query}`, [id(1)])).rows[0]['QUERY PLAN'][0].Plan;
    const nodes = [];
    const visit = node => { nodes.push(node); for (const child of node.Plans ?? []) visit(child); };
    visit(plan);
    const socialReads = nodes.filter(node => ['beauty_posts', 'salon_profile_looks', 'salon_profile_updates'].includes(node['Relation Name']));
    assert.equal(socialReads.length, 3);
    for (const read of socialReads) {
      assert.match(read['Node Type'], /Index|Bitmap/);
      assert.ok(read['Actual Rows'] * read['Actual Loops'] <= 6, `${read['Relation Name']} visited unrelated rows`);
    }
  });
  await t.test('function authority, signed-guest helper and table RLS remain intact', async () => {
    assert.deepEqual(await boundaries(), securityBefore);
    assert.deepEqual((await db.query("select relname,relrowsecurity from pg_class where relname in ('user_blocks','post_safety_hidden','post_safety_guest_hidden','beauty_posts','salon_profile_looks','salon_profile_updates') order by relname")).rows, policyBefore);
    for (const role of ['anon', 'authenticated']) {
      const rights = (await db.query("select has_function_privilege($1,'public.get_my_hidden_posts()','execute') allowed,has_function_privilege($1,'public.get_my_hidden_posts_before_blocks()','execute') helper", [role])).rows[0];
      assert.deepEqual(rights, { allowed: true, helper: false });
      for (const table of ['user_blocks', 'post_safety_hidden', 'post_safety_guest_hidden']) {
        await assert.rejects(as({ role }, `select * from public.${table}`), error => error.code === '42501');
      }
    }
    await assert.rejects(as({ role: 'unrelated_client' }), error => error.code === '42501');
    assert.deepEqual((await db.query(`select (select jsonb_agg(to_jsonb(t) order by t.user_id,t.source_type,t.source_id) from post_safety_hidden t) hides,
      (select jsonb_agg(to_jsonb(t) order by t.guest_key,t.source_type,t.source_id) from post_safety_guest_hidden t) guest_hides,
      (select jsonb_agg(to_jsonb(t) order by t.blocker_user_id,t.blocked_user_id) from user_blocks t) blocks`)).rows, dataBefore.rows);
  });
  await t.test('reapplying migration preserves result and authority', async () => {
    await db.exec(migration);
    assert.deepEqual(await boundaries(), securityBefore);
    assert.deepEqual((await as(scenarios[0])).rows, before[0]);
  });
});
