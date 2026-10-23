import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {createCampaignCumulativeDb,ids}=await import(process.env.CAMPAIGN_CUMULATIVE_FIXTURE?pathToFileURL(process.env.CAMPAIGN_CUMULATIVE_FIXTURE).href:'./fixtures/campaign-cumulative-db.mjs');
const {owner,salon,post,viewer:stranger}=ids;
const lifecycleMigrations=['20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql','20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql','20261021080000_campaign_admin_pause_status.sql','20261021090000_campaign_pending_claim_demand.sql','20261021100000_campaign_paused_reserve_lifecycle.sql','20261021110000_campaign_credit_demand_and_budget.sql'];

const original='30000000-0000-0000-0000-000000000001';
const rerun='30000000-0000-0000-0000-000000000002';
const another='30000000-0000-0000-0000-000000000003';
const migration=fs.readFileSync(process.env.CAMPAIGN_RUN_AGAIN_SQL??'supabase/migrations/20261023190000_campaign_run_again.sql','utf8');
async function database(apply=true){
 const db=await createCampaignCumulativeDb({migrations:lifecycleMigrations,seed:false});
 await db.exec(`
  create table beauty_post_media(id uuid primary key default gen_random_uuid(),post_id uuid,display_order integer,role text,object_path text,created_at timestamptz default now());
  alter table salon_profile_looks add column updated_at timestamptz default now();
  alter table salon_profile_looks add column media_path text;
  insert into salon_profile_looks(id,salon_id,title,caption,status,author_user_id,media_path)
   values('${post}','${salon}','Original title','Original caption','published','${owner}','original.webp');
  select campaign_plugin_set('${salon}','${owner}',true);
  update campaign_wallets set available_credits=10000;
 `);
 if(apply)await db.exec(migration);
 return db;
}
async function seed(db,{type='salon_profile_look',source=post,keep=false,expire=true}={}){
 await db.query("select campaign_create_versioned(1,$1,$2,$3,$4,$5,'city','Chicago','United States','Illinois','Chicago',500,3,250,$6,false)",[original,salon,owner,type,source,keep]);
 assert.equal((await db.query('select campaign_credit_fund($1,$2,$3,$4) status',[original,salon,owner,keep])).rows[0].status,'pending_review');
 assert.equal((await campaign(db,original)).status,'pending_review','ordinary creation still requires review');
 assert.equal(await noticeCount(db),1,'ordinary creation inserts its review notice exactly once');
 await db.query('select owner_campaign_review($1,true)',[original]);
 if(expire)await db.query("update owner_campaigns set ends_at=now()-interval '1 minute',status='completed' where id=$1",[original]);
}
const run=(db,{version=1,id=rerun,user=owner,previous=original,days=4,limit=300}={})=>db.query('select campaign_run_again($1,$2,$3,$4,$5,$6,$7) id',[version,id,salon,user,previous,days,limit]);
const campaign=async(db,id)=>(await db.query('select * from owner_campaigns where id=$1',[id])).rows[0];
const wallet=async db=>(await db.query('select available_credits,reserved_credits from campaign_wallets where salon_id=$1',[salon])).rows[0];
const noticeCount=async db=>(await db.query('select count(*)::int n from campaign_review_notices')).rows[0].n;

