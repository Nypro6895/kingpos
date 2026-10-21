import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignCumulativeDb,ids,readCampaignMigration} from './fixtures/campaign-cumulative-db.mjs';

const {campaign,salon,owner,viewer,nonce}=ids;
const before=['20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql','20261021060000_campaign_credit_queue_progress.sql'];
const migration=readCampaignMigration('20261021070000_campaign_pause_lifecycle.sql');
const geo={country:'US',state:'WI',city:'Milwaukee',zipcode:'53202',neighborhood:'East Town'};
const pause=db=>db.query("select owner_campaign_change($1,$2,$3,'pause')",[campaign,salon,owner]);
const row=async db=>(await db.query('select * from owner_campaigns where id=$1',[campaign])).rows[0];
const resume=(db,episode)=>db.query('select owner_campaign_resume($1,$2,$3,$4)',[campaign,salon,owner,episode]);
const expire=db=>db.query("update owner_campaigns set ends_at=now()-interval '1 second' where id=$1",[campaign]);
const close=db=>db.query('select campaign_credit_close_expired($1)',[salon]);
const renew=async db=>(await db.query('select campaign_credit_renew($1) ok',[campaign])).rows[0].ok;
const reminder=async db=>(await db.query('select campaign_pause_reminder($1) count',[campaign])).rows[0].count;
const money=async db=>(await db.query(`select (select to_jsonb(w) from campaign_wallets w where salon_id=$1) wallet,
 (select jsonb_agg(to_jsonb(l) order by id) from campaign_credit_ledger l where salon_id=$1) ledger,
 (select jsonb_build_object('views',views,'spent',spent_cents,'reserved',reserved_credits,'released',released_credits) from owner_campaigns where id=$2) campaign,
 (select count(*)::integer from owner_campaign_events) events`,[salon,campaign])).rows[0];
async function isolated(db,run){await db.exec('begin');try{await run();}finally{await db.exec('rollback');}}
async function rejected(db,run,pattern){await db.exec('savepoint expected_failure');try{await assert.rejects(run,pattern);}finally{await db.exec('rollback to expected_failure;release expected_failure');}}
const advancePause=async(db,hours)=>{
 await db.query("update owner_campaigns set owner_paused_at=now()-make_interval(hours=>$1),ends_at=now()+interval '30 days' where id=$2",[hours,campaign]);
 await db.query('update campaign_pause_reminders r set due_at=c.owner_paused_at+make_interval(hours=>r.milestone_hours) from owner_campaigns c where c.id=r.campaign_id and c.id=$1',[campaign]);
};

