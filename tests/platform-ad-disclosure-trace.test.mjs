import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const oldMigration='supabase/migrations/202610170001_advertising_display_reservations.sql';
const migration='supabase/migrations/20261119022000_platform_ad_disclosure_trace.sql';
const source=fs.readFileSync(migration,'utf8');
const id=n=>`92000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TARGET=id(1),OTHER=id(2),PENDING=id(3),SESSION=id(10),VISITOR='fixture-shared-network-key';
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
async function fixture(){
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table explore_campaigns(id uuid primary key,config jsonb);
   create table advertising_settings(id boolean primary key,config jsonb);
   create table advertising_events(campaign_id uuid,session_id uuid,kind text,campaign_kind text,created_at timestamptz default now());
   create table explore_campaign_impressions(campaign_id uuid,visitor_hash text,last_seen timestamptz,primary key(campaign_id,visitor_hash));
   create function record_advertising_event(p_campaign uuid,p_session uuid,p_kind text,p_device text,p_audience text,p_path text,p_visitor text,p_user uuid default null) returns boolean language plpgsql as $$begin insert into advertising_events values(p_campaign,p_session,p_kind,'placement',now());return true;end$$;
   insert into advertising_settings values(true,'{"maxTotal":9,"maxPopups":4,"minPopupGapSeconds":60,"sessionMinutes":45}');
   insert into explore_campaigns values('${TARGET}','{"enabled":true,"kind":"popup","repeat":"daily"}'),('${OTHER}','{"enabled":true,"kind":"placement","repeat":"always"}'),('${PENDING}','{"enabled":true,"kind":"popup","repeat":"always"}');
  `);
  await db.exec(fs.readFileSync(oldMigration,'utf8'));await db.exec(source);return db;
 }catch(error){await db.close();throw error;}
}
const reserve=async(db,session=SESSION,campaign=TARGET)=>(await one(db,'select reserve_advertising_display_disclosed($1,$2,$3,\'mobile\',\'personal\',\'/explore\') r',[campaign,session,VISITOR])).r;

test('successful admission freezes exact pre-reservation own-session counts and configured caps without network identifiers/history timestamps',async()=>{
 const db=await fixture();try{
  await db.exec(`insert into advertising_events values('${OTHER}','${SESSION}','view','placement',now()-interval '4 minutes'),('${PENDING}','${SESSION}','view','popup',now()-interval '2 minutes'),('${TARGET}','${id(90)}','view','popup','2020-01-02T03:04:05Z');
   insert into advertising_display_reservations(campaign_id,session_id,visitor_hash,campaign_kind,device,audience,path) values('${OTHER}','${SESSION}','${VISITOR}','placement','mobile','personal','/explore'),('${PENDING}','${SESSION}','${VISITOR}','popup','mobile','personal','/explore');
   insert into explore_campaign_impressions values('${TARGET}','${VISITOR}',now()-interval '2 days');`);
  const before=(await one(db,'select count(*)::int n from advertising_events')).n;
  const result=await reserve(db),trace=result.trace;assert.ok(result.reservation);assert.equal(trace.version,1);
  assert.deepEqual(trace.limits,{maxTotal:9,maxPopups:4,minPopupGapSeconds:60,sessionMinutes:45});
  assert.deepEqual(trace.session,{viewsBefore:2,reservationsBefore:2,totalBefore:4,sameCampaignViewed:false});
  assert.equal(trace.popup.applicable,true);assert.equal(trace.popup.viewsBefore,1);assert.equal(trace.popup.reservationsBefore,1);assert.equal(trace.popup.totalBefore,2);assert.equal(trace.popup.gapSatisfied,true);
  assert.ok(trace.popup.priorPopupAt);assert.deepEqual(trace.repeat,{rule:'daily',checked:true,eligible:true,historyScope:'visitor_key_may_be_shared_network',timeZone:'America/Chicago'});
  for(const secret of [SESSION,VISITOR,TARGET,result.reservation,'2020-01-02T03:04:05'])assert.ok(!JSON.stringify(trace).includes(secret));
  assert.equal((await one(db,'select count(*)::int n from advertising_events')).n,before,'reservation does not record a billable view');
  await db.exec("update advertising_settings set config='{\"maxTotal\":1,\"maxPopups\":1,\"minPopupGapSeconds\":999,\"sessionMinutes\":5}'");
  assert.deepEqual(await reserve(db),result,'same unconfirmed reservation reuses the ORIGINAL immutable trace');
  await assert.rejects(db.query('update advertising_display_reservations set disclosure_trace=\'{}\' where id=$1',[result.reservation]),/immutable/);
  await db.exec(source);assert.deepEqual(await reserve(db),result,'guarded migration replay preserves trace and legacy body');
 }finally{await db.close();}
});

