import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {contextBootstrapFiles,contextGraph} from '../examples/market-qa-bootstrap/context-build.mjs';
import {contextId as id,contextDatabase,contextPrerequisites,applyContext,contextFixture,canonicalProjection} from './helpers/market-context-fixture.mjs';

test('context bootstrap is explicit/deterministic, supplies full canonical projections and no Auth accounts or live feature',async t=>{
 const files=contextBootstrapFiles();assert.equal(files.length,15);assert.deepEqual(contextBootstrapFiles(),files);assert.deepEqual(contextGraph().unresolvedPublicReferences,[]);const db=await contextDatabase(t);
 for(const [file,name,table]of [['lib/users/current-user.ts','USER_SELECT','users'],...['ACCOUNT','ROLE','LOCATION'].map((n,i)=>['lib/current-context.ts',n+'_SELECT',['accounts','roles','locations'][i]])])await db.query('select '+canonicalProjection(file,name)+' from public.'+table);
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.users where auth_user_id is not null')).rows[0].n,0);assert.deepEqual((await db.query('select enabled,commerce_test_enabled,commission_bps from market_platform.settings')).rows[0],{enabled:false,commerce_test_enabled:false,commission_bps:null});
 for(const name of ['record_account_login_session','redeem_account_recovery_code','abuse_preflight'])assert.equal((await db.query('select count(*)::int n from pg_proc where pronamespace=\'public\'::regnamespace and proname=$1',[name])).rows[0].n,0);
});

test('canonical user/context resolver reads actual SQL and respects current-salon selection without posted Owner identity',async t=>{
 const f=await contextFixture(t);await f.actor(1,{'kingpos-selected-workspace':'manage:'+id('4',1),'kingpos-current-manage-salon-id':id('4',1)});
 const user=await f.module.getCurrentKingUser();assert.equal(user.id,id('1',1));const context=await f.module.getCurrentBusinessContext({accessToken:'synthetic-access'});assert.equal(context.currentSalon?.id,id('4',1));assert.equal(context.user.id,id('1',1));assert.equal(context.currentMembership.role.code,'OWNER');assert.equal(await f.module.currentOwnerSalon(id('4',1)),id('4',1));
 await f.actor(4,{'kingpos-current-manage-salon-id':id('4',1)});await assert.rejects(f.module.currentOwnerSalon(id('4',1)),/changed|Choose/);assert.equal((await f.module.getCurrentBusinessContext({accessToken:'synthetic-access'})).availableManageSalons.some(s=>s.id===id('4',1)),false);
});

