import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const sql = await readFile(new URL('../supabase/migrations/20261020050000_staff_online_access_proof.sql', import.meta.url), 'utf8');
const baseline = await readFile(new URL('../supabase/migrations/202607240001_account_salon_baseline.sql', import.meta.url), 'utf8');
const bindingSQL = await readFile(new URL('../supabase/migrations/20261016080000_staff_offline_binding_attestation.sql', import.meta.url), 'utf8');
const definition = (source, name) => {
  const match = source.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, `Existing function ${name}`); return match[0];
};
const table = (source, name) => {
  const match = source.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, 'i'));
  assert.ok(match, `Existing table ${name}`); return match[0];
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('Staff online proof reads exact current identity and truly absent attestation without changing business rows or authority', { timeout: 60000 }, async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role unrelated_client;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    ${table(baseline, 'users')}
    ${table(baseline, 'accounts')}
    ${table(baseline, 'locations')}
    ${table(baseline, 'staff')}
    ${table(bindingSQL, 'staff_offline_bindings')}
    ${definition(baseline, 'current_public_user_id')}
    ${definition(bindingSQL, 'get_my_staff_offline_binding')}
    revoke all on function public.get_my_staff_offline_binding(uuid) from public,anon,authenticated;
    grant execute on function public.get_my_staff_offline_binding(uuid) to authenticated;
    alter table users enable row level security;
    alter table accounts enable row level security;
    alter table locations enable row level security;
    alter table staff enable row level security;
    alter table staff_offline_bindings enable row level security;
    revoke all on all tables in schema public from public,anon,authenticated,unrelated_client;
    grant select on staff_offline_bindings to authenticated;
    create policy staff_offline_binding_read on staff_offline_bindings for select to authenticated
      using(viewer_user_id=public.current_public_user_id());
  `);
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'users',(select jsonb_agg(to_jsonb(t) order by id) from users t),
    'accounts',(select jsonb_agg(to_jsonb(t) order by id) from accounts t),
    'locations',(select jsonb_agg(to_jsonb(t) order by id) from locations t),
    'staff',(select jsonb_agg(to_jsonb(t) order by id) from staff t),
    'bindings',(select jsonb_agg(to_jsonb(t) order by staff_id) from staff_offline_bindings t)) data`)).rows[0].data;
  const fixture = async () => db.exec(`
    truncate staff_offline_bindings,staff,locations,accounts,users cascade;
    insert into users(id,auth_user_id,status) values('${id(1)}','${id(101)}','active'),('${id(2)}','${id(102)}','active'),('${id(3)}','${id(103)}','active');
    insert into accounts(id,name,status) values('${id(10)}','Fixture','active'),('${id(11)}','Other','active');
    insert into locations(id,account_id,name,status) values('${id(20)}','${id(10)}','Fixture','active'),('${id(21)}','${id(11)}','Other','active');
    insert into staff(id,salon_id,account_user_id,display_name,is_active) values('${id(30)}','${id(20)}','${id(1)}','Fixture',true);
  `);
  const insertBinding = (changes = {}) => {
    const fields = { staff_id:id(30),salon_id:id(20),viewer_user_id:id(1),approved_by_user_id:id(3),revision:id(50),approved_at:'2026-01-01T00:00:00Z',...changes };
    return `insert into staff_offline_bindings(${Object.keys(fields).join(',')}) values(${Object.values(fields).map(value => value === null ? 'null' : `'${value}'`).join(',')})`;
  };
  await fixture();
  const beforeMigration = await snapshot();
  const oldDefinition = (await db.query("select pg_get_functiondef('public.get_my_staff_offline_binding(uuid)'::regprocedure) definition")).rows[0].definition;
  const rlsBefore = (await db.query("select relname,relrowsecurity from pg_class where relname in ('users','accounts','locations','staff','staff_offline_bindings') order by relname")).rows;
  await db.exec(sql);
  assert.deepEqual(await snapshot(), beforeMigration);
  assert.equal((await db.query("select pg_get_functiondef('public.get_my_staff_offline_binding(uuid)'::regprocedure) definition")).rows[0].definition, oldDefinition);
  assert.deepEqual((await db.query("select relname,relrowsecurity from pg_class where relname in ('users','accounts','locations','staff','staff_offline_bindings') order by relname")).rows, rlsBefore);

  const read = async ({ role = 'authenticated', auth = id(101), staffId = id(30), salonId = id(20), accountId = id(10), query } = {}) => {
    await db.exec('begin read only');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [auth]);
      await db.exec(`set local role ${role}`);
      return (await db.query(query ?? 'select public.get_my_staff_online_access($1::uuid,$2::uuid,$3::uuid) proof', query ? [] : [staffId,salonId,accountId])).rows;
    } finally { await db.exec('rollback'); }
  };
  const scenarios = [
    { name:'active unique direct link and genuinely absent attestation',state:'missing' },
    { name:'active unique legacy link with null direct account',mutate:`update staff set account_user_id=null,user_id='${id(101)}'`,state:'missing' },
    { name:'different salon link does not make own salon ambiguous',mutate:`insert into staff(id,salon_id,account_user_id,display_name) values('${id(31)}','${id(21)}','${id(1)}','Other')`,state:'missing' },
    { name:'inactive duplicate does not revoke unique active link',mutate:`insert into staff(id,salon_id,account_user_id,display_name,is_active) values('${id(31)}','${id(20)}','${id(1)}','Inactive',false)`,state:'missing' },
    { name:'approved attestation is not absence',mutate:insertBinding(),state:'binding-present' },
    { name:'revoked attestation remains revoked',mutate:insertBinding({revoked_at:'2026-01-02T00:00:00Z'}),state:'revoked' },
    { name:'wrong-viewer binding invisible through RLS cannot become absence',mutate:insertBinding({viewer_user_id:id(2)}),state:'denied',invisibleBinding:true },
    { name:'wrong-salon binding cannot become absence',mutate:insertBinding({salon_id:id(21)}),state:'denied' },
    { name:'future approval cannot become absence',mutate:insertBinding({approved_at:'2999-01-01T00:00:00Z'}),state:'denied' },
    { name:'infinite approval cannot become absence',mutate:insertBinding({approved_at:'infinity'}),state:'denied' },
    { name:'legacy auth match may not override another direct account',mutate:`update staff set account_user_id='${id(2)}',user_id='${id(101)}'`,state:'denied' },
    { name:'duplicate direct links denied',mutate:`insert into staff(id,salon_id,account_user_id,display_name) values('${id(31)}','${id(20)}','${id(1)}','Duplicate')`,state:'denied' },
    { name:'direct plus valid legacy links denied together',mutate:`insert into staff(id,salon_id,account_user_id,user_id,display_name) values('${id(31)}','${id(20)}',null,'${id(101)}','Duplicate')`,state:'denied' },
    { name:'two legacy links denied',mutate:`update staff set account_user_id=null,user_id='${id(101)}'; insert into staff(id,salon_id,account_user_id,user_id,display_name) values('${id(31)}','${id(20)}',null,'${id(101)}','Duplicate')`,state:'denied' },
    ...['inactive','suspended','deleted','pending_deletion'].map(status=>({name:`${status} current user denied`,mutate:`update users set status='${status}' where id='${id(1)}'`,state:'denied'})),
    { name:'inactive Staff denied',mutate:'update staff set is_active=false',state:'denied' },
    { name:'inactive salon denied',mutate:`update locations set status='inactive' where id='${id(20)}'`,state:'denied' },
    { name:'inactive account denied',mutate:`update accounts set status='inactive' where id='${id(10)}'`,state:'denied' },
    { name:'wrong account argument denied',options:{accountId:id(11)},state:'denied' },
    { name:'wrong salon argument denied',options:{salonId:id(21)},state:'denied' },
    { name:'unknown Staff denied',options:{staffId:id(99)},state:'denied' },
    { name:'null argument denied',options:{staffId:null},state:'denied' },
    { name:'another authenticated user cannot acquire first Staff proof',options:{auth:id(102)},state:'denied' },
    { name:'unmapped auth user denied',options:{auth:id(199)},state:'denied' },
    { name:'authenticated role without auth identity denied',options:{auth:''},state:'denied' },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    await fixture(); if(scenario.mutate)await db.exec(scenario.mutate);
    const before = await snapshot(), proof = (await read(scenario.options))[0].proof;
    assert.equal(proof.version,1); assert.equal(proof.state,scenario.state);
    if(scenario.state === 'missing') assert.deepEqual(proof,{version:1,state:'missing',staffId:id(30),viewerId:id(1),salonId:id(20),accountId:id(10)});
    if(proof.state==='denied')assert.equal('binding' in proof,false);
    if(scenario.invisibleBinding)assert.deepEqual(await read({query:'select * from public.staff_offline_bindings'}),[]);
    assert.deepEqual(await snapshot(),before,'Proof is executed in a real read-only transaction without row changes');
  });
  await t.test('only authenticated may execute; definer identity and stable read-only mode are explicit', async () => {
    const definition=(await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid='public.get_my_staff_online_access(uuid,uuid,uuid)'::regprocedure")).rows[0];
    assert.equal(definition.prosecdef,true);assert.equal(definition.provolatile,'s');assert.deepEqual(definition.proconfig,['search_path=public']);
    for(const role of ['anon','unrelated_client']){
      await assert.rejects(read({role}),error=>error.code==='42501');
      assert.equal((await db.query("select has_function_privilege($1,'public.get_my_staff_online_access(uuid,uuid,uuid)','execute') allowed",[role])).rows[0].allowed,false);
    }
    assert.equal((await db.query("select has_function_privilege('authenticated','public.get_my_staff_online_access(uuid,uuid,uuid)','execute') allowed")).rows[0].allowed,true);
    await assert.rejects(read({query:'select * from public.staff'}),error=>error.code==='42501');
    await assert.rejects(read({query:`insert into public.staff_offline_bindings(staff_id,salon_id,viewer_user_id,approved_by_user_id) values('${id(30)}','${id(20)}','${id(1)}','${id(1)}')`}),error=>['42501','25006'].includes(error.code));
  });
});