test('expired approved campaign runs with copied settings, new accounting and history, without a review notice',async()=>{
 const db=await database();try{
  await seed(db);
  await db.query("insert into owner_campaign_events(campaign_id,visitor_hash,day,kind) values($1,$2,current_date,'view')",[original,'f'.repeat(64)]);
  const before=await campaign(db,original),credits=await wallet(db),notices=await noticeCount(db);
  assert.equal((await run(db)).rows[0].id,rerun);
  const after=await campaign(db,rerun);
  assert.equal(after.status,'running');assert.equal(after.run_again_of,original);
  for(const key of ['title','source_type','source_id','area','location','country','state','city','daily_views','keep_running','auto_fund','approved_content_snapshot'])assert.deepEqual(after[key],before[key],key);
  assert.equal(after.days,4);assert.equal(after.cycle_credit_limit,300);assert.equal(after.total_price_cents,300);
  assert.equal(after.reserved_credits,300);assert.equal(after.spent_cents,0);assert.equal(after.views,0);
  assert.equal(new Date(after.ends_at)-new Date(after.starts_at),4*86400000);
  assert.equal(new Date(after.approved_at).getTime(),new Date(before.approved_at).getTime());
  assert.deepEqual(await campaign(db,original),before,'source history remains intact');
  assert.equal((await db.query('select count(*)::int n from owner_campaign_events where campaign_id=$1',[original])).rows[0].n,1);
  assert.equal(await noticeCount(db),notices,'no pending or resolved notice is created for the rerun');
  assert.deepEqual(await wallet(db),{available_credits:credits.available_credits-300,reserved_credits:credits.reserved_credits+300});
  await run(db);await run(db,{version:999,days:8,limit:500});
  assert.equal((await db.query("select count(*)::int n from campaign_credit_ledger where reference=$1",['reserve:'+rerun])).rows[0].n,1);
  assert.equal((await campaign(db,rerun)).days,4,'retry never rewrites a funded run');
  await assert.rejects(run(db,{id:another}),/already has a campaign/);
  assert.equal((await db.query('select count(*)::int n from owner_campaigns')).rows[0].n,2);
  assert.equal((await db.query("select owner_campaign_admit($1,$2,'view',$3,null,$4) ok",[rerun,'b'.repeat(64),{country:'United States',state:'Illinois',city:'Chicago'},'40000000-0000-0000-0000-000000000001'])).rows[0].ok,true);
  assert.equal((await campaign(db,rerun)).views,1);assert.equal((await campaign(db,rerun)).spent_cents,1);
  assert.deepEqual(await campaign(db,original),before,'admitted rerun views never change old results');
  await db.query("select owner_campaign_change($1,$2,$3,'cancel')",[rerun,salon,owner]);
  assert.deepEqual(await wallet(db),{available_credits:credits.available_credits-1,reserved_credits:credits.reserved_credits},'normal cancellation refunds unused credits only');
 }finally{await db.close();}
});

test('saved rerun funds later without admin review and rolls back reservations if creative changed',async()=>{
 const db=await database();try{
  await seed(db,{keep:true});
  await db.exec('update campaign_wallets set available_credits=0,auto_topup_enabled=true');
  await run(db);
  const saved=await campaign(db,rerun),notices=await noticeCount(db);
  assert.equal(saved.status,'awaiting_payment');assert.equal(saved.keep_running,true);assert.equal(saved.auto_fund,true);
  assert.equal(saved.starts_at,null);assert.equal(saved.approved_at,null);assert.equal(saved.reserved_credits,0);
  await db.exec("update campaign_wallets set available_credits=500;update salon_profile_looks set caption='Changed after saving'");
  const credits=await wallet(db);
  await assert.rejects(db.query('select campaign_credit_fund($1,$2,$3,true)',[rerun,salon,owner]),/content changed/);
  assert.deepEqual(await wallet(db),credits,'failed eligibility rolls back both wallet and ledger');
  assert.equal((await db.query("select count(*)::int n from campaign_credit_ledger where reference=$1",['reserve:'+rerun])).rows[0].n,0);
  await db.exec("update salon_profile_looks set caption='Original caption'");
  assert.equal((await db.query('select campaign_credit_fund($1,$2,$3,true) status',[rerun,salon,owner])).rows[0].status,'running');
  assert.equal((await campaign(db,rerun)).status,'running');
  assert.equal(await noticeCount(db),notices);
  await db.query('select campaign_credit_fund($1,$2,$3,true)',[rerun,salon,owner]);
  assert.equal((await wallet(db)).available_credits,200);
 }finally{await db.close();}
});

test('owner, expired approval, post safety and immutable approved content guard the no-review path',async()=>{
 const db=await database();try{
  await seed(db);
  await assert.rejects(run(db,{user:stranger}),/Owner access/);
  await assert.rejects(run(db,{previous:another}),/expired/);
  await assert.rejects(run(db,{id:original}),/Reopen/);
  for(const status of ['cancelled','rejected','pending_review','awaiting_payment']){
   await db.query('update owner_campaigns set status=$1 where id=$2',[status,original]);
   await assert.rejects(run(db),/expired/,status);
  }
  await db.query("update owner_campaigns set status='completed',ends_at=now()+interval '1 day' where id=$1",[original]);
  await assert.rejects(run(db),/expired/,'credit-completed but still within scheduled dates is not expired');
  await db.query("update owner_campaigns set ends_at=now()-interval '1 minute',approved_at=null where id=$1",[original]);
  await assert.rejects(run(db),/expired/);
  await db.query('update owner_campaigns set approved_at=now() where id=$1',[original]);
  await db.exec('update salon_profile_looks set safety_hold=true');
  await assert.rejects(run(db),/content changed/);
  await db.exec("update salon_profile_looks set safety_hold=false,media_path='different.webp'");
  await assert.rejects(run(db),/content changed/);
  await db.exec("update salon_profile_looks set media_path='original.webp',caption='Changed caption'");
  await assert.rejects(run(db),/content changed/);
  assert.equal((await db.query('select count(*)::int n from owner_campaigns')).rows[0].n,1);
  for(const role of ['anon','authenticated']){
   assert.equal((await db.query("select has_function_privilege($1,'campaign_run_again(bigint,uuid,uuid,uuid,uuid,integer,integer)','EXECUTE') ok",[role])).rows[0].ok,false);
   assert.equal((await db.query("select has_function_privilege($1,'campaign_content_snapshot(text,uuid,uuid)','EXECUTE') ok",[role])).rows[0].ok,false);
   for(const signature of ['campaign_content_snapshot_read(text,uuid,uuid)','campaign_run_again_source_eligible(uuid,uuid,text,uuid,jsonb)','campaign_run_again_funding_eligible(uuid)'])assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,false);
  }
  assert.equal((await db.query("select has_function_privilege('service_role','campaign_run_again(bigint,uuid,uuid,uuid,uuid,integer,integer)','EXECUTE') ok")).rows[0].ok,true);
 }finally{await db.close();}
});

