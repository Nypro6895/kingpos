import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
const confirmationBuild=await build({entryPoints:['lib/market-platform/mutation-confirmation.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()}});
const {developerMutationConfirmed,installedAcknowledgement}=await import('data:text/javascript;base64,'+Buffer.from(confirmationBuild.outputFiles[0].text).toString('base64'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const manifest=(version='1.0.0',extra={})=>({schemaVersion:1,type:'hosted-app',version,name:'Synthetic lifecycle app',description:'Synthetic single-owner lifecycle regression.',launchUrl:'https://developer.reylumi.com/connect',privacyUrl:'https://developer.reylumi.com/privacy',supportUrl:'https://developer.reylumi.com/support',scopes:['salon:profile:read','salon:services:read','salon:media:read','salon:content:read'],price:{currency:'usd',amountCents:0,billing:'one-time-version'},...extra});
test('current single-owner lifecycle: rejection, immutable resubmission, update/revoke and authority loss',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create table users(id uuid primary key,status text default 'active');create table locations(id uuid primary key,name text,owner_id uuid references users(id),status text default 'active');create schema market_private;create table market_private.reviewers(user_id uuid,active boolean default true);create function public.current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function public.market_billing_require_admin() returns uuid language plpgsql security definer as $$begin if public.current_public_user_id()<>'${id(4)}'::uuid then raise exception using errcode='42501',message='Financial admin required';end if;return public.current_public_user_id();end$$;create function public.lifecycle_user_is_salon_owner(s uuid,u uuid,x boolean) returns boolean language sql stable security definer as $$select exists(select 1 from public.locations where id=s and owner_id=u and status='active')$$;create table salon_profile_media_assets(id uuid primary key,salon_id uuid,bucket text,object_path text,purpose text,mime_type text,processed_bytes bigint,status text,deleted_at timestamptz,quarantined_at timestamptz);`);
 for(let n=1;n<=4;n++)await db.query('insert into users(id) values($1)',[id(n)]);
 await db.query("insert into locations(id,name,owner_id) values($1,'Synthetic A',$2),($3,'Synthetic B',$4)",[id(20),id(1),id(21),id(2)]);
 await db.query('insert into market_private.reviewers(user_id) values($1),($2)',[id(1),id(3)]);
 for(const migration of ['20261104230000_market_platform.sql','20261104230100_market_platform_commerce.sql','20261104230200_market_owner_connections.sql','20261104230300_market_developer_tools.sql','20261104230400_market_provider_accounting.sql','20261104230500_market_published_data.sql','20261104230600_market_platform_refund_intents.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
 await db.exec('update market_platform.settings set enabled=true');
 const actor=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');};
 const rpc=async(name,args=[],types=[]) => {
  const result=(await db.query(`select public.market_platform_${name}(${args.map((_,i)=>`$${i+1}::${types[i]??'text'}`).join(',')}) result`,args)).rows[0].result;
  const fields={register:['p_name'],profile_save:['p_name','p_email','p_website','p_description'],submit:['p_app','p_manifest','p_request'],review:['p_version','p_sha256','p_decision','p_reason'],moderate:['p_app','p_active','p_reason']}[name];
  if(fields)assert.equal(developerMutationConfirmed(name,result,Object.fromEntries(fields.map((f,i)=>[f,args[i]]))),true,'Actual SQL response must satisfy '+name+' confirmation contract');
  if(name==='install')assert.ok(installedAcknowledgement(result,args[0],args[1],args[3]),'Actual install response satisfies confirmation');
  if(name==='revoke')assert.equal(result,true);return result;
 };
 const submit=(app,m)=>rpc('submit',[app,m,id(50)],['uuid','jsonb','uuid']);
 const review=(v,decision,reason='Synthetic independent inspection')=>rpc('review',[v.id,v.sha256,decision,reason],['uuid','text','text','text']);
 const install=(salon,v,scopes=v.manifest.scopes)=>rpc('install',[salon,v.id,v.sha256,scopes],['uuid','uuid','text','jsonb']);
 let org,v1,v2,v3,installation,otherInstallation;
 await t.test('single owner is backend-derived; registration retries and profile confirmation are typed',async()=>{
  await actor(1);org=await rpc('register',['Synthetic org']);assert.equal(await rpc('register',['Retry organization']),org);assert.equal(await rpc('profile_save',['Synthetic org','support@example.com','https://example.com','Synthetic profile']),true);v1=await submit(null,manifest());
  await actor(2);await rpc('register',['Other synthetic org']);await assert.rejects(submit(v1.app_id,manifest('1.1.0')),/unavailable/);await assert.rejects(rpc('moderate',[v1.app_id,false,'Foreign withdrawal'],['uuid','boolean','text']),/reviewer/);assert.equal((await rpc('workspace')).apps.length,0);
  await actor(3);await assert.rejects(rpc('profile_save',['Wrong org','support@example.com','https://example.com','No membership']),/owner/);await assert.rejects(install(id(20),v1),/owner/);
 });
 await t.test('rejected submission cannot be installed or edited and independent review is idempotent',async()=>{
  await actor(1);await assert.rejects(review(v1,'approved'),/Independent/);await actor(3);const rejected=await review(v1,'rejected','Correct the public description');assert.deepEqual(await review(v1,'rejected','Correct the public description'),rejected);await assert.rejects(review(v1,'approved'),/already/);
  await actor(1);await assert.rejects(install(id(20),v1),/exact approved/);assert.equal((await submit(v1.app_id,manifest())).id,v1.id);await assert.rejects(submit(v1.app_id,manifest('1.0.0',{description:'Changed rejected version cannot replace history.'})),/immutable/);
  v2=await submit(v1.app_id,manifest('1.1.0',{description:'Corrected public description for a new immutable version.'}));assert.notEqual(v2.id,v1.id);assert.equal((await rpc('workspace')).apps[0].versions.find(v=>v.id===v1.id).review.decision,'rejected');
  await actor(3);assert.ok((await rpc('workspace')).queue.some(v=>v.id===v2.id));await review(v2,'approved');
 });
 await t.test('new approved version never replaces installation or grants added access without exact consent',async()=>{
  await actor(1);installation=await install(id(20),v2);const repeated=await install(id(20),v2);assert.equal(repeated.generation,installation.generation);
  await actor(2);otherInstallation=await install(id(21),v2);await actor(1);v3=await submit(v1.app_id,manifest('1.2.0',{scopes:['salon:profile:read']}));await actor(3);await review(v3,'approved');
  await actor(1);assert.equal((await rpc('owner_workspace',[id(20)],['uuid'])).installations[0].versionId,v2.id);await assert.rejects(install(id(20),v3,v2.manifest.scopes),/permissions/);const updated=await install(id(20),v3);assert.equal(updated.id,installation.id);assert.equal(updated.generation,installation.generation+1);assert.deepEqual(updated.scopes,['salon:profile:read']);installation=updated;
  await actor(2);assert.equal((await rpc('owner_workspace',[id(21)],['uuid'])).installations[0].versionId,v2.id);await assert.rejects(rpc('revoke',[installation.id],['uuid']),/owner/);await assert.rejects(rpc('connection_owner_check',[id(21),installation.id],['uuid','uuid']),/belong/);assert.equal(otherInstallation.version_id,v2.id);
 });
 await t.test('withdraw requires independent restoration; publisher inactivity is checked on each mutation',async()=>{
  await actor(1);assert.equal(await rpc('moderate',[v1.app_id,false,'Synthetic publisher withdrawal'],['uuid','boolean','text']),true);await assert.rejects(rpc('moderate',[v1.app_id,true,'Self restore is denied'],['uuid','boolean','text']),/Independent/);assert.equal((await rpc('owner_workspace',[id(20)],['uuid'])).installations[0].usable,false);
  await actor(3);assert.equal(await rpc('moderate',[v1.app_id,true,'Independent synthetic restore'],['uuid','boolean','text']),true);
  await db.exec('reset role');await db.query("update users set status='inactive' where id=$1",[id(1)]);await actor(1);await assert.rejects(submit(v1.app_id,manifest('1.3.0')),/active account/);await assert.rejects(rpc('profile_save',['No longer active','support@example.com','https://example.com','Denied']),/active account/);await actor(2);await assert.rejects(install(id(21),v3),/exact approved/);
  await db.exec('reset role');await db.query("update users set status='active' where id=$1",[id(1)]);
 });
 await t.test('canonical salon ownership loss denies old Owner; revoke is repeat-safe and does not affect the other tenant',async()=>{
  await db.exec('reset role');await db.query('update locations set owner_id=$1 where id=$2',[id(4),id(20)]);await actor(1);await assert.rejects(rpc('revoke',[installation.id],['uuid']),/owner/);await assert.rejects(rpc('connection_owner_check',[id(20),installation.id],['uuid','uuid']),/belong/);
  await actor(4);assert.equal((await rpc('owner_workspace',[id(20)],['uuid'])).installations[0].usable,false);await install(id(20),v3);assert.equal(await rpc('revoke',[installation.id],['uuid']),true);const first=(await rpc('owner_workspace',[id(20)],['uuid'])).installations[0];assert.equal(await rpc('revoke',[installation.id],['uuid']),true);assert.deepEqual((await rpc('owner_workspace',[id(20)],['uuid'])).installations[0],first);
  await actor(2);assert.equal((await rpc('owner_workspace',[id(21)],['uuid'])).installations[0].state,'active');
 });
 await t.test('paid approval alone grants no entitlement and this suite issues no credentials or payment records',async()=>{
  await actor(1);const paid=await submit(v1.app_id,manifest('2.0.0',{price:{currency:'usd',amountCents:490,billing:'one-time-version'}}));await actor(3);await review(paid,'approved');await actor(2);await assert.rejects(install(id(21),paid),/payment entitlement/);
  await db.exec('reset role');for(const table of ['app_credentials','sandboxes','tokens','refresh_grants','authorization_codes','orders','payouts','published_groups'])assert.equal((await db.query(`select count(*)::int n from market_platform.${table}`)).rows[0].n,0,table+' must stay empty');
 });
});
