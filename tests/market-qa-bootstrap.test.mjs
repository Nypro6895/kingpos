import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import fs from 'node:fs';import {qaBootstrapFiles} from '../examples/market-qa-bootstrap/build.mjs';
const id=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const prerequisites=`create role anon;create role authenticated;create role service_role;create schema auth;revoke all on schema auth from public;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);grant usage on schema auth to authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;set reylumi.qa_bootstrap='synthetic-only-reviewed';`;

test('bootstrap is a deterministic explicit dependency bundle, refuses wrong/unprepared targets and creates no Auth accounts',async t=>{
 const files=qaBootstrapFiles();assert.equal(files.length,12);assert.deepEqual(qaBootstrapFiles(),files);assert.equal(files.filter(f=>f.source.startsWith('supabase/migrations/')).length,7);assert.ok(files.every(f=>!f.source.includes('202607240001_account_salon_baseline')));
 const db=new PGlite();t.after(()=>db.close());await assert.rejects(db.exec(files[0].sql),/marker required/);await db.exec("set reylumi.qa_bootstrap='synthetic-only-reviewed'");await assert.rejects(db.exec(files[0].sql),/Auth prerequisites/);await db.exec('create table public.unrelated_business_data(id uuid)');await assert.rejects(db.exec(files[0].sql),/empty application/);
});

test('twelve bootstrap artifacts execute in ephemeral SQL: verified Auth→profile mapping, Owner/salon isolation, review and least-privilege QR role',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(prerequisites);for(const file of qaBootstrapFiles())await db.exec(file.sql);
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0,'The source bundle does not provision Auth identities');
 assert.equal((await db.query('select enabled,commerce_test_enabled from market_platform.settings')).rows[0].enabled,false);assert.equal((await db.query('select commerce_test_enabled from market_platform.settings')).rows[0].commerce_test_enabled,false);
 assert.equal((await db.query('select count(*)::int n from qa_bootstrap.financial_admins')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.users where auth_user_id is not null')).rows[0].n,0);
 // These are rows in a TEST prerequisite table, not actual provider users,
 // accounts, passwords, tokens or signups. Auth sub differs from profile ID.
 for(let n=1;n<=4;n++){await db.query('insert into auth.users(id) values($1)',[id('9',n)]);await db.query('update public.users set auth_user_id=$1 where id=$2',[id('9',n),id('1',n)]);}
 const actor=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id('9',n)]);await db.exec('set role authenticated');};
 const rpc=async(name,args=[],types=[])=> (await db.query(`select public.market_platform_${name}(${args.map((_,i)=>`$${i+1}::${types[i]??'text'}`).join(',')}) value`,args)).rows[0].value;
 await actor(1);await assert.rejects(rpc('workspace'),/available|enabled/);
 await db.exec('reset role;update market_platform.settings set enabled=true');await actor(1);assert.equal((await db.query('select public.current_public_user_id() id')).rows[0].id,id('1',1));assert.equal((await db.query('select id from public.users')).rows.length,1,'Authenticated profile reads are scoped to the real Auth subject');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id('1',1)]);assert.equal((await db.query('select public.current_public_user_id() id')).rows[0].id,null,'A self-claimed profile ID is not an Auth identity');
 await actor(2);await rpc('register',['Synthetic QA developer']);const manifest={schemaVersion:1,type:'hosted-app',version:'1.0.0',name:'Synthetic QA QR',description:'Synthetic QA contract only.',launchUrl:'https://synthetic-qr-qa.vercel.app/connect',privacyUrl:'https://synthetic-qr-qa.vercel.app/privacy',supportUrl:'https://synthetic-qr-qa.vercel.app/support',scopes:['salon:profile:read','salon:services:read','salon:media:read','salon:content:read'],price:{currency:'usd',amountCents:0,billing:'one-time-version'}};
 const version=await rpc('submit',[null,manifest,id('8',1)],['uuid','jsonb','uuid']);await assert.rejects(rpc('review',[version.id,version.sha256,'approved','Synthetic self review'],['uuid','text','text','text']),/review|Independent/i);
 await actor(3);await rpc('review',[version.id,version.sha256,'approved','Synthetic independent review'],['uuid','text','text','text']);
 await actor(1);const installation=await rpc('install',[id('4',1),version.id,version.sha256,manifest.scopes],['uuid','uuid','text','jsonb']);assert.equal(installation.salon_id,id('4',1));await assert.rejects(rpc('owner_workspace',[id('4',2)],['uuid']),/Owner|owner/);await assert.rejects(rpc('finance_workspace'),/financial administrator/);
 await db.exec('reset role;set role qr_menu_qa_runtime');await db.query('insert into qr_menu_private.qr_menu_state(context_id) values($1)',['a'.repeat(64)]);await db.query('update qr_menu_private.qr_menu_state set revision=1 where context_id=$1',['a'.repeat(64)]);assert.equal((await db.query('select revision from qr_menu_private.qr_menu_state')).rows.length,1);
 for(const sql of ['select * from public.users','select * from auth.users','select * from market_platform.settings','select public.market_platform_finance_workspace()','create table qr_menu_private.forbidden(id int)','delete from qr_menu_private.qr_menu_state'])await assert.rejects(db.exec(sql),/permission denied/);
 await db.exec('reset role');const role=(await db.query("select rolcanlogin,rolsuper,rolbypassrls,rolcreaterole from pg_roles where rolname='qr_menu_qa_runtime'")).rows[0];assert.deepEqual(role,{rolcanlogin:false,rolsuper:false,rolbypassrls:false,rolcreaterole:false});
});


test('optional approved Auth binding only links confirmed synthetic IDs, stays disabled and refuses reassignment',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(prerequisites);for(const file of qaBootstrapFiles())await db.exec(file.sql);
 const bind=fs.readFileSync('examples/market-qa-bootstrap/bind-approved-auth.sql','utf8');await assert.rejects(db.exec(bind),/exactly four/);
 for(let n=1;n<=4;n++){const email=(await db.query('select email from public.users where id=$1',[id('1',n)])).rows[0].email;await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id('9',n),email]);}
 await db.exec(bind);assert.equal((await db.query('select count(*)::int n from public.users where auth_user_id is not null')).rows[0].n,4);await db.exec(bind);
 assert.equal((await db.query('select enabled from market_platform.settings')).rows[0].enabled,false);assert.equal((await db.query('select count(*)::int n from market_platform.authorization_codes')).rows[0].n,0);
 await db.query('update public.users set auth_user_id=null where id in ($1,$2)',[id('1',1),id('1',2)]);await db.query('update public.users set auth_user_id=$1 where id=$2',[id('9',2),id('1',1)]);await assert.rejects(db.exec(bind),/cannot be reassigned/);
});