test('sticky owner Pause uses full cumulative accounting, explicit episode Resume and no monetary policy change',async t=>{
 const db=await createCampaignCumulativeDb({migrations:before});
 try{
  await t.test('before migration reproduces paused keep-running restarting after expiry',async()=>isolated(db,async()=>{
   await db.exec('update owner_campaigns set keep_running=true');await pause(db);await expire(db);await close(db);
   assert.equal((await row(db)).status,'completed');assert.equal(await renew(db),true);assert.equal((await row(db)).status,'running');
  }));
  await db.exec(migration);
  await t.test('Pause reserves unchanged, repeated Pause keeps episode, admission/selectors reject, Resume same period is idempotent',async()=>isolated(db,async()=>{
   const pre=await money(db);await pause(db);const paused=await row(db);assert.deepEqual(await money(db),pre);
   assert.equal(paused.status,'paused');assert.equal(paused.pause_origin,'owner');assert.ok(paused.owner_paused_at);assert.ok(paused.pause_episode_id);
   await pause(db);assert.equal((await row(db)).pause_episode_id,paused.pause_episode_id);
   assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders')).rows[0].n,2);
   assert.equal((await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,'a'.repeat(64),geo,viewer,nonce])).rows[0].ok,false);
   assert.equal((await db.query('select id from owner_campaign_candidates($1,$2,$3)',[geo,'a'.repeat(64),viewer])).rows.length,0);
   assert.equal((await db.query("select id from owner_campaign_search_candidates($1,$2,$3,'gel','service','Nails')",[geo,'a'.repeat(64),viewer])).rows.length,0);
   assert.deepEqual(await money(db),pre);
   await rejected(db,()=>db.query("select owner_campaign_change($1,$2,$3,'resume')",[campaign,salon,owner]),/Refresh this campaign/);
   await resume(db,paused.pause_episode_id);const resumed=await row(db);assert.equal(resumed.status,'running');assert.equal(resumed.owner_paused_at,null);assert.deepEqual(resumed.ends_at,paused.ends_at);
   assert.equal(resumed.keep_running,false);const settled=await money(db);await resume(db,paused.pause_episode_id);assert.deepEqual(await money(db),settled);
   assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders where cancelled_at is not null')).rows[0].n,2);
  }));
  await t.test('expired paused campaign settles credit once and never auto-renews; explicit Resume preserves keep preference',async()=>isolated(db,async()=>{
   await db.exec('update owner_campaigns set keep_running=true');await pause(db);const episode=(await row(db)).pause_episode_id;
   await expire(db);await close(db);let c=await row(db);assert.equal(c.status,'completed');assert.ok(c.owner_paused_at);assert.equal(c.released_credits,300);
   const settled=await money(db);assert.equal(await renew(db),false);await close(db);assert.deepEqual(await money(db),settled);
   assert.equal((await db.query("select count(*)::integer n from campaign_credit_queue_items where phase='renew' and item_id=$1",[campaign])).rows[0].n,0);
   await resume(db,episode);c=await row(db);assert.equal(c.status,'running');assert.equal(c.keep_running,true);assert.equal(c.owner_paused_at,null);assert.equal(c.reserved_credits,600);assert.equal(c.released_credits,300);
   const restarted=await money(db);await resume(db,episode);assert.deepEqual(await money(db),restarted);
   await db.exec('update owner_campaigns set keep_running=false');await expire(db);await close(db);const finished=await money(db);
   await resume(db,episode);assert.deepEqual(await money(db),finished,'late retry after the resumed period ends does not begin another period');assert.equal((await row(db)).status,'completed');
  }));
  await t.test('explicit expired Resume does not silently enable keep-running',async()=>isolated(db,async()=>{
   await pause(db);const episode=(await row(db)).pause_episode_id;await expire(db);await resume(db,episode);
   const c=await row(db);assert.equal(c.status,'running');assert.equal(c.keep_running,false);assert.equal(c.released_credits,300);assert.equal(c.reserved_credits,600);
  }));
  await t.test('usage admitted before Pause remains recorded; later replay/new nonce cannot add spend and expiry refunds the exact remainder',async()=>isolated(db,async()=>{
   assert.equal((await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,'a'.repeat(64),geo,viewer,nonce])).rows[0].ok,true);
   const admitted=await money(db);assert.equal(admitted.campaign.views,1);assert.ok(admitted.campaign.spent>0);await pause(db);
   for(const token of [nonce,'40000000-0000-0000-0000-000000000002'])assert.equal((await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,'a'.repeat(64),geo,viewer,token])).rows[0].ok,false);
   assert.deepEqual(await money(db),admitted);await expire(db);await close(db);const c=await row(db);assert.equal(c.views,1);assert.equal(c.spent_cents,admitted.campaign.spent);assert.equal(c.released_credits,300-admitted.campaign.spent);
  }));
  await t.test('stale Resume from a prior episode cannot clear a new Pause',async()=>isolated(db,async()=>{
   await pause(db);const first=(await row(db)).pause_episode_id;await resume(db,first);await pause(db);const second=await row(db);assert.notEqual(second.pause_episode_id,first);
   const pre=await money(db);await rejected(db,()=>resume(db,first),/pause changed/);assert.deepEqual(await money(db),pre);assert.equal((await row(db)).pause_episode_id,second.pause_episode_id);assert.ok((await row(db)).owner_paused_at);
  }));
  await t.test('failed restart is atomic for funds, source, ownership and maximum campaign guards',async()=>isolated(db,async()=>{
   await pause(db);const episode=(await row(db)).pause_episode_id;await expire(db);await close(db);
   await db.exec('update campaign_wallets set available_credits=0');let pre=await money(db);
   await rejected(db,()=>resume(db,episode),/remains paused/);assert.deepEqual(await money(db),pre);assert.ok((await row(db)).owner_paused_at);
   await db.exec('update campaign_wallets set available_credits=1000;update salon_profile_looks set safety_hold=true');pre=await money(db);
   await rejected(db,()=>resume(db,episode),/available, approved source/);assert.deepEqual(await money(db),pre);
   await db.exec('update salon_profile_looks set safety_hold=false');
   await rejected(db,()=>db.query('select owner_campaign_resume($1,$2,$3,$4)',[campaign,salon,viewer,episode]),/Owner access/);
   await db.exec(`insert into owner_campaigns(id,salon_id,owner_id,source_type,source_id,title,area,location,country,state,city,days,daily_views,daily_price_cents,total_price_cents,status)
    select gen_random_uuid(),salon_id,owner_id,source_type,gen_random_uuid(),'Other queued ad','city',location,country,state,city,days,daily_views,daily_price_cents,total_price_cents,'awaiting_payment' from owner_campaigns cross join generate_series(1,5) where id='${campaign}'`);pre=await money(db);
   await rejected(db,()=>resume(db,episode),/another campaign/);assert.deepEqual(await money(db),pre);
  }));
  await t.test('cancel after expiry clears intent without another refund; legacy writers cannot run a paused campaign',async()=>isolated(db,async()=>{
   await pause(db);await rejected(db,()=>db.exec("update owner_campaigns set status='running'"),/owner must resume/);
   await expire(db);await close(db);const pre=await money(db);
   await db.query("select owner_campaign_change($1,$2,$3,'cancel')",[campaign,salon,owner]);const c=await row(db);assert.equal(c.status,'cancelled');assert.equal(c.owner_paused_at,null);assert.deepEqual(await money(db),pre);assert.equal(await renew(db),false);
  }));
  await t.test('an administrative pause without owner intent retains its existing same-period Resume control',async()=>isolated(db,async()=>{
   await db.exec("update owner_campaigns set status='paused',keep_running=false");assert.equal((await row(db)).owner_paused_at,null);
   const pre=await money(db);await db.query("select owner_campaign_change($1,$2,$3,'resume')",[campaign,salon,owner]);assert.equal((await row(db)).status,'running');assert.deepEqual(await money(db),pre);
  }));
  await t.test('defence at funding, selection and admission rejects contradictory legacy status without creating money or usage',async()=>isolated(db,async()=>{
   await pause(db);await db.exec("update owner_campaigns set status='awaiting_payment'");const pre=await money(db);
   assert.equal((await db.query('select campaign_credit_fund($1,$2,$3,true) status',[campaign,salon,owner])).rows[0].status,'awaiting_payment');assert.deepEqual(await money(db),pre);
   // Fault injection models inconsistent preexisting/service state. Normal
   // writes are already rejected by campaign_owner_pause_guard.
   await db.exec("alter table owner_campaigns disable trigger campaign_owner_pause_guard;update owner_campaigns set status='running';alter table owner_campaigns enable trigger campaign_owner_pause_guard");
   assert.equal((await db.query('select id from owner_campaign_candidates($1,$2,$3)',[geo,'b'.repeat(64),viewer])).rows.length,0);
   assert.equal((await db.query("select id from owner_campaign_search_candidates($1,$2,$3,'gel','service','Nails')",[geo,'b'.repeat(64),viewer])).rows.length,0);
   assert.equal((await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,'b'.repeat(64),geo,viewer,nonce])).rows[0].ok,false);assert.deepEqual(await money(db),pre);
  }));
  await t.test('paused renewal demand never triggers top-up above global threshold',async()=>isolated(db,async()=>{
   await db.exec("update campaign_wallets set available_credits=200,threshold_credits=0,auto_topup_enabled=true,stripe_payment_method='fixture',payment_owner='"+owner+"';update owner_campaigns set keep_running=true");
   await pause(db);await expire(db);await close(db);await db.exec('update campaign_wallets set available_credits=200');
   assert.equal((await db.query('select campaign_credit_order($1,$2,500,true) id',[salon,owner])).rows[0].id,null);
   await db.exec('update campaign_wallets set available_credits=0');
   assert.ok((await db.query('select campaign_credit_order($1,$2,500,true) id',[salon,owner])).rows[0].id,'existing independently consented wallet threshold top-up remains');
  }));
  await t.test('security-definer entry points and unsafe internal wrappers preserve service-only ACL',async()=>{
   const signatures=['owner_campaign_resume(uuid,uuid,uuid,uuid)','campaign_pause_reminder(uuid)','campaign_credit_renew(uuid)','campaign_credit_fund(uuid,uuid,uuid,boolean)','owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid)'];
   for(const signature of signatures){
    const p=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') auth,has_function_privilege('service_role',$1,'execute') svc from pg_proc where oid=$1::regprocedure",[signature])).rows[0];
    assert.equal(p.prosecdef,true);assert.ok(p.proconfig.includes('search_path=public'));assert.equal(p.anon,false);assert.equal(p.auth,false);assert.equal(p.svc,true);
   }
   for(const signature of ['campaign_credit_renew_before_pause(uuid)','campaign_credit_fund_before_pause(uuid,uuid,uuid,boolean)','owner_campaign_admit_before_pause(uuid,text,text,jsonb,uuid,uuid)','owner_campaign_change_original(uuid,uuid,uuid,text)'])assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') ok",[signature])).rows[0].ok,false);
  });
 }finally{await db.close();}
});

