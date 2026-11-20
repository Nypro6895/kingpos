
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {createCampaignCumulativeDb,ids} from './fixtures/campaign-cumulative-db.mjs';
const chain=['20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql','20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql','20261021080000_campaign_admin_pause_status.sql','20261021090000_campaign_pending_claim_demand.sql','20261021100000_campaign_paused_reserve_lifecycle.sql','20261021110000_campaign_credit_demand_and_budget.sql','20261023190000_campaign_run_again.sql','20261103150000_campaign_measurement_trust.sql'];
const {campaign,salon,owner,viewer,post}=ids,visitor='a'.repeat(64),geo={country:'US',state:'WI',city:'Milwaukee'};
export const database=()=>createCampaignCumulativeDb({migrations:chain});
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
const click=(db,over={})=>db.query('select owner_campaign_click($1,$2,$3,$4,$5) ok',[campaign,over.visitor??visitor,over.geo??geo,over.viewer===undefined?viewer:over.viewer,over.nonce===undefined?randomUUID():over.nonce]).then(r=>r.rows[0].ok);
const money=db=>one(db,`select (select to_jsonb(w) from campaign_wallets w) wallet,
 (select jsonb_agg(to_jsonb(l) order by id) from campaign_credit_ledger l) ledger,
 views,spent_cents,reserved_credits,released_credits from owner_campaigns where id=$1`,[campaign]);

