import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const uid='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const salon='20000000-0000-0000-0000-000000000001';
const away='20000000-0000-0000-0000-000000000002';
const uuid=n=>`30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('activity area uses authenticated, repeated, recent and dominant evidence',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE TABLE users(id uuid PRIMARY KEY,auth_user_id uuid);
   INSERT INTO users VALUES('${uid}','${uuid(90)}'),('${other}','${uuid(91)}');
   CREATE FUNCTION current_public_user_id() RETURNS uuid LANGUAGE sql AS
    $$ SELECT nullif(current_setting('test.viewer',true),'')::uuid $$;
   CREATE FUNCTION normalize_search_text(text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $$ SELECT lower(regexp_replace(btrim(coalesce($1,'')),'\\s+',' ','g')) $$;
   CREATE TABLE locations(id uuid PRIMARY KEY,city text,state text,country text,status text);
   INSERT INTO locations VALUES('${salon}','Milwaukee','wi','US','active'),
    ('${away}','Chicago','IL','US','active');
   CREATE TABLE bookings(id uuid PRIMARY KEY,salon_id uuid,customer_user_id uuid,
    status text,start_at timestamptz,customer_account_link_method text,pos_ticket_id uuid);
   CREATE TABLE staff(id uuid PRIMARY KEY,salon_id uuid,account_user_id uuid,user_id uuid,is_active boolean);
   CREATE TABLE staff_workdays(id uuid PRIMARY KEY,staff_id uuid,salon_id uuid,check_in_at timestamptz);
   CREATE TABLE customers(id uuid PRIMARY KEY,customer_user_id uuid,location_id uuid,
    customer_account_claimed_at timestamptz);
   CREATE TABLE customer_account_claims(customer_id uuid,customer_user_id uuid,salon_id uuid,
    claim_status text,proof_type text);
   CREATE TABLE pos_tickets(id uuid PRIMARY KEY,customer_id uuid,salon_id uuid,closed_at timestamptz,
    opened_at timestamptz,status text,source_booking_id uuid);`);
  await db.exec(readFileSync('supabase/migrations/20261009110002_explore_activity_region.sql','utf8'));
  const activity=async()=> (await db.query('SELECT get_explore_activity_region() AS area')).rows[0].area;
  const bookings=async(count,region=salon,viewer=uid,offset=0,status='completed',method='authenticated_booking')=>{
   for(let i=1;i<=count;i++) await db.query(
    `INSERT INTO bookings VALUES($1,$2,$3,$4,now()-make_interval(days=>$5),$6,NULL)`,
    [uuid(offset+i),region,viewer,status,i,method]);
  };
  const isolated=async(name,run)=>t.test(name,async()=>{
   await db.exec('BEGIN');
   try{await db.query("SELECT set_config('test.viewer',$1,false)",[uid]);await run();}
   finally{await db.exec('ROLLBACK');}
  });
  await isolated('one visit and three same-day visits do not establish an activity area',async()=>{
   await bookings(1);assert.equal((await activity()).source,'none');
   await db.exec(`INSERT INTO bookings SELECT '${uuid(2)}',salon_id,customer_user_id,status,start_at,
    customer_account_link_method,NULL FROM bookings LIMIT 1;
    INSERT INTO bookings SELECT '${uuid(3)}',salon_id,customer_user_id,status,start_at,
    customer_account_link_method,NULL FROM bookings LIMIT 1;`);
   assert.equal((await activity()).source,'none');
  });
  await isolated('three separate completed visits return normalized activity metadata',async()=>{
   await bookings(3);const area=await activity();
   assert.deepEqual({label:area.label,source:area.source,days:area.evidenceDays,confidence:area.confidence},
    {label:'Milwaukee, WI',source:'activity',days:3,confidence:1});
   assert.ok(area.lastObservedAt);
  });
  await isolated('ties and less than 70% dominant region return none',async()=>{
   await bookings(3);await bookings(3,away,uid,10);assert.equal((await activity()).source,'none');
   await db.exec(`DELETE FROM bookings WHERE id='${uuid(13)}'`);assert.equal((await activity()).source,'none');
   await db.exec(`DELETE FROM bookings WHERE id='${uuid(12)}'`);assert.equal((await activity()).label,'Milwaukee, WI');
  });
  await isolated('other accounts, guests, unverified links and failed bookings cannot infer region',async()=>{
   await bookings(3,salon,other);await bookings(3,salon,uid,10,'cancelled');
   await bookings(3,salon,uid,20,'completed','manual_account_link');
   assert.equal((await activity()).source,'none');
   await db.query("SELECT set_config('test.viewer',$1,false)",[other]);assert.equal((await activity()).source,'activity');
   await db.query("SELECT set_config('test.viewer','',false)");assert.equal((await activity()).source,'none');
   await db.exec('SET LOCAL ROLE anon');await assert.rejects(activity,/permission denied/);
  });
  await isolated('work requires actual active identity-linked check-ins over distinct days',async()=>{
   await db.exec(`INSERT INTO staff VALUES('${uuid(30)}','${salon}',NULL,'${uuid(90)}',true);
    INSERT INTO staff_workdays SELECT md5(n::text)::uuid,'${uuid(30)}','${salon}',now()-make_interval(days=>n)
     FROM generate_series(1,3) n;`);
   assert.equal((await activity()).evidenceDays,3);
   await db.exec('UPDATE staff SET is_active=false');assert.equal((await activity()).source,'none');
  });
  await isolated('POS requires current identity claim proof and excludes booking duplicate',async()=>{
   await bookings(2);
   await db.exec(`INSERT INTO customers VALUES('${uuid(40)}','${uid}','${salon}',now());
    INSERT INTO pos_tickets VALUES('${uuid(41)}','${uuid(40)}','${salon}',now()-interval '3 days',now(),'closed',NULL);`);
   assert.equal((await activity()).source,'none');
   await db.exec(`INSERT INTO customer_account_claims VALUES('${uuid(40)}','${uid}','${salon}','linked','customer_claim_token')`);
   assert.equal((await activity()).evidenceDays,3);
   await db.exec(`UPDATE bookings SET pos_ticket_id='${uuid(41)}' WHERE id='${uuid(1)}'`);
   assert.equal((await activity()).source,'none');
  });
  await isolated('old, future and inactive salon evidence is excluded',async()=>{
   await bookings(3);await db.exec(`UPDATE bookings SET start_at=now()-interval '91 days'`);
   assert.equal((await activity()).source,'none');
   await db.exec(`UPDATE bookings SET start_at=now()+interval '1 day'`);assert.equal((await activity()).source,'none');
   await db.exec(`UPDATE bookings SET start_at=now()-make_interval(days=>right(id::text,1)::integer);
    UPDATE locations SET status='deleted' WHERE id='${salon}'`);assert.equal((await activity()).source,'none');
  });
  await isolated('history overflow falls back instead of trusting a biased truncated sample',async()=>{
   await db.exec(`INSERT INTO bookings SELECT md5(n::text)::uuid,'${salon}','${uid}','completed',
    now()-interval '1 day','authenticated_booking',NULL FROM generate_series(1,513) n;`);
   assert.equal((await activity()).source,'none');
  });
 }finally{await db.close();}
});
