import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignCumulativeDb,ids,readCampaignMigration} from './fixtures/campaign-cumulative-db.mjs';

const {campaign,salon,owner,viewer,post,nonce}=ids;
const before=['20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql','20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql','20261021080000_campaign_admin_pause_status.sql','20261021090000_campaign_pending_claim_demand.sql'];
const migration=readCampaignMigration('20261021100000_campaign_paused_reserve_lifecycle.sql');
const baseline=process.env.CAMPAIGN_PAUSED_RESERVE_BASELINE==='1';
const geo={country:'US',state:'WI',city:'Milwaukee'};
const row=async db=>(await db.query('select * from owner_campaigns where id=$1',[campaign])).rows[0];
const pause=db=>db.query("select owner_campaign_change($1,$2,$3,'pause')",[campaign,salon,owner]);
const cancel=db=>db.query("select owner_campaign_change($1,$2,$3,'cancel')",[campaign,salon,owner]);
const resume=(db,episode)=>db.query('select owner_campaign_resume($1,$2,$3,$4)',[campaign,salon,owner,episode]);
const close=db=>db.query('select campaign_credit_close_expired($1)',[salon]);
const money=async db=>(await db.query(`select (select to_jsonb(w) from campaign_wallets w where salon_id=$1) wallet,
 (select jsonb_agg(to_jsonb(l) order by id) from campaign_credit_ledger l where salon_id=$1) ledger,
 (select jsonb_build_object('views',views,'spent',spent_cents,'reserved',reserved_credits,'released',released_credits,'limit',cycle_credit_limit,'viewLimit',credit_view_limit) from owner_campaigns where id=$2) campaign,
 (select count(*)::integer from owner_campaign_events) events`,[salon,campaign])).rows[0];
async function isolated(db,run){await db.exec('begin');try{await run();}finally{await db.exec('rollback');}}
async function rejected(db,run,pattern){await db.exec('savepoint expected_failure');try{await assert.rejects(run,pattern);}finally{await db.exec('rollback to expected_failure;release expected_failure');}}
async function advancePausedClock(db,hours=192){
 // Model a Pause acknowledged with two funded days remaining; now is beyond
 // its old wall-clock end. No time elapses or money changes in the fixture.
 await db.query("update owner_campaigns set owner_paused_at=now()-make_interval(hours=>$1),ends_at=now()-make_interval(hours=>$1)+interval '2 days' where id=$2",[hours,campaign]);
 await db.query('update campaign_pause_reminders r set due_at=c.owner_paused_at+make_interval(hours=>r.milestone_hours) from owner_campaigns c where c.id=r.campaign_id and c.id=$1',[campaign]);
}
const renew=async db=>(await db.query('select campaign_credit_renew($1) ok',[campaign])).rows[0].ok;
const reminder=async db=>(await db.query('select campaign_pause_reminder($1) count',[campaign])).rows[0].count;