test('rerun uses current versioned create pricing and validation, retaining the old campaign rate',async()=>{
 const db=await database();try{
  await seed(db);
  await db.exec(`update owner_campaign_settings set config=config||'{"dailyPriceCents":200,"dailyFrequency":1,"maxDays":7}'::jsonb`);
  await assert.rejects(run(db),/options changed/);
  await assert.rejects(run(db,{version:2,days:8}),/duration/);
  await assert.rejects(run(db,{version:2,limit:801}),/limit/);
  await assert.rejects(run(db,{version:2,days:null}),/duration/);
  await run(db,{version:2,limit:800});
  const after=await campaign(db,rerun);
  assert.equal(after.daily_price_cents,200);assert.equal(after.total_price_cents,800);
  assert.equal(after.settings_version,2);assert.equal(after.settings_snapshot.dailyFrequency,1);
  assert.equal((await campaign(db,original)).daily_price_cents,100);
 }finally{await db.close();}
});

test('scheduler-lag expired running campaigns can run again but actively auto-renewing campaigns cannot',async()=>{
 const db=await database();try{
  await seed(db);
  await db.query("update owner_campaigns set status='paused',keep_running=true where id=$1",[original]);
  await assert.rejects(run(db),/expired/);
  await db.query("update owner_campaigns set status='running',keep_running=false where id=$1",[original]);
  await run(db);
  assert.equal((await campaign(db,original)).status,'completed');
  assert.equal((await campaign(db,rerun)).status,'running');
 }finally{await db.close();}
});

test('blocked payments prevent inherited automatic credit purchases without blocking existing wallet funds',async()=>{
 const db=await database();try{
  await seed(db);
  await db.exec('update owner_campaigns set auto_fund=true;update campaign_wallets set auto_topup_enabled=true,payment_blocked=true');
  await run(db);
  const after=await campaign(db,rerun);
  assert.equal(after.auto_fund,false);assert.equal(after.status,'running');
  assert.equal((await db.query('select count(*)::int n from campaign_credit_orders')).rows[0].n,0);
 }finally{await db.close();}
});

test('legacy proven-unchanged posts backfill approval content; changed legacy posts require new review',async()=>{
 const db=await database(false);try{
  await seed(db);await db.exec(migration);
  assert.ok((await campaign(db,original)).approved_content_snapshot);
  await run(db);assert.equal((await campaign(db,rerun)).status,'running');
 }finally{await db.close();}
 const changed=await database(false);try{
  await seed(changed);
  await changed.exec("update salon_profile_looks set caption='Edited after approval',updated_at=now()+interval '1 second'");
  await changed.exec(migration);
  assert.equal((await campaign(changed,original)).approved_content_snapshot,null);
  await assert.rejects(run(changed),/approval cannot be verified/);
 }finally{await changed.close();}
});