test('a fast signed click creates attribution without a view or any credit movement; repeats remain unique',async()=>{
 const db=await database();try{
  const before=await money(db),nonce=randomUUID();
  assert.equal(await click(db,{nonce}),true);
  assert.deepEqual(await money(db),before);
  const attribution=await one(db,'select * from owner_campaign_attribution');
  assert.equal(attribution.user_id,viewer);
  assert.equal((await one(db,'select clicks from owner_campaigns')).clicks,1);
  assert.equal(await click(db,{nonce}),true);
  assert.equal(await click(db),true);
  assert.deepEqual(await one(db,'select * from owner_campaign_attribution'),attribution);
  assert.equal((await one(db,'select clicks from owner_campaigns')).clicks,1);
  assert.equal((await one(db,"select count(*)::int n from owner_campaign_events where kind='view'")).n,0);
  const result=await one(db,"select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,visitor,geo,viewer,nonce]);
  assert.equal(result.ok,true);
  const after=await money(db);
  assert.equal(after.views,1);assert.equal(after.spent_cents,1);assert.equal(after.wallet.reserved_credits,before.wallet.reserved_credits-1);
 }finally{await db.close()}
});

test('nonbillable clicks still reject stale/unsafe campaigns, geo, owner, missing nonce and unprivileged callers',async()=>{
 const db=await database();try{
  assert.equal(await click(db,{geo:{...geo,city:'Madison'}}),false);
  assert.equal(await click(db,{viewer:owner}),false);
  assert.equal(await click(db,{nonce:null}),false);
  assert.equal(await click(db,{visitor:'bad'}),false);
  for(const sql of ["update owner_campaigns set status='pending_review'","update owner_campaigns set status='cancelled'","update owner_campaigns set status='paused'","update owner_campaigns set ends_at=now()","update owner_campaigns set starts_at=now()+interval '1 day'","update owner_campaigns set approved_at=null","update owner_campaign_settings set config=config||'{\"enabled\":false}'","update campaign_wallets set installed=false","update salon_profile_looks set status='draft'"]){
   await db.exec('begin');try{await db.exec(sql);assert.equal(await click(db),false,sql);}finally{await db.exec('rollback')}
  }
  await db.exec('set role anon');
  await assert.rejects(click(db),/permission denied/);
  await db.exec('reset role');
  assert.equal((await one(db,'select clicks from owner_campaigns')).clicks,0);
 }finally{await db.close()}
});

test('the final funded view can settle a campaign without losing its immediate click',async()=>{
 const db=await database();try{
  await db.exec("update owner_campaigns set spent_cents=total_price_cents");
  assert.equal((await one(db,'select status from owner_campaigns')).status,'completed');
  const before=await money(db);
  assert.equal(await click(db),true);assert.deepEqual(await money(db),before);
 }finally{await db.close()}
});

test('report is owner-scoped and read-only; cancellations remain distinguishable from historical attribution',async()=>{
 const db=await database();try{
  const booking=randomUUID();
  assert.equal(await click(db),true);
  await db.query("insert into bookings(id,customer_user_id,source_reference_id,source_reference_type,status,confirmation_status,salon_id) values($1,$2,$3,'salon_profile_look','confirmed','confirmed',$4)",[booking,viewer,post,salon]);
  const report=async(who=owner,days=7)=>(await one(db,'select owner_campaign_report($1,$2,$3,$4) report',[salon,who,campaign,days])).report;
  const before=await money(db);
  let r=await report();
  assert.equal(r.deliveryReason,'eligible');assert.equal(r.lastViewAt,null);
  assert.equal(r.days[0].clicks,1);assert.equal(r.days[0].bookings,1);
  assert.equal(r.bookingOutcomes.other,1);
  await db.query("update bookings set status='completed' where id=$1",[booking]);
  r=await report();assert.equal(r.bookingOutcomes.completed,1);
  await db.query("update bookings set status='cancelled' where id=$1",[booking]);
  r=await report();assert.equal(r.bookingOutcomes.cancelled,1);assert.equal(r.bookingOutcomes.completed,0);
  assert.equal((await one(db,'select bookings from owner_campaigns')).bookings,1,'historical metric is not silently rewritten');
  assert.deepEqual(await money(db),before);
  await assert.rejects(report(viewer),/Owner access/);
  await assert.rejects(report(owner,8),/valid result period/);
  for(const [sql,reason] of [["update owner_campaigns set status='pending_review'",'in_review'],["update owner_campaigns set status='awaiting_payment'",'credits_needed'],["update owner_campaign_settings set config=config||'{\"enabled\":false}'",'platform_disabled']]){
   await db.exec('begin');try{await db.exec(sql);assert.equal((await report()).deliveryReason,reason)}finally{await db.exec('rollback')}
  }
 }finally{await db.close()}
});

test('guest clicks stay anonymous; expired attribution and repeated appointments cannot inflate booked-customer totals',async()=>{
 const db=await database();try{
  assert.equal(await click(db,{viewer:null,visitor:'b'.repeat(64)}),true);
  assert.equal((await one(db,'select count(*)::int n from owner_campaign_attribution')).n,0);
  assert.equal(await click(db),true);
  await db.exec("update owner_campaign_attribution set clicked_at=now()-interval '8 days'");
  const booking=()=>db.query("insert into bookings(id,customer_user_id,source_reference_id,source_reference_type,status,confirmation_status,salon_id) values($1,$2,$3,'salon_profile_look','confirmed','confirmed',$4)",[randomUUID(),viewer,post,salon]);
  await booking();assert.equal((await one(db,'select bookings from owner_campaigns')).bookings,0);
  await db.exec('update owner_campaign_attribution set clicked_at=now()');
  await booking();await booking();
  assert.equal((await one(db,'select bookings from owner_campaigns')).bookings,1);
 }finally{await db.close()}
});

const bundle=await build({entryPoints:['lib/campaign-report.ts','lib/campaign-credit-display.ts'],bundle:true,write:false,outdir:'out',format:'esm',platform:'node',alias:{'@':process.cwd()}});
const modules=await Promise.all(bundle.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));
const reports=modules.find(m=>m.campaignDaySeries),credits=modules.find(m=>m.creditUnits);
test('consent denomination and date ranges preserve exact totals, zero states and today',()=>{
 for(const units of [500,1500,3000,5000,100000])assert.equal(credits.creditUnits(credits.displayCredits(units)),units);
 assert.equal(credits.creditUnits(3600)/100,30);
 assert.deepEqual(reports.campaignLifetimeCosts({views:0,bookings:0,spent_cents:0}),{perView:null,perBookedCustomer:null});
 for(const days of [7,30,90]){
  const rows=Array.from({length:days},(_,i)=>{const d=new Date('2026-11-03T12:00:00Z');d.setUTCDate(d.getUTCDate()-i);return {day:d.toISOString().slice(0,10),views:1,clicks:2,likes:3,comments:4,bookings:5}});
  const series=reports.campaignDaySeries(rows,days,'2026-11-03');
  assert.equal(series.length,7);assert.equal(series.reduce((n,r)=>n+r.views,0),days);assert.equal(series.reduce((n,r)=>n+r.clicks,0),days*2);
  assert.equal(series.at(-1).until,'2026-11-04');
 }
});
