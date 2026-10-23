import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const read=name=>readFileSync(`supabase/migrations/${name}`,'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manifest=(extra={})=>({manifestSchemaVersion:1,appVersion:'1.0.0',displayName:'Private example',description:'Private metadata only.',requestedCapabilities:[],...extra});
const assertConflict=(operation,message)=>assert.rejects(operation,error=>{
 assert.equal(error.code,'PT409','Domain conflicts must not use retryable serialization SQLSTATE 40001');
 assert.match(error.message,message);return true;
});
function actualFunction(file,name){
 const text=read(file), start=text.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`,'i'));
 assert.ok(start>=0,`Missing ${name}`); const end=text.indexOf('$$;',text.indexOf('as $$',start));
 assert.ok(end>=0);return text.slice(start,end+3);
}

async function fixture(){
 const db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.users(id uuid primary key,auth_user_id uuid unique,status text not null default 'active',email text,display_name text,first_name text,last_name text);
 create table public.locations(id uuid primary key,status text not null default 'active',owner_id uuid references users(id),name text not null default 'Fixture salon');
 create table public.platform_admin_roles(id uuid primary key,slug text);
 create table public.platform_admin_permissions(id uuid primary key,code text);
 create table public.platform_admin_role_permissions(role_id uuid,permission_id uuid);
 create table public.platform_admin_memberships(id uuid primary key,user_id uuid,role_id uuid,status text);
 create table public.platform_admin_audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid references users(id),action text,target_type text,target_id uuid,metadata jsonb default '{}');
 create function public.lifecycle_user_is_salon_owner(p_salon uuid,p_user uuid,p_dummy boolean) returns boolean language sql stable security definer as $$select exists(select 1 from locations where id=p_salon and owner_id=p_user)$$;
 create table vietnamese_plugin_subscriptions(salon_id uuid primary key references locations(id),installed boolean default true,staff_enabled boolean default false,portable_enabled boolean default false,trial_ends_at timestamptz default now()+interval '5 days',paid_until timestamptz,stripe_subscription text,stripe_customer text,payment_owner uuid,checkout_reference uuid,checkout_owner uuid,checkout_session text,updated_at timestamptz default now());
 create table booking_policy_subscriptions(salon_id uuid primary key references locations(id),content text default '',published boolean default false,paid_until timestamptz,stripe_subscription text,stripe_checkout text,checkout_reference uuid default gen_random_uuid(),stripe_customer text,payment_owner uuid,updated_at timestamptz default now());
 create table booking_deposit_subscriptions(salon_id uuid primary key references locations(id),enabled boolean default false,installed boolean default false,mode text default 'fixed',value numeric default 20,checkout text default 'both',stripe_account text,paid_until timestamptz,stripe_subscription text,stripe_checkout text,checkout_reference uuid default gen_random_uuid(),stripe_customer text,payment_owner uuid,updated_at timestamptz default now());
 create table checkin_receipt_subscriptions(salon_id uuid primary key references locations(id),stripe_subscription text,stripe_checkout text,stripe_customer text,payment_owner uuid,paid_until timestamptz,updated_at timestamptz default now());
 create table market_payment_settings(id boolean primary key default true,vietnamese_published boolean default true);insert into market_payment_settings values(true,true);
 `);
 await db.exec(actualFunction('202607240001_account_salon_baseline.sql','current_public_user_id'));
 for(const name of ['platform_admin_has_permission','platform_admin_current_actor','platform_admin_require_permission']) await db.exec(actualFunction('202608300004_platform_admin_current_schema.sql',name));
 for(let n=1;n<=8;n++)await db.query('insert into users(id,auth_user_id,display_name) values($1,$2,$3)',[id(n),id(100+n),`Fixture ${n}`]);
 await db.query('insert into locations(id,owner_id) values($1,$2)',[id(20),id(1)]);
 for(const name of ['20261009160001_market_commerce_configuration.sql','20261009180001_market_bank_billing.sql','20261010210001_market_card_system.sql','20261011010001_market_automatic_tax.sql'])await db.exec(read(name));
 const financialTables=['market_billing_catalog','market_billing_settings','market_bank_accounts','market_bank_orders','market_bank_receipts','market_bank_refunds','market_bank_ledger','market_card_purchases','market_card_invoices','market_card_events','platform_payment_settings','vietnamese_plugin_subscriptions','booking_policy_subscriptions','booking_deposit_subscriptions','checkin_receipt_subscriptions'];
 const financialSnapshot=async()=>{const out={};for(const table of financialTables)out[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from ${table} t`)).rows[0].value;return out;};
 const before=await financialSnapshot();
 await db.exec(read('20261022180001_market_private_registry.sql'));
 await db.query("insert into market_private.publishers(id,owner_user_id,name) values($1,$2,'Publisher A'),($3,$4,'Publisher B')",[id(31),id(1),id(32),id(2)]);
 await db.query('insert into market_private.reviewers(user_id) values($1),($2)',[id(3),id(1)]);
 const actor=async(n,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(100+n):'']);await db.exec(`set role ${role}`);};
 const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
 const rpc=async(name,args=[],types=[])=>value(`select public.${name}(${args.map((_,i)=>`$${i+1}${types[i]?`::${types[i]}`:''}`).join(',')}) value`,args.map(x=>x&&typeof x==='object'?JSON.stringify(x):x));
 const create=async(payload=manifest())=>rpc('market_registry_save_draft',[null,0,payload],['uuid','int','jsonb']);
 const submit=async(app)=>rpc('market_registry_submit',[app.id,app.draft_version],['uuid','int']);
 const review=async(sub,decision='metadata_approved',reason='Metadata is complete.')=>rpc('market_registry_review',[sub.id,sub.draft_version,sub.manifest_hash,decision,reason],['uuid','int','text','text','text']);
 return {db,actor,rpc,value,create,submit,review,before,financialSnapshot};
}

test('private metadata registry: actual roles, tenant authorization, immutable review, erasure and zero legacy writes',{timeout:120000},async t=>{
 const f=await fixture();const {db,actor,rpc,value,create,submit,review}=f;let app,sub;
 try{
 await t.test('gate defaults disabled; anonymous and service role cannot invoke entrypoints',async()=>{
  await actor(1);await assert.rejects(rpc('market_registry_workspace'),/unavailable/);
  await actor(null,'anon');await assert.rejects(rpc('market_registry_workspace'),/permission denied/);
  await actor(1,'service_role');await assert.rejects(rpc('market_registry_workspace'),/permission denied/);
  await db.exec('reset role;update market_private.settings set enabled=true');
 });
 await t.test('auth.uid mapping is real; roles cannot read/write private tables or call helpers',async()=>{
  await actor(1);assert.equal(await value('select public.current_public_user_id() value'),id(1));
  await assert.rejects(db.query('select * from market_private.publishers'),/permission denied/);
  await assert.rejects(db.query("update market_private.settings set enabled=true"),/permission denied/);
  await assert.rejects(db.query('select market_private.require_actor()'),/permission denied/);
  await actor(4);await assert.rejects(rpc('market_registry_workspace'),/unavailable/);
  await assert.rejects(rpc('market_registry_review_queue'),/unavailable/);
  // Even an accidental table SELECT grant would expose no rows because RLS has no policies.
  await db.exec('reset role;grant usage on schema market_private to authenticated;grant select on market_private.publishers to authenticated;set role authenticated');
  assert.equal(await value('select count(*)::int value from market_private.publishers'),0);
  await db.exec('reset role;revoke usage on schema market_private from authenticated;revoke select on market_private.publishers from authenticated');
 });
 await t.test('server owns identity; strict manifests reject authority, capabilities and invalid input',async()=>{
  await actor(1);
  for(const payload of [null,[],manifest({registry_key:'vietnamese-language'}),manifest({publisher_id:id(32)}),manifest({status:'metadata_approved'}),manifest({manifestSchemaVersion:2}),manifest({requestedCapabilities:['customers:read']}),manifest({displayName:'a'.repeat(101)}),manifest({description:'a'.repeat(2001)}),manifest({appVersion:'01.0.0'}),manifest({displayName:'two\nlines'})])await assert.rejects(create(payload),/manifest|metadata|version|length/i);
  app=await create(manifest({displayName:'  Cafe\u0301  '}));assert.match(app.registry_key,new RegExp(`^external-${app.id}$`));
  const state=await rpc('market_registry_workspace');assert.equal(state.apps[0].draft_manifest.displayName,'Café');assert.equal(state.apps[0].draft_version,1);
  await assert.rejects(rpc('market_registry_save_draft',[id(88),0,manifest()],['uuid','int','jsonb']),/unavailable/);
  await assertConflict(rpc('market_registry_save_draft',[null,1,manifest()],['uuid','int','jsonb']),/changed/);
  for(const appVersion of ['1.0.0-01','1.0.0-alpha.01','1.0.0-','1.0.0+','1.0.0+a..b'])await assert.rejects(create(manifest({appVersion})),/version/);
  const semver=await create(manifest({appVersion:'1.2.3-alpha.0+build.001',displayName:'\u00a0Build preview\u3000',description:'\tPreview\r\n'}));
  const normalized=(await rpc('market_registry_workspace')).apps.find(x=>x.id===semver.id).draft_manifest;
  assert.equal(normalized.appVersion,'1.2.3-alpha.0+build.001');assert.equal(normalized.displayName,'Build preview');assert.equal(normalized.description,'Preview');
 });
 await t.test('publisher B cannot read, change, submit or withdraw publisher A records',async()=>{
  await actor(2);assert.deepEqual((await rpc('market_registry_workspace')).apps,[]);
  await assert.rejects(rpc('market_registry_save_draft',[app.id,1,manifest()],['uuid','int','jsonb']),/unavailable/);
  await assert.rejects(submit(app),/unavailable/);
  await actor(1);sub=await submit(app);
  await actor(2);await assert.rejects(rpc('market_registry_withdraw',[sub.id,sub.manifest_hash]),/unavailable/);
 });
 await t.test('submission freezes normalized bytes/hash; repeat submit is idempotent and edits are blocked',async()=>{
  await actor(1);assert.equal((await submit(app)).id,sub.id);
  await assertConflict(rpc('market_registry_save_draft',[app.id,1,manifest({description:'changed'})],['uuid','int','jsonb']),/Withdraw/);
  await db.exec('reset role');const stored=(await db.query('select * from market_private.submissions where id=$1',[sub.id])).rows[0];
  assert.equal(createHash('sha256').update(stored.canonical_manifest,'utf8').digest('hex'),stored.manifest_hash);
  assert.equal(stored.canonicalization,'reylumi-manifest-pg-jsonb-v1');
  assert.equal(await value("select count(*)::int value from market_private.events where event_type='submitted'"),1);
  await assert.rejects(db.query("update market_private.submissions set manifest='{}' where id=$1",[sub.id]),/immutable|constraint/);
  await assert.rejects(db.query('delete from market_private.submissions where id=$1',[sub.id]),/append-only/);
  const reversed=Object.fromEntries(Object.entries(manifest({displayName:'Café'})).reverse());
  await actor(1);const other=await create(reversed);const second=await submit(other);assert.equal(second.manifest_hash,sub.manifest_hash);
 });
 await t.test('reviewer sees only submitted immutable data and inherits no financial authority',async()=>{
  await actor(1);const draft=await create(manifest({displayName:'Never submitted'}));assert.ok(draft.id);
  assert.deepEqual((await rpc('market_registry_review_queue')).submissions,[]);await assert.rejects(review(sub),/unavailable/);
  await actor(3);const queue=(await rpc('market_registry_review_queue')).submissions;assert.equal(queue.length,2);assert.ok(queue.every(x=>x.status==='submitted'&&x.publisher_name==='Publisher A'));
  assert.ok(!JSON.stringify(queue).includes('Never submitted'));
  assert.equal(await value("select public.platform_admin_has_permission('admin.team.manage') value"),false);
  await assert.rejects(rpc('market_billing_admin_state'),/permission denied|owner access/);
  await assert.rejects(db.query('select * from platform_payment_settings'),/permission denied/);
  await assert.rejects(rpc('market_registry_workspace'),/unavailable/);
 });
 await t.test('review binds version/hash; exact retry succeeds, conflicting or withdrawn outcomes fail',async()=>{
  await actor(3);await assertConflict(rpc('market_registry_review',[sub.id,2,sub.manifest_hash,'metadata_approved','Ready'],['uuid','int','text','text','text']),/changed/);
  await assertConflict(rpc('market_registry_review',[sub.id,1,'0'.repeat(64),'metadata_approved','Ready'],['uuid','int','text','text','text']),/changed/);
  for(const reason of ['\t\t\t','\n\r\n','\u00a0\u00a0\u00a0','\t\n\r\u00a0\u3000',' \tno\u00a0 '])await assert.rejects(review(sub,'metadata_approved',reason),/reason/);
  const normalizedReview=await review(sub,'metadata_approved','\t Metadata is complete.\r\n\u00a0');
  assert.equal(normalizedReview.review.reason,'Metadata is complete.');assert.equal(normalizedReview.status,'metadata_approved');assert.equal((await review(sub)).status,'metadata_approved');
  await assertConflict(review(sub,'rejected','Different outcome'),/already/);
  await actor(1);const edited=await rpc('market_registry_save_draft',[app.id,1,manifest({description:'New revision'})],['uuid','int','jsonb']);assert.equal(edited.draft_version,2);
  await assertConflict(rpc('market_registry_withdraw',[sub.id,sub.manifest_hash]),/already/);
  await assertConflict(submit(app),/changed/);const next=await submit(edited);
  await assertConflict(rpc('market_registry_withdraw',[next.id,'0'.repeat(64)]),/changed/);
  assert.equal((await rpc('market_registry_withdraw',[next.id,next.manifest_hash])).status,'withdrawn');
  assert.equal((await rpc('market_registry_withdraw',[next.id,next.manifest_hash])).status,'withdrawn');
  await actor(3);await assertConflict(review(next),/already/);
 });
 await t.test('direct immutable mutation cannot impersonate nested erasure or alter audit history',async()=>{
  await db.exec('reset role');
  await assert.rejects(db.query('update market_private.submissions set manifest=null,canonical_manifest=null,erased_at=now() where id=$1',[sub.id]),/immutable/);
  await assert.rejects(db.query('update market_private.resolutions set reason=null,erased_at=now() where submission_id=$1',[sub.id]),/immutable/);
  await assert.rejects(db.query("update market_private.resolutions set reason='Modified later' where submission_id=$1",[sub.id]),/immutable/);
  await assert.rejects(db.query("update market_private.events set metadata='{}' where submission_id=$1",[sub.id]),/immutable/);
  await assert.rejects(db.query('delete from market_private.resolutions where submission_id=$1',[sub.id]),/append-only/);
  await assert.rejects(db.query('delete from market_private.events where submission_id=$1',[sub.id]),/append-only/);
  await actor(3);await assert.rejects(db.query('select market_private.erase_user_metadata()'),/permission denied/);
 });
 await t.test('queued optimistic saves/decisions settle once; an audit failure rolls back the outcome',async()=>{
  // PGlite queues these calls on one connection: this checks stale-operation
  // outcomes, not lock correctness across simultaneous PostgreSQL connections.
  await actor(2);const target=await create();
  const saves=await Promise.allSettled([rpc('market_registry_save_draft',[target.id,1,manifest({description:'A'})],['uuid','int','jsonb']),rpc('market_registry_save_draft',[target.id,1,manifest({description:'B'})],['uuid','int','jsonb'])]);
  assert.equal(saves.filter(x=>x.status==='fulfilled').length,1);assert.equal(saves.filter(x=>x.status==='rejected').length,1);
  assert.equal(saves.find(x=>x.status==='rejected').reason.code,'PT409');
  const pending=await submit({...target,draft_version:2});await actor(3);
  await db.exec(`reset role;create function market_private.fixture_fail_audit() returns trigger language plpgsql as $$begin if new.event_type='metadata_approved' then raise exception 'fixture audit failure';end if;return new;end$$;create trigger fixture_fail_audit before insert on market_private.events for each row execute function market_private.fixture_fail_audit();set role authenticated`);
  await assert.rejects(review(pending),/audit failure/);
  await db.exec('reset role');assert.equal(await value('select count(*)::int value from market_private.resolutions where submission_id=$1',[pending.id]),0);
  await db.exec('drop trigger fixture_fail_audit on market_private.events;drop function market_private.fixture_fail_audit()');await actor(3);
  const outcomes=await Promise.allSettled([review(pending),review(pending,'rejected','Conflicting review')]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'PT409');
 });
 await t.test('inactive, suspended, pending deletion, deleted and revoked actors fail closed',async()=>{
  for(const status of ['inactive','suspended','pending_deletion']){
   await db.exec('reset role');await db.query('update users set status=$1 where id=$2',[status,id(2)]);await actor(2);await assert.rejects(rpc('market_registry_workspace'),/unavailable/);
   await db.exec('reset role');await db.query("update users set status='active' where id=$1",[id(2)]);
   await db.query('update users set status=$1 where id=$2',[status,id(3)]);await actor(3);await assert.rejects(rpc('market_registry_review_queue'),/unavailable/);
   await db.exec('reset role');await db.query("update users set status='active' where id=$1",[id(3)]);
  }
  await db.exec('reset role');await db.query('update market_private.reviewers set active=false where user_id=$1',[id(3)]);await actor(3);await assert.rejects(review(sub),/unavailable/);
  await db.exec('reset role');await db.query('update market_private.reviewers set active=true where user_id=$1',[id(3)]);
  await db.query('update market_private.publishers set active=false where owner_user_id=$1',[id(2)]);await actor(2);await assert.rejects(rpc('market_registry_workspace'),/unavailable/);
  await db.exec('reset role');await db.query('update market_private.publishers set active=true where owner_user_id=$1',[id(2)]);
 });
 await t.test('soft erasure scrubs content without blocking user tombstones or rewriting financial tables',async()=>{
  await db.exec('reset role');await db.query("update users set status='deleted',auth_user_id=null,display_name='Deleted user' where id=$1",[id(1)]);
  const publisher=(await db.query('select * from market_private.publishers where id=$1',[id(31)])).rows[0];assert.equal(publisher.owner_user_id,null);assert.equal(publisher.name,'Deleted publisher');assert.equal(publisher.active,false);
  assert.equal(await value('select count(*)::int value from market_private.apps where publisher_id=$1 and draft_manifest is not null',[id(31)]),0);
  const erased=(await db.query('select * from market_private.submissions where id=$1',[sub.id])).rows[0];assert.equal(erased.manifest,null);assert.equal(erased.canonical_manifest,null);assert.equal(erased.manifest_hash,sub.manifest_hash);assert.ok(erased.erased_at);
  assert.equal(await value('select reason value from market_private.resolutions where submission_id=$1',[sub.id]),null);
  await actor(1);await assert.rejects(rpc('market_registry_workspace'),/unavailable/);await actor(3);assert.ok((await rpc('market_registry_review_queue')).submissions.every(x=>x.publisher_name!=='Publisher A'));
  await db.exec('reset role');await assert.rejects(db.query("update market_private.submissions set manifest='{}',canonical_manifest='{}' where id=$1",[sub.id]),/immutable/);
 });
 await t.test('physical deletion of last publisher owner and reviewer neither cascades history nor blocks deletion',async()=>{
  await db.exec('reset role');
  await db.query('delete from users where id=$1',[id(3)]);assert.equal(await value('select count(*)::int value from market_private.resolutions where actor_user_id=$1',[id(3)]),0);
  await actor(2);const retained=(await rpc('market_registry_workspace')).apps.flatMap(x=>x.submissions).filter(x=>x.review);
  assert.ok(retained.length>0);assert.ok(retained.every(x=>x.review.reason==='Review reason removed after account erasure.'));
  await db.exec('reset role');await db.query('delete from users where id=$1',[id(2)]);assert.equal(await value('select count(*)::int value from users where id=$1',[id(2)]),0);
  assert.equal(await value('select owner_user_id value from market_private.publishers where id=$1',[id(32)]),null);
  assert.ok(await value('select count(*)::int value from market_private.resolutions')>0);assert.ok(await value('select count(*)::int value from market_private.events')>0);
  assert.deepEqual(await f.financialSnapshot(),f.before);
 });
 await t.test('feature can be disabled without destructive rollback; no launch/install/purchase RPC exists',async()=>{
  await db.exec('reset role;update market_private.settings set enabled=false');await actor(4);await assert.rejects(rpc('market_registry_review_queue'),/unavailable/);
  for(const action of ['install','launch','purchase','publish','token'])await assert.rejects(rpc(`market_registry_${action}`),/does not exist/);
 });
 }finally{await db.close();}
});