test('custom creative and Beauty media retain their approved content across reruns',async()=>{
 const custom=await database(false);try{
  await custom.query("insert into owner_campaign_creatives(id,salon_id,author_user_id,title,caption,media_path) values($1,$2,$3,'Custom title','Custom caption','immutable/photo.webp')",[post,salon,owner]);
  await seed(custom,{type:'custom'});await custom.exec(migration);
  await run(custom);
  const after=await campaign(custom,rerun);
  assert.equal(after.source_type,'custom');assert.equal(after.title,'Custom title');
  assert.equal(after.approved_content_snapshot.media_path,'immutable/photo.webp');
  assert.equal((await custom.query('select count(*)::int n from owner_campaign_creatives')).rows[0].n,1);
 }finally{await custom.close();}
 const beauty=await database();try{
  await beauty.exec(`alter table beauty_posts add column profile_id uuid;insert into beauty_profiles values('${owner}','public')`);
  await beauty.query("insert into beauty_posts(id,salon_id,title,caption,status,author_user_id,visibility,moderation_status,profile_id) values($1,$2,'Beauty title','Beauty caption','published',$3,'public','visible',$3)",[post,salon,owner]);
  await beauty.query("insert into beauty_post_media(post_id,display_order,role,object_path) values($1,0,'image','beauty/original.webp')",[post]);
  await seed(beauty,{type:'beauty_post'});
  await beauty.exec("update beauty_post_media set object_path='beauty/replacement.webp'");
  await assert.rejects(run(beauty),/content changed/);
  await beauty.exec("update beauty_post_media set object_path='beauty/original.webp'");
  await run(beauty);assert.equal((await campaign(beauty,rerun)).status,'running');
 }finally{await beauty.close();}
});

test('R12 owner-held pauses and archives stay ineligible and retain their reservation and resume path',async()=>{
 const db=await database();try{
  await seed(db,{expire:false});
  await db.query("update owner_campaigns set status='running',ends_at=now()+interval '2 days' where id=$1",[original]);
  await db.query("select owner_campaign_change($1,$2,$3,'pause')",[original,salon,owner]);
  await db.query("update owner_campaigns set owner_paused_at=now()-interval '8 days',ends_at=now()-interval '6 days' where id=$1",[original]);
  const paused=await campaign(db,original),credits=await wallet(db);
  assert.equal(credits.reserved_credits,250,'the live owner pause holds an actual funded reservation');
  await assert.rejects(run(db),/expired/);
  await db.query('select campaign_credit_close_expired($1)',[salon]);
  assert.deepEqual(await wallet(db),credits);assert.deepEqual(await campaign(db,original),paused);
  assert.equal((await db.query('select campaign_credit_fund($1,$2,$3,false) status',[original,salon,owner])).rows[0].status,'paused');
  await db.query('select owner_campaign_resume($1,$2,$3,$4)',[original,salon,owner,paused.pause_episode_id]);
  const resumed=await campaign(db,original);
  assert.equal(resumed.status,'running');assert.equal(resumed.owner_paused_at,null);assert.ok(new Date(resumed.ends_at)>new Date());
  assert.deepEqual(await wallet(db),credits,'resume retains its funded period without a new reserve');
  await db.query("update owner_campaigns set status='completed',ends_at=now()-interval '1 minute',archived_at=now() where id=$1",[original]);
  await assert.rejects(run(db),/expired/);
  assert.equal((await db.query('select count(*)::int n from owner_campaigns')).rows[0].n,1);
 }finally{await db.close();}
});