test('legacy UUID API, placement null popup state, quota/gap/repeat rejections and old untraced reservations preserve original admission semantics',async()=>{
 const db=await fixture();try{
  const placement=await reserve(db,SESSION,OTHER);assert.ok(placement.reservation);assert.deepEqual(placement.trace.popup,{applicable:false,viewsBefore:null,reservationsBefore:null,totalBefore:null,priorPopupAt:null,gapSatisfied:null});
  const legacy=(await one(db,'select reserve_advertising_display($1,$2,$3,\'mobile\',\'personal\',\'/explore\') token',[OTHER,id(11),VISITOR])).token;assert.match(legacy,/^[a-f0-9-]{36}$/);
  const untraced=id(60);await db.query("insert into advertising_display_reservations(id,campaign_id,session_id,visitor_hash,campaign_kind,device,audience,path) values($1,$2,$3,$4,'placement','mobile','personal','/explore')",[untraced,OTHER,id(12),VISITOR]);
  assert.deepEqual(await reserve(db,id(12),OTHER),{reservation:null,trace:null},'new clients never fabricate a pre-migration historical trace');
  assert.equal((await one(db,'select reserve_advertising_display($1,$2,$3,\'mobile\',\'personal\',\'/explore\') token',[OTHER,id(12),VISITOR])).token,untraced);
  await db.exec("update advertising_settings set config='{\"maxTotal\":0}'");assert.deepEqual(await reserve(db,id(13)),{reservation:null,trace:null});
  await db.exec("update advertising_settings set config='{\"maxTotal\":9,\"maxPopups\":4,\"minPopupGapSeconds\":60}'");
  await db.query("insert into advertising_events values($1,$2,'view','popup',now())",[PENDING,id(14)]);assert.deepEqual(await reserve(db,id(14)),{reservation:null,trace:null});
  await db.query('insert into explore_campaign_impressions values($1,$2,now())',[TARGET,VISITOR]);assert.deepEqual(await reserve(db,id(15)),{reservation:null,trace:null});
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(reserve(db,id(16)),/permission denied/);await db.exec('reset role');}
 }finally{await db.close();}
});

test('body guard rejects an unreviewed change instead of silently instrumenting a different admission authority',async()=>{
 const db=await fixture();try{
  await db.exec("create or replace function reserve_advertising_display(p_campaign uuid,p_session uuid,p_visitor text,p_device text,p_audience text,p_path text) returns uuid language plpgsql security definer as $$begin return null;end$$");
  await assert.rejects(db.exec(source),/body changed|signature changed/);
 }finally{await db.close();}
});

test('actual full-schema PostgREST trace preserves UUID/confirmation and private grants',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 let f;try{
  f=await startIsolatedSupabase('platform-ad-trace',{
   db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',
   storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5',
  },{allowConcurrentFixtureCleanup:true});
  const service={token:f.serviceToken},person=f.person('platform-trace-reader'),session=crypto.randomUUID(),campaign=crypto.randomUUID();
  f.sql(`insert into explore_campaigns(id,config) values('${campaign}','{"id":"${campaign}","enabled":true,"name":"Synthetic trace","kind":"placement","repeat":"always"}')`);
  const args={p_campaign:campaign,p_session:session,p_visitor:'synthetic-private-visitor',p_device:'mobile',p_audience:'personal',p_path:'/explore'};
  const before=f.sql('select count(*) from advertising_events');
  const result=f.rpc(service,'reserve_advertising_display_disclosed',args);assert.ok(result.reservation);assert.equal(result.trace.session.totalBefore,0);assert.equal(f.sql('select count(*) from advertising_events'),before);
  assert.deepEqual(f.rpc(service,'reserve_advertising_display_disclosed',args),result);
  assert.equal(f.rpc(service,'reserve_advertising_display',args),result.reservation);
  for(const actor of [null,person])assert.ok(f.http(3000,'/rpc/reserve_advertising_display_disclosed','POST',args,actor?.token).status>=400);
  assert.equal(f.rpc(service,'confirm_advertising_display',{p_token:result.reservation,p_session:session,p_visitor:args.p_visitor,p_campaign:campaign}),true);
  assert.equal(f.sql('select count(*) from advertising_events'),String(Number(before)+1));
  assert.equal(f.rpc(service,'confirm_advertising_display',{p_token:result.reservation,p_session:session,p_visitor:args.p_visitor,p_campaign:campaign}),true);
  assert.equal(f.sql('select count(*) from advertising_events'),String(Number(before)+1));
  const own=f.evidence.migrationHashes.find(m=>m.file===migration.split('/').at(-1)),current=crypto.createHash('sha256').update(fs.readFileSync(migration)).digest('hex');assert.equal(own.sha256,current);
  f.save('platform-ad-trace-acceptance.json',{passed:true,migrations:f.evidence.migrationHashes.length,migrationSha256:current,reservationDoesNotRecordView:true,confirmationExactlyOnce:true,legacyUuidPreserved:true,originalTraceReused:true,privateGrants:true,productionUsed:false});
 }catch(error){f?.save('platform-ad-trace-acceptance.json',{passed:false,error:f.redact(error.message)});throw error;}finally{f?.close();}
});
