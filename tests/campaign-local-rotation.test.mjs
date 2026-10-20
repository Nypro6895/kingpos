import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('local campaign SQL rotates admitted views, respects area/status/budget/frequency, and keeps one salon per selection',async()=>{
 const db=new PGlite();try{
 await db.exec(`create table owner_campaigns(id uuid primary key,salon_id uuid,owner_id uuid,source_type text,source_id uuid,status text,starts_at timestamptz,ends_at timestamptz,payment_reference text,approved_at timestamptz,views int,credit_view_limit int,spent_cents int,total_price_cents int,country text,area text,location text,state text,city text,daily_views int,settings_snapshot jsonb,created_at timestamptz);
 create table owner_campaign_events(campaign_id uuid,visitor_hash text,day date,kind text,created_at timestamptz);
 create function owner_campaign_post(text,uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
 insert into owner_campaigns select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'20000000-0000-0000-0000-000000000001','custom','30000000-0000-0000-0000-000000000001','running',now()-interval '1 day'+i*interval '1 minute',now()+interval '1 day','paid',now(),0,1000,0,100,'US','city','Milwaukee','WI','Milwaukee',500,'{"dailyFrequency":2}',now()-interval '2 days'+i*interval '1 minute' from generate_series(1,8) i;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261019170000_campaign_local_rotation.sql','utf8'));
 const area={country:'US',state:'WI',city:'Milwaukee',zipcode:'53218',neighborhood:''};
 const select=async(a=area)=> (await db.query('select id from owner_campaign_candidates($1,$2)',[a,'visitor'])).rows.map(r=>Number(r.id.slice(-12)));
 assert.deepEqual(await select(),[1,2,3,4,5,6]);
 await db.exec(`insert into owner_campaign_events values ('00000000-0000-0000-0000-000000000001','visitor',current_date-1,'view',now()-interval '1 day')`);
 assert.deepEqual(await select(),[2,3,4,5,6,7]);
 assert.deepEqual(await select({...area,city:'Madison'}),[]);
 await db.exec(`update owner_campaigns set status='paused' where id::text like '%000000000002';update owner_campaigns set spent_cents=100 where id::text like '%000000000003';update owner_campaigns set ends_at=now()-interval '1 hour' where id::text like '%000000000004';update owner_campaigns set salon_id='10000000-0000-0000-0000-000000000005' where id::text like '%000000000006'`);
 assert.deepEqual(await select(),[5,7,8,1]);
 await db.exec(`insert into owner_campaign_events select '00000000-0000-0000-0000-000000000005','visitor',(now() at time zone 'America/Chicago')::date,'view',now() from generate_series(1,2)`);
 assert.deepEqual(await select(),[6,7,8,1]);
 await db.exec(`update owner_campaigns set approved_at=null where id::text like '%000000000007';update owner_campaigns set payment_reference=null where id::text like '%000000000008';update owner_campaigns set views=credit_view_limit where id::text like '%000000000001'`);
 assert.deepEqual(await select(),[6]);
 assert.deepEqual((await db.query('select id from owner_campaign_candidates($1,$2,$3)',[area,'visitor','20000000-0000-0000-0000-000000000001'])).rows,[]);

 }finally{await db.close()}
});