test('R12 delayed funding cannot bypass later archival and keeps the pause wrapper and budget functions intact',async()=>{
 const db=await database(false);try{
  const definitions=async()=> (await db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p where p.oid=any(array[
   'campaign_credit_fund(uuid,uuid,uuid,boolean)'::regprocedure,'campaign_credit_order(uuid,uuid,integer,boolean)'::regprocedure,
   'campaign_credit_claim(uuid)'::regprocedure,'campaign_credit_renew(uuid)'::regprocedure,
   'owner_campaign_resume(uuid,uuid,uuid,uuid)'::regprocedure]) order by signature`)).rows;
  const before=await definitions();
  const priorDemand=(await db.query("select pg_get_functiondef('campaign_credit_has_active_demand(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
  await db.exec(migration);assert.deepEqual(await definitions(),before,'only the inner fund return changes; lifecycle and budget functions stay exact');
  const currentDemand=(await db.query("select pg_get_functiondef('campaign_credit_has_active_demand(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
  assert.equal(currentDemand,priorDemand.replace('and a.total_price_cents>w.available_credits','and a.total_price_cents>w.available_credits and public.campaign_run_again_funding_eligible(a.id)'));
  assert.equal((await db.query("select has_function_privilege('service_role','campaign_credit_fund_before_pause(uuid,uuid,uuid,boolean)','EXECUTE') ok")).rows[0].ok,false);
  await seed(db);await db.exec('update campaign_wallets set available_credits=0');await run(db);
  await db.query('update owner_campaigns set archived_at=now() where id=$1',[original]);
  await db.exec('update campaign_wallets set available_credits=500');const credits=await wallet(db),notices=await noticeCount(db);
  await assert.rejects(db.query('select campaign_credit_fund($1,$2,$3,false)',[rerun,salon,owner]),/content changed|no longer available/);
  assert.deepEqual(await wallet(db),credits);assert.equal(await noticeCount(db),notices);
  assert.equal((await campaign(db,rerun)).status,'awaiting_payment');
 }finally{await db.close();}
});

test('R12 automatic intents and claims recheck rerun approval before buying credits',async()=>{
 const db=await database();try{
  await seed(db);
  await db.query("update campaign_wallets set available_credits=0,auto_topup_enabled=true,auto_topup_consent_at=now(),payment_owner=$1,stripe_customer='cus_fixture',stripe_payment_method='pm_fixture'",[owner]);
  await run(db);assert.equal((await campaign(db,rerun)).auto_fund,true);
  const demand=async()=> (await db.query('select campaign_credit_has_active_demand($1,$2) needed',[salon,owner])).rows[0].needed;
  const intent=async()=> (await db.query('select campaign_credit_order($1,$2,500,true) id',[salon,owner])).rows[0].id;
  const claim=async id=> (await db.query('select campaign_credit_claim($1) payload',[id])).rows[0].payload;
  await db.exec('begin read only');assert.equal(await demand(),true);await db.exec('rollback');
  await db.exec("update salon_profile_looks set caption='Different creative'");
  assert.equal(await demand(),false);assert.equal(await intent(),null);
  assert.equal((await db.query('select count(*)::int n from campaign_credit_orders')).rows[0].n,0,'invalid approval creates no automatic purchase intent');
  await db.exec("update salon_profile_looks set caption='Original caption'");
  const id=await intent();assert.ok(id);
  await db.query('update owner_campaigns set archived_at=now() where id=$1',[original]);
  assert.equal(await demand(),false);assert.equal(await claim(id),null,'archived parent cannot create a payment claim');
  await db.query('update owner_campaigns set archived_at=null where id=$1',[original]);
  await db.exec("update salon_profile_looks set media_path='changed.webp'");
  assert.equal(await demand(),false);assert.equal(await claim(id),null,'changed creative cannot create a payment claim');
  const pending=(await db.query('select status,claim_payload,automatic_budget_month from campaign_credit_orders where id=$1',[id])).rows[0];
  assert.deepEqual(pending,{status:'pending',claim_payload:null,automatic_budget_month:null});
  assert.equal((await db.query("select count(*)::int n from campaign_credit_ledger where kind='purchase'")).rows[0].n,0);
  await db.exec("update salon_profile_looks set media_path='original.webp'");
  assert.equal(await demand(),true);assert.equal((await claim(id)).amount,500,'unchanged approved rerun can use existing consent and budget mechanism');
  const newPost='20000000-0000-0000-0000-000000000002';
  await db.query("insert into salon_profile_looks(id,salon_id,title,caption,status,author_user_id) values($1,$2,'New campaign','New content','published',$3)",[newPost,salon,owner]);
  await db.query("select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city','Chicago','United States','Illinois','Chicago',500,3,300,false,true)",[another,salon,owner,newPost]);
  await db.query("update salon_profile_looks set caption='Changed original' where id=$1",[post]);
  assert.equal(await demand(),true,'invalid rerun never blocks valid demand from an ordinary new campaign');
 }finally{await db.close();}
});

test('R12 approval-snapshot backfill preserves paused campaign history, timestamps, credits and notices exactly',async()=>{
 const db=await database(false);try{
  await seed(db,{expire:false});
  await db.query("select owner_campaign_change($1,$2,$3,'pause')",[original,salon,owner]);
  await db.query("update owner_campaigns set owner_paused_at=now()-interval '8 days',ends_at=now()-interval '5 days' where id=$1",[original]);
  const state=async()=> (await db.query(`select
   (select to_jsonb(c)-array['run_again_of','approved_content_snapshot'] from owner_campaigns c where id=$1) campaign,
   (select jsonb_agg(to_jsonb(w) order by salon_id) from campaign_wallets w) wallets,
   (select jsonb_agg(to_jsonb(s)) from owner_campaign_settings s) settings,
   (select jsonb_agg(to_jsonb(l) order by id) from campaign_credit_ledger l) ledger,
   (select jsonb_agg(to_jsonb(n) order by id) from campaign_review_notices n) notices,
   (select jsonb_agg(to_jsonb(r) order by campaign_id,episode_id,milestone_hours) from campaign_pause_reminders r) pause_reminders`,[original])).rows[0];
  const before=await state();await db.exec(migration);assert.deepEqual(await state(),before);
  assert.ok((await campaign(db,original)).approved_content_snapshot);
  await assert.rejects(run(db),/expired/);
 }finally{await db.close();}
});