test('existing developer profile/version/review and actual Owner action use canonical context and SQL consent/install/open/revoke',async t=>{
 const f=await contextFixture(t);await f.db.exec('update market_platform.settings set enabled=true');await f.actor(2);await f.module.platformRpc('register',{p_name:'Synthetic context developer'});
 assert.equal(await f.module.platformRpc('profile_save',{p_name:'Synthetic context developer',p_email:'support@qa.example.invalid',p_website:'https://synthetic-context.vercel.app',p_description:'Synthetic context contract'}),true);
 const tools=await f.module.platformRpc('developer_tools');assert.equal(tools.profile.email,'support@qa.example.invalid');
 const manifest={schemaVersion:1,type:'hosted-app',version:'1.0.0',name:'Synthetic context QR',description:'Synthetic context workflow only.',launchUrl:'https://synthetic-context.vercel.app/connect',privacyUrl:'https://synthetic-context.vercel.app/privacy',supportUrl:'https://synthetic-context.vercel.app/support',scopes:['salon:profile:read','salon:services:read','salon:media:read','salon:content:read'],price:{currency:'usd',amountCents:0,billing:'one-time-version'}};
 const version=await f.module.platformRpc('submit',{p_app:null,p_manifest:manifest,p_request:id('8',1)});
 await f.actor(3);await f.module.platformRpc('review',{p_version:version.id,p_sha256:version.sha256,p_decision:'approved',p_reason:'Synthetic independent context review'});
 await f.actor(1,{'kingpos-selected-workspace':'manage:'+id('4',1)});
 const action=async fields=>{const form=new FormData();for(const[k,v]of Object.entries(fields))form.set(k,v);return f.module.ownerAppAction({ok:false,message:''},form);};
 const install={operation:'install',salon:id('4',1),version:version.id,sha256:version.sha256,scopes:JSON.stringify(manifest.scopes)};
 assert.equal((await action(install)).ok,false);const installed=await action({...install,consent:'yes'});assert.equal(installed.ok,true);const item=installed.market.installations.find(i=>i.versionId===version.id);assert.ok(item);
 assert.equal((await action({operation:'connect',salon:id('4',1),installation:item.id})).ok,false,'Opening requires backend client configuration, not an Owner token');
 await f.actor(2);assert.equal(await f.module.platformRpc('rotate_client',{p_app:version.app_id,p_secret_hash:'0'.repeat(64)}),true,'Ephemeral placeholder digest only; no credential/key is generated or exchanged');await f.actor(1,{'kingpos-selected-workspace':'manage:'+id('4',1)});
 await assert.rejects(action({operation:'connect',salon:id('4',1),installation:item.id}),error=>typeof error.digest==='string'&&error.digest.includes('NEXT_REDIRECT')&&error.digest.includes('synthetic-context.vercel.app/connect?')&&!/rmp_|rmr_|client_secret|access_token/.test(error.digest));
 await f.actor(4,{'kingpos-selected-workspace':'manage:'+id('4',1)});assert.equal((await action({operation:'revoke',salon:id('4',1),installation:item.id})).ok,false);
 await f.actor(1,{'kingpos-selected-workspace':'manage:'+id('4',1)});assert.equal((await action({operation:'revoke',salon:id('4',1),installation:item.id})).ok,true);
});

test('current salon is authoritative even for a multi-salon Owner; inactive salons and suspended/deleted profiles cannot activate',async t=>{
 const f=await contextFixture(t);await f.db.query("insert into public.locations(id,account_id,name) values($1,$2,'Synthetic third salon')",[id('4',3),id('2',1)]);
 await f.actor(1,{'kingpos-selected-workspace':'manage:'+id('4',3),'kingpos-current-manage-salon-id':id('4',1)});assert.equal((await f.module.getCurrentBusinessContext({accessToken:'synthetic-access'})).currentSalon.id,id('4',3));assert.equal(await f.module.currentOwnerSalon(id('4',3)),id('4',3));await assert.rejects(f.module.currentOwnerSalon(id('4',1)),/changed/);
 await f.db.exec('reset role');await f.db.query("update public.locations set status='disabled' where id=$1",[id('4',3)]);await f.actor(1,{'kingpos-selected-workspace':'manage:'+id('4',3)});await assert.rejects(f.module.currentOwnerSalon(id('4',3)),/Choose/);
 for(const status of ['suspended','deleted']){await f.db.exec('reset role');await f.db.query('update public.users set status=$1 where id=$2',[status,id('1',1)]);await f.actor(1);assert.equal(await f.module.getCurrentKingUser(),null);await assert.rejects(f.module.currentOwnerSalon(id('4',1)),error=>error.message==='Please sign in again.'&&error.reason==='signin');}
});

test('canonical tombstone prevents missing-profile fallback and a missing seeding dependency fails rather than fabricating context',async t=>{
 const f=await contextFixture(t);await f.db.query('insert into public.deleted_auth_identities(auth_user_id,user_id) values($1,$2)',[id('9',99),id('1',1)]);await f.actor(99);assert.equal(await f.module.getCurrentKingUser(),null);assert.equal((await f.module.getCurrentBusinessContext({accessToken:'synthetic-access'})).user,null);
 assert.equal((await f.db.query('select public.auth_identity_is_deleted($1::uuid) value',[id('9',1)])).rows[0].value,false);
 await f.db.exec('reset role;drop function public.seed_default_roles_for_account(uuid)');await f.actor(2);await assert.rejects(f.module.getCurrentBusinessContext({accessToken:'synthetic-access'}),/SQL RPC failure/);
});

