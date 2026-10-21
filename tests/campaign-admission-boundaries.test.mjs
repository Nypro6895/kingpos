import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id='00000000-0000-0000-0000-000000000001';
const salon='10000000-0000-0000-0000-000000000001';
const owner='20000000-0000-0000-0000-000000000001';
const person='20000000-0000-0000-0000-000000000002';
const nonce='30000000-0000-0000-0000-000000000001';
const nextNonce='30000000-0000-0000-0000-000000000002';
const visitor='a'.repeat(64),area={country:'US',state:'WI',city:'Milwaukee'};
const source=fs.readFileSync('supabase/migrations/202610080002_owner_campaigns.sql','utf8');
const wallet=fs.readFileSync('supabase/migrations/202610080004_campaign_market_credits.sql','utf8');
function statement(text,start,end){const at=text.indexOf(start);assert.ok(at>=0);const stop=text.indexOf(end,at);assert.ok(stop>at);return text.slice(at,stop+end.length)}
async function fixture(){
 const db=new PGlite();
 await db.exec(`create table locations(id uuid primary key);create table users(id uuid primary key);insert into locations values('${salon}');insert into users values('${owner}'),('${person}');`);
 await db.exec(statement(source,'create table public.owner_campaign_settings','\n);'));
 await db.exec(statement(source,'create table public.owner_campaigns','\n);'));
 await db.exec(statement(source,'create table public.owner_campaign_events','\n);'));
 await db.exec(statement(source,'create unique index owner_campaign_event_ticket',';'));
 await db.exec(`alter table owner_campaigns add credit_view_limit integer default 100,add settings_snapshot jsonb default '{"dailyFrequency":2,"maxAdsPerDay":6}',add reserved_credits integer default 100,add released_credits integer default 0;
 create table campaign_wallets(salon_id uuid primary key,reserved_credits integer,updated_at timestamptz);
 create table fixture_state(enabled boolean,valid_post boolean);insert into fixture_state values(true,true);
 create function owner_campaign_post(text,uuid,uuid) returns jsonb language sql as $$select case when valid_post then '{}'::jsonb else null end from fixture_state$$;
 create function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select $2='${owner}'::uuid$$;
 create function campaign_plugin_installed(uuid) returns boolean language sql as $$select enabled from fixture_state$$;
 insert into campaign_wallets values('${salon}',100,now());
 insert into owner_campaign_settings(config) values('{"enabled":true,"dailyFrequency":999,"maxAdsPerDay":999}');
 insert into owner_campaigns(id,salon_id,owner_id,source_type,source_id,title,area,location,country,state,city,days,daily_views,daily_price_cents,total_price_cents,status,payment_reference,approved_at,starts_at,ends_at)
 values('${id}','${salon}','${owner}','salon_profile_look','${nonce}','Test','city','Milwaukee','US','WI','Milwaukee',2,100,100,100,'running','fake-paid',now(),now()-interval '1 day',now()+interval '1 day');`);
 const core=statement(source,'create function public.owner_campaign_admit(','end $$;')
   .replace('public.owner_campaign_admit(','public.owner_campaign_admit_without_wallet(')
   .replaceAll('c.days*c.daily_views','c.credit_view_limit')
   .replace('select config into cfg from public.owner_campaign_settings where id;',"cfg:=c.settings_snapshot || jsonb_build_object('enabled',(select (config->>'enabled')::boolean from public.owner_campaign_settings where id));");
 await db.exec(core);
 await db.exec(statement(wallet,'create function public.owner_campaign_admit(','end $$;'));
 await db.exec(fs.readFileSync('supabase/migrations/20261021010000_campaign_selection_daily_cap.sql','utf8'));
 return db;
}
async function money(db){return (await db.query(`select views,spent_cents,(select reserved_credits from campaign_wallets) wallet,(select count(*)::int from owner_campaign_events) events from owner_campaigns`)).rows[0]}
async function admit(db,{kind='view',point=area,viewer=person,ticket=nonce}={}){return (await db.query('select owner_campaign_admit($1,$2,$3,$4,$5,$6) as ok',[id,visitor,kind,point,viewer,ticket])).rows[0].ok}

test('real SQL admission and wallet: one view, replay idempotent, snapshot frequency rejects a fresh ticket',async()=>{
 const db=await fixture();try{
  assert.equal(await admit(db),true);const after=await money(db);assert.deepEqual(after,{views:1,spent_cents:1,wallet:99,events:1});
  assert.equal(await admit(db),true);assert.deepEqual(await money(db),after,'retry same nonce never charges twice');
  await db.exec(`update owner_campaigns set settings_snapshot='{"dailyFrequency":1,"maxAdsPerDay":6}'`);
  assert.equal(await admit(db,{ticket:nextNonce}),false);assert.deepEqual(await money(db),after,'snapshot cap wins over global default 999');
  assert.equal((await db.query('select id from owner_campaign_candidates($1,$2,$3)',[area,visitor,person])).rows.length,0);
 }finally{await db.close()}
});

test('stale selection cannot admit after pause, expiry, ownership, area, budget, plugin or source changes',async()=>{
 const db=await fixture();try{
  assert.equal((await db.query('select id from owner_campaign_candidates($1,$2,$3)',[area,visitor,person])).rows.length,1);
  for(const [label,change,args] of [
   ['paused',"update owner_campaigns set status='paused'",{}],
   ['ends exactly now','update owner_campaigns set ends_at=now()',{}],
   ['future start',"update owner_campaigns set starts_at=now()+interval '1 second'",{}],
   ['owner','',{viewer:owner}],['wrong city','',{point:{...area,city:'Madison'}}],
   ['wrong country','',{point:{...area,country:'CA'}}],
   ['credit views exhausted','update owner_campaigns set views=credit_view_limit',{}],
   ['spend exhausted','update owner_campaigns set spent_cents=total_price_cents',{}],
   ['plugin disabled','update fixture_state set enabled=false',{}],
   ['post removed','update fixture_state set valid_post=false',{}],
   ['global emergency switch','update owner_campaign_settings set config=\'{"enabled":false}\'',{}],
   ['approval missing','update owner_campaigns set approved_at=null',{}],
   ['payment missing','update owner_campaigns set payment_reference=null',{}],
  ]){
   await db.exec('begin');try{if(change)await db.exec(change);const before=await money(db);assert.equal(await admit(db,args),false,label);assert.deepEqual(await money(db),before,label+' cannot create a view or charge')}finally{await db.exec('rollback')}
  }
 }finally{await db.close()}
});

test('newly started pacing admits its initial slot then rejects another view without changing wallet',async()=>{
 const db=await fixture();try{
  await db.exec('begin');await db.exec('update owner_campaigns set starts_at=now()');
  assert.equal(await admit(db),true);const after=await money(db);
  assert.equal(await admit(db,{ticket:nextNonce}),false);assert.deepEqual(await money(db),after);
  await db.exec('rollback');
 }finally{await db.close()}
});