test('acknowledged Pause retains its funded period across expiry, retry and explicit owner transitions',async t=>{
 const db=await createCampaignCumulativeDb({migrations:before});
 try{
  if(!baseline)await db.exec(migration);
  await t.test('scheduled expiry holds reserve and consent; worker renewal and expiry queue exclude the paused period',async()=>isolated(db,async()=>{
   await db.exec('update campaign_wallets set auto_topup_enabled=true,auto_topup_consent_at=now();update owner_campaigns set keep_running=true,auto_fund=true');
   const pre=await money(db);await pause(db);await advancePausedClock(db);const paused=await row(db);
   await close(db);assert.equal((await row(db)).status,'paused');assert.deepEqual(await money(db),pre);
   assert.equal(await renew(db),false);assert.deepEqual(await money(db),pre);
   const queue=(await db.query("select phase from campaign_credit_queue_items where (phase='close' and item_id=$1) or (phase='renew' and item_id=$2)",[salon,campaign])).rows;
   assert.deepEqual(queue,[]);await pause(db);const retry=await row(db);
   assert.equal(retry.pause_episode_id,paused.pause_episode_id);assert.deepEqual(retry.owner_paused_at,paused.owner_paused_at);
   assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders')).rows[0].n,2);
  }));
  await t.test('stale completion cannot run release before the owner-pause guard, even if it clears the marker',async()=>isolated(db,async()=>{
   await pause(db);await advancePausedClock(db);const pre=await money(db),paused=await row(db);
   await db.query("update owner_campaigns set status='completed',owner_paused_at=null where id=$1",[campaign]);
   const c=await row(db);assert.equal(c.status,'paused');assert.deepEqual(c.owner_paused_at,paused.owner_paused_at);assert.deepEqual(await money(db),pre);
   const triggers=(await db.query("select tgname from pg_trigger where tgrelid='owner_campaigns'::regclass and not tgisinternal and (tgtype & 2)=2 order by tgname")).rows.map(x=>x.tgname);
   assert.ok(triggers.indexOf('campaign_00_owner_pause_guard')>=0);assert.ok(triggers.indexOf('campaign_00_owner_pause_guard')<triggers.indexOf('campaign_credit_release'));
  }));
  await t.test('creating another published campaign cannot release the expired paused campaign',async()=>isolated(db,async()=>{
   await pause(db);await advancePausedClock(db);const pre=await money(db);
   const otherPost='20000000-0000-0000-0000-000000000002',otherCampaign='30000000-0000-0000-0000-000000000002';
   await db.query("insert into salon_profile_looks select $1,salon_id,'Blue nails','Another post',status,author_user_id,safety_hold,deleted_at from salon_profile_looks where id=$2",[otherPost,post]);
   await db.query("select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city','Milwaukee','United States','Wisconsin','Milwaukee',500,3,300,false,false)",[otherCampaign,salon,owner,otherPost]);
   assert.equal((await row(db)).status,'paused');assert.deepEqual(await money(db),pre);
  }));
  await t.test('Resume after the old end uses held credits with zero available wallet credits and preserves period counters',async()=>isolated(db,async()=>{
   await pause(db);await advancePausedClock(db);const paused=await row(db),pre=await money(db);
   assert.equal(pre.wallet.available_credits,0);await close(db);await resume(db,paused.pause_episode_id);const c=await row(db);
   assert.equal(c.status,'running');assert.equal(c.owner_paused_at,null);assert.equal(c.keep_running,paused.keep_running);
   assert.deepEqual(c.starts_at,paused.starts_at);assert.equal(new Date(c.ends_at).getTime()-new Date(paused.ends_at).getTime(),192*3600000);
   assert.deepEqual(await money(db),pre);const end=c.ends_at;await resume(db,paused.pause_episode_id);
   assert.deepEqual((await row(db)).ends_at,end);assert.deepEqual(await money(db),pre);
  }));
  await t.test('a new Pause cannot start after expiry, but an acknowledged Pause retry stays valid',async()=>isolated(db,async()=>{
   await db.exec("update owner_campaigns set ends_at=now()-interval '1 second'");const pre=await money(db),c=await row(db);
   await rejected(db,()=>pause(db),/current period/);assert.deepEqual(await money(db),pre);assert.deepEqual(await row(db),c);
  }));
  await t.test('historical impossible pause time does not mint paid time or silently release its held credits',async()=>isolated(db,async()=>{
   await pause(db);await db.exec("update owner_campaigns set ends_at=owner_paused_at-interval '1 second'");const c=await row(db),pre=await money(db);
   await rejected(db,()=>resume(db,c.pause_episode_id),/no remaining scheduled time/);assert.deepEqual(await money(db),pre);
   await cancel(db);assert.equal((await row(db)).released_credits,300);
  }));
  await t.test('admitted usage remains intact; paused requests cannot spend; Cancel returns only unused reserve exactly once',async()=>isolated(db,async()=>{
   assert.equal((await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,'a'.repeat(64),geo,viewer,nonce])).rows[0].ok,true);
   const admitted=await money(db);await pause(db);await advancePausedClock(db);
   for(const token of [nonce,'40000000-0000-0000-0000-000000000002'])assert.equal((await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,'a'.repeat(64),geo,viewer,token])).rows[0].ok,false);
   await close(db);assert.deepEqual(await money(db),admitted);await cancel(db);const c=await row(db),settled=await money(db);
   assert.equal(c.status,'cancelled');assert.equal(c.owner_paused_at,null);assert.equal(c.released_credits,300-admitted.campaign.spent);
   assert.equal(settled.wallet.reserved_credits,0);assert.equal(settled.wallet.available_credits,c.released_credits);
   assert.equal(c.spent_cents,admitted.campaign.spent);assert.equal(settled.events,admitted.events);
   await cancel(db);await close(db);assert.equal(await renew(db),false);assert.deepEqual(await money(db),settled);
   assert.equal((await db.query("select count(*)::integer n from campaign_credit_ledger where reference like 'release:%'")).rows[0].n,1);
  }));
  await t.test('source loss cannot consume or release a paused reserve; guarded Resume failure leaves Cancel available',async()=>isolated(db,async()=>{
   await pause(db);await advancePausedClock(db);await db.exec('update salon_profile_looks set safety_hold=true');const pre=await money(db),c=await row(db);
   await close(db);assert.equal((await row(db)).status,'paused');await rejected(db,()=>resume(db,c.pause_episode_id),/available, approved source/);assert.deepEqual(await money(db),pre);
   await cancel(db);assert.equal((await row(db)).status,'cancelled');assert.equal((await money(db)).wallet.available_credits,300);
  }));
  await t.test('stale episode and non-owner Resume cannot clear the latest Pause or change money',async()=>isolated(db,async()=>{
   await pause(db);const first=(await row(db)).pause_episode_id;await resume(db,first);await pause(db);const c=await row(db),pre=await money(db);
   await rejected(db,()=>resume(db,first),/pause changed/);
   await rejected(db,()=>db.query('select owner_campaign_resume($1,$2,$3,$4)',[campaign,salon,viewer,c.pause_episode_id]),/Owner access/);
   assert.deepEqual(await money(db),pre);assert.deepEqual(await row(db),c);
  }));
  await t.test('owner Pause does not protect a terminal rejection or archive from exact unused-credit release',async()=>isolated(db,async()=>{
   await pause(db);await advancePausedClock(db);await db.exec("update owner_campaigns set status='rejected'");let c=await row(db);
   assert.equal(c.status,'rejected');assert.equal(c.owner_paused_at,null);assert.equal(c.released_credits,300);
   const pre=await money(db);await db.exec("update owner_campaigns set status='rejected',archived_at=now()");assert.deepEqual(await money(db),pre);
  }));
  await t.test('system pause without owner intent and ordinary finished periods retain existing expiry settlement',async()=>isolated(db,async()=>{
   await db.exec("update owner_campaigns set status='paused',ends_at=now()-interval '1 second'");assert.equal((await row(db)).owner_paused_at,null);await close(db);
   const c=await row(db);assert.equal(c.status,'completed');assert.equal(c.released_credits,300);
  }));
  await t.test('24h/7day reminders survive the old end, are owner-only and cancel on Resume without repeated delivery',async()=>isolated(db,async()=>{
   await pause(db);await advancePausedClock(db,24);const c=await row(db);
   assert.equal(await reminder(db),1);assert.equal(await reminder(db),0);
   await advancePausedClock(db,192);await close(db);await db.exec("set local timezone='Pacific/Auckland'");
   assert.equal((await db.query("select count(*)::integer n from campaign_credit_queue_items where phase='pause_reminders' and item_id=$1",[campaign])).rows[0].n,1);
   assert.equal(await reminder(db),1);assert.equal(await reminder(db),0);
   const notices=(await db.query("select recipient_user_id,href from app_notifications where notification_type='campaign_pause_reminder'")).rows;
   assert.equal(notices.length,2);assert.ok(notices.every(n=>n.recipient_user_id===owner&&n.href===`/campaigns?campaign=${campaign}`));
   await resume(db,c.pause_episode_id);assert.equal(await reminder(db),0);
   await pause(db);await advancePausedClock(db,192);await cancel(db);assert.equal(await reminder(db),0);
   assert.equal((await db.query('select count(*)::integer n from campaign_pause_reminders where processed_at is null and cancelled_at is null')).rows[0].n,0);
  }));
  await t.test('service-only Resume and inaccessible internal fallback retain their ACL and security-definer boundary',async()=>{
   for(const [signature,service]of [['owner_campaign_resume(uuid,uuid,uuid,uuid)',true],['owner_campaign_resume_before_reserve_hold(uuid,uuid,uuid,uuid)',false]]){
    const p=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') auth,has_function_privilege('service_role',$1,'execute') svc from pg_proc where oid=$1::regprocedure",[signature])).rows[0];
    assert.equal(p.prosecdef,true);assert.ok(p.proconfig.includes('search_path=public'));assert.equal(p.anon,false);assert.equal(p.auth,false);assert.equal(p.svc,service);
   }
  });
 }finally{await db.close();}
});

test('already-settled legacy Pause does not fabricate a held balance; explicit new period retains the prior guarded path',async()=>{
 const db=await createCampaignCumulativeDb({migrations:before});
 try{
  await pause(db);await advancePausedClock(db);await close(db);const legacy=await row(db);
  assert.equal(legacy.status,'completed');assert.equal(legacy.released_credits,300);
  if(!baseline)await db.exec(migration);
  const pre=await money(db);await db.exec('update campaign_wallets set available_credits=0');const unavailable=await money(db);
  await assert.rejects(()=>resume(db,legacy.pause_episode_id),/remains paused/);assert.deepEqual(await money(db),unavailable);
  await db.exec('update campaign_wallets set available_credits=300');await resume(db,legacy.pause_episode_id);const c=await row(db);
  assert.equal(c.status,'running');assert.equal(c.owner_paused_at,null);assert.equal(c.reserved_credits,600);assert.equal(c.released_credits,300);
  assert.equal((await money(db)).wallet.reserved_credits,300);assert.equal((await money(db)).ledger.length,pre.ledger.length+1);
 }finally{await db.close();}
});