test('canonical personal-account bootstrap executes real role seeding once and never manufactures a salon or access to another tenant',async t=>{
 const f=await contextFixture(t);await f.actor(2);const first=await f.module.getCurrentBusinessContext({accessToken:'synthetic-access'});assert.ok(first.availableAccounts.length===1);assert.equal(first.availableManageSalons.length,0);await assert.rejects(f.module.currentOwnerSalon(id('4',1)),/Choose/);
 const second=await f.module.getCurrentBusinessContext({accessToken:'synthetic-access'});assert.equal(second.availableAccounts[0].id,first.availableAccounts[0].id);assert.equal((await f.db.query('select count(*)::int n from public.account_memberships where user_id=$1',[id('1',2)])).rows[0].n,1);assert.equal((await f.db.query('select count(*)::int n from public.roles where account_id=$1',[first.availableAccounts[0].id])).rows[0].n,3);
});

test('profile updates use canonical self RLS with narrow columns; identity/status/tenant/security mutations remain denied',async t=>{
 const f=await contextFixture(t);await f.actor(1);assert.equal((await f.db.query("update public.users set display_name='Synthetic renamed',language='vi' where id=$1 returning id",[id('1',1)])).rows.length,1);assert.equal((await f.module.getCurrentKingUser()).display_name,'Synthetic renamed');assert.equal((await f.db.query("update public.users set display_name='Foreign change' where id=$1 returning id",[id('1',4)])).rows.length,0);
 for(const sql of ["update public.users set status='active'",'update public.users set auth_user_id=auth.uid()',"update public.users set phone='synthetic'",'insert into public.accounts(name) values(\'forbidden\')','delete from public.account_memberships','select code_digest from public.account_recovery_codes','select display_name from public.staff','select public.seed_default_roles_for_account(null)'])await assert.rejects(f.db.exec(sql),/permission denied/);
 for(const role of ['anon','service_role','qr_menu_qa_runtime']){await f.db.exec('reset role;set role '+role);await assert.rejects(f.db.exec('select * from public.users'),/permission denied/);await assert.rejects(f.db.exec('select * from public.account_memberships'),/permission denied/);}
});

test('context preflight refuses missing markers/nonempty/Auth/reapply; dependency failure rolls back the whole fresh context bundle',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(contextPrerequisites);await db.exec("set reylumi.qa_context_bootstrap=''");await assert.rejects(applyContext(db),/marker/);assert.equal((await db.query("select to_regclass('public.users') name")).rows[0].name,null);await db.exec("set reylumi.qa_context_bootstrap='canonical-context-reviewed';create table public.unrelated(id uuid)");await assert.rejects(applyContext(db),/empty application/);await db.exec('drop table public.unrelated');await db.query('insert into auth.users(id) values($1)',[id('9',99)]);await assert.rejects(applyContext(db),/existing Auth/);await db.exec('delete from auth.users');
 await db.exec('create function public.unrelated_helper() returns int language sql as $$select 42$$');await assert.rejects(applyContext(db),/empty application/);await db.exec('drop function public.unrelated_helper()');
 const broken=contextBootstrapFiles().map(f=>f.name==='02-context-helpers.sql'?{...f,sql:f.sql.replace('create or replace function public.current_public_user_id()','create or replace function public.missing_dependency_user_id()')}:f);await assert.rejects(applyContext(db,broken));assert.equal((await db.query("select to_regclass('public.users') name")).rows[0].name,null);await applyContext(db);await assert.rejects(applyContext(db),/reapply/);
});
