import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('record search selector cost on 100k synthetic events without changing eligibility',async()=>{
 const db=new PGlite();try{
  await db.exec(`create table owner_campaigns(id uuid primary key,salon_id uuid,owner_id uuid,source_type text,source_id uuid,status text,starts_at timestamptz,ends_at timestamptz,payment_reference text,approved_at timestamptz,views int,credit_view_limit int,spent_cents int,total_price_cents int,country text,area text,location text,state text,city text,daily_views int,settings_snapshot jsonb,created_at timestamptz);
  create table owner_campaign_events(campaign_id uuid,visitor_hash text,day date,kind text,created_at timestamptz,ordinal int);
  create index event_pk_fixture on owner_campaign_events(campaign_id,visitor_hash,day,kind,ordinal);
  create index event_daily_fixture on owner_campaign_events(campaign_id,day,kind);
  create function owner_campaign_post(text,uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
  create function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
  insert into owner_campaigns select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'20000000-0000-0000-0000-000000000001','custom','30000000-0000-0000-0000-000000000001','running',now()-interval '1 day',now()+interval '1 day','paid',now(),0,100000,0,10000,'US','city','Milwaukee','WI','Milwaukee',100000000,'{"dailyFrequency":2,"maxAdsPerDay":6}',now()-interval '2 days' from generate_series(1,8) i;
  insert into owner_campaign_events select ('00000000-0000-0000-0000-'||lpad((i%8+1)::text,12,'0'))::uuid,md5(i::text),(now() at time zone 'America/Chicago')::date,'view',now(),1 from generate_series(1,100000) i;
  analyze owner_campaigns;analyze owner_campaign_events;`);
  await db.exec(`create role anon;create role authenticated;create role service_role;create table explore_salon_documents(salon_id uuid primary key,salon_name_search text,service_search_text text,service_category_search_text text);insert into explore_salon_documents select salon_id,'Salon','gel manicure','Nails' from owner_campaigns;create table explore_unified_content_source(salon_id uuid,source_type text,content_id uuid,is_reference boolean,search_terms tsvector);`);
  const timings={};
  for(const [name,file] of [['patched','20261021010000_campaign_selection_daily_cap.sql'],['search','20261021020000_campaign_search_relevance.sql']]){
   await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));const samples=[];
   for(let i=0;i<6;i++){const start=performance.now();const result=await db.query(name==='search'?"select id from owner_campaign_search_candidates($1,$2,null,'gel manicure','service','Nails')":'select id from owner_campaign_candidates($1,$2)',[{country:'US',state:'WI',city:'Milwaukee'},'new-visitor']);assert.equal(result.rows.length,6);if(i)samples.push(performance.now()-start)}
   samples.sort((a,b)=>a-b);timings[name]={medianMs:samples[2],samplesMs:samples};
  }
  const report={environment:'PGlite WASM on local Mac; 8 campaigns, 100000 synthetic same-day events; 5 warm samples. Not production latency.',timings};
  fs.mkdirSync('artifacts/campaign-search-preview',{recursive:true});fs.writeFileSync('artifacts/campaign-search-preview/selection-cost.json',JSON.stringify(report,null,2));
 }finally{await db.close()}
});