test('pause reminders: exact 24h/7day milestones, owner-only, no repeats, transactional cancellation',async t=>{
 const db=await createCampaignCumulativeDb({migrations:[...before,'20261021070000_campaign_pause_lifecycle.sql']});
 try{
  await t.test('24h and 168h absolute durations unaffected by session timezone; each emits once',async()=>isolated(db,async()=>{
   await pause(db);const reminders=(await db.query('select milestone_hours,extract(epoch from (due_at-c.owner_paused_at))::integer seconds from campaign_pause_reminders r join owner_campaigns c on c.id=r.campaign_id order by milestone_hours')).rows;
   assert.deepEqual(reminders,[{milestone_hours:24,seconds:86400},{milestone_hours:168,seconds:604800}]);assert.equal(await reminder(db),0);
   await advancePause(db,24);await db.exec("set local timezone='America/Chicago'");assert.equal(await reminder(db),1);assert.equal(await reminder(db),0);
   await advancePause(db,168);await db.exec("set local timezone='Pacific/Auckland'");assert.equal(await reminder(db),1);assert.equal(await reminder(db),0);
   const notices=(await db.query("select recipient_user_id,notification_type,href from app_notifications where notification_type='campaign_pause_reminder'")).rows;
   assert.equal(notices.length,2);assert.ok(notices.every(n=>n.recipient_user_id===owner&&n.href===`/campaigns?campaign=${campaign}`));
  }));
  await t.test('before threshold, after Resume, cancellation and scheduled end emit none',async()=>isolated(db,async()=>{
   await pause(db);await advancePause(db,23);assert.equal(await reminder(db),0);
   const episode=(await row(db)).pause_episode_id;await resume(db,episode);
   await db.exec("update campaign_pause_reminders set due_at=now()-interval '1 second'");assert.equal(await reminder(db),0);
   await pause(db);await advancePause(db,25);await expire(db);assert.equal(await reminder(db),0);
   assert.equal((await db.query("select count(*)::integer n from app_notifications where notification_type='campaign_pause_reminder'")).rows[0].n,0);
  }));
  await t.test('current owner role is revalidated and suppression is not retried as spam',async()=>isolated(db,async()=>{
   await pause(db);await advancePause(db,25);await db.exec(`create or replace function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select false$$`);
   assert.equal(await reminder(db),0);assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders where processed_at is not null')).rows[0].n,1);
   await db.exec(`create or replace function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select $1='${salon}'::uuid and $2='${owner}'::uuid$$`);assert.equal(await reminder(db),0);
  }));
  await t.test('real notification Reminders preference suppresses delivery independently of Team and never catches up after opting in',async()=>isolated(db,async()=>{
   assert.equal((await db.query("select notification_category('campaign_pause_reminder') category")).rows[0].category,'reminders');
   await db.query("insert into notification_preferences(user_id,category,enabled) values($1,'reminders',false),($1,'team',true)",[owner]);
   await pause(db);await advancePause(db,25);assert.equal(await reminder(db),0);
   await db.exec("update notification_preferences set enabled=true where category='reminders';update notification_preferences set enabled=false where category='team'");
   assert.equal(await reminder(db),0,'already processed disabled milestone is not delivered later');
   await advancePause(db,168);assert.equal(await reminder(db),1,'Team disabled does not suppress the enabled Reminders category');
  }));
  await t.test('derived pending reminders do not block the existing parent campaign deletion lifecycle',async()=>isolated(db,async()=>{
   await pause(db);assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders')).rows[0].n,2);
   // Existing review retention remains in force. Remove that disposable
   // fixture record explicitly; only the new derived metadata cascades.
   await rejected(db,()=>db.query('delete from owner_campaigns where id=$1',[campaign]),/campaign_review_notices/);
   await db.query('delete from campaign_review_notices where campaign_id=$1',[campaign]);
   await db.query('delete from owner_campaigns where id=$1',[campaign]);assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders')).rows[0].n,0);
  }));
  await t.test('notification failure rolls back dedupe and retry inserts exactly once',async()=>isolated(db,async()=>{
   await pause(db);await advancePause(db,25);
   await db.exec(`create function fixture_notification_failure() returns trigger language plpgsql as $$begin raise exception 'fixture notification failure';end$$;create trigger fixture_notification_failure before insert on app_notifications for each row execute function fixture_notification_failure()`);
   await rejected(db,()=>reminder(db),/fixture notification failure/);
   assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders where processed_at is not null')).rows[0].n,0);
   await db.exec('drop trigger fixture_notification_failure on app_notifications');assert.equal(await reminder(db),1);assert.equal(await reminder(db),0);
  }));
 }finally{await db.close();}
});

test('existing paused campaigns receive conservative sticky state, unknown historical timing and no catch-up reminders',async()=>{
 const db=await createCampaignCumulativeDb({migrations:before});
 try{
  await pause(db);await db.exec("update owner_campaigns set updated_at=now()-interval '9 days',keep_running=true");
  await db.exec(migration);const c=await row(db);assert.equal(c.pause_origin,'legacy_unknown');assert.ok(c.owner_paused_at);assert.ok(c.pause_episode_id);
  assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders')).rows[0].n,0);
  await expire(db);await close(db);assert.equal(await renew(db),false);assert.equal(await reminder(db),0);
 }finally{await db.close();}
});
