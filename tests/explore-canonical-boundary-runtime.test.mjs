import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const names=['get_public_explore_decision_signals','get_public_content_booking_options','get_public_salon_identity','get_public_explore_reputation_summaries','get_public_lumi_trust_signals','get_public_salon_service_prices'];

test('canonical public RPCs preserve original OIDs and bodies while requiring bounded current public identities', {timeout:120_000},async()=>{
 const db=new PGlite();
 try {
  await db.exec(readFileSync('tests/fixtures/explore-canonical-bootstrap.sql','utf8'));
  await db.exec(`CREATE SCHEMA extensions;
   DROP FUNCTION salon_profile_public_salon_exists(uuid);
   CREATE FUNCTION salon_profile_public_salon_exists(target_salon_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM locations l JOIN salon_settings s ON s.salon_id=l.id WHERE l.id=target_salon_id AND l.status='active' AND s.public_discovery_enabled) $$;
   ALTER TABLE services ADD category text,ADD base_price numeric,ADD duration_minutes int;
   ALTER TABLE staff ADD display_name text;
   CREATE TABLE booking_settings(salon_id uuid PRIMARY KEY,booking_enabled boolean,online_booking_visible boolean,guest_booking_enabled boolean);
   CREATE TABLE bookings(id uuid PRIMARY KEY,salon_id uuid,status text);
   CREATE TABLE salon_profile_reviews(id uuid PRIMARY KEY,salon_id uuid,rating int,moderation_status text,verification_status text);
   CREATE TABLE salon_verification_requests(id uuid PRIMARY KEY,salon_id uuid,status text,attempt int);
   CREATE TABLE salon_profile_looks(id uuid PRIMARY KEY,salon_id uuid,status text,title text,caption text,media_path text);
   CREATE TABLE salon_profile_updates(id uuid PRIMARY KEY,salon_id uuid,status text,title text,caption text,media_path text);
   CREATE TABLE salon_profile_content_booking_configs(id uuid PRIMARY KEY,salon_id uuid,look_id uuid,update_id uuid,source_type text,credited_staff_id uuid,primary_service_id uuid,booking_cta_enabled boolean,booking_note text,cta_label text);
   CREATE TABLE beauty_profiles(id uuid PRIMARY KEY,visibility text);
   CREATE TABLE beauty_posts(id uuid PRIMARY KEY,profile_id uuid,post_type text,caption text,deleted_at timestamptz,visibility text,moderation_status text);
   CREATE TABLE beauty_post_attributions(post_id uuid PRIMARY KEY,salon_id uuid,staff_id uuid);
   CREATE TABLE beauty_post_verifications(post_id uuid PRIMARY KEY,state text);
   CREATE TABLE beauty_post_media(id uuid PRIMARY KEY,post_id uuid,object_path text,role text,display_order int,created_at timestamptz);`);
  await db.exec(readFileSync('supabase/migrations/202610050001_lumi_trust_return_evidence.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009094031_lumi_trust_selected_read_cost.sql','utf8'));
  // Actual production signatures and non-LUMI bodies, captured read-only.
  const audited=JSON.parse(readFileSync('tests/fixtures/explore-canonical-production-contract.json','utf8'));
  for(const name of ['get_public_salon_profile_reputation_summary',...names.filter(name=>name!=='get_public_lumi_trust_signals')]) {
   await db.exec(audited.find(row=>row.proname===name).definition);
  }
  for(let n=1;n<=6;n++) {
   await db.query("INSERT INTO locations VALUES($1,$2,'Shop',$3,CASE WHEN $4 THEN now()+interval '1 day' ELSE now()-interval '1 day' END)",[id(n),id(100+n),n===4?'inactive':n===5?'permanently_closed':'active',n===6]);
   await db.query("INSERT INTO salon_settings VALUES($1,$2,CASE WHEN $3 THEN now()+interval '1 day' ELSE NULL END,'America/Chicago')",[id(n),n!==3,n===2]);
   await db.query("INSERT INTO services VALUES($1,$2,'Manicure',true,true,'Nails',35,45)",[id(1000+n),id(n)]);
  }
  await db.query('INSERT INTO booking_settings VALUES($1,true,true,true)',[id(1)]);
  await db.query("INSERT INTO salon_profile_reviews VALUES($1,$2,5,'visible','verified')",[id(2000),id(1)]);
  const beforeOids={},beforeBodies={};
  for(const name of names) {
   const meta=(await db.query("SELECT $1::regprocedure::oid AS oid,pg_get_functiondef($1::regprocedure) definition",[`${name}(uuid[])`])).rows[0];
   beforeOids[name]=meta.oid;beforeBodies[name]=meta.definition;
  }
  await db.exec(`CREATE VIEW decision_dependency AS SELECT * FROM get_public_explore_decision_signals(ARRAY['${id(1)}','${id(2)}']::uuid[]);`);
  assert.equal((await db.query('SELECT * FROM decision_dependency')).rows.length,2,'legacy function exposes future salon before the correction');
  await db.exec(readFileSync('supabase/migrations/20261009096031_explore_canonical_public_bounds.sql','utf8'));
  assert.equal((await db.query('SELECT * FROM decision_dependency')).rows.length,1,'compiled view now calls the same public OID through its new guard');
  for(const name of names) {
   const oid=(await db.query('SELECT $1::regprocedure::oid AS oid',[`${name}(uuid[])`])).rows[0].oid;
   assert.equal(oid,beforeOids[name]);
   const core=`_explore_core_${name}`;
   const copied=(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',[`${core}(uuid[])`])).rows[0].definition;
   assert.equal(copied.replace(`FUNCTION public.${core}(`,`FUNCTION public.${name}(`),beforeBodies[name],'the private business/evidence body is copied without rewriting');
   assert.equal((await db.query('SELECT * FROM '+name+'(NULL)')).rows.length,0,'NULL must not become a global canonical query');
   assert.equal((await db.query('SELECT * FROM '+name+'($1::uuid[])',[[]])).rows.length,0);
   assert.equal((await db.query('SELECT * FROM '+name+'($1::uuid[])',[[null]])).rows.length,0);
   const ids=name==='get_public_salon_service_prices'?[id(1001),id(1002),id(1003),id(1004),id(1005),id(1006)]:[id(1),id(2),id(3),id(4),id(5),id(6)];
   const visible=(await db.query('SELECT * FROM '+name+'($1::uuid[])',[ids])).rows;
   assert.ok(visible.every(row=>row.salon_id===id(1)),'future, disabled and lifecycle-hidden salons cannot leak fields');
   assert.equal((await db.query('SELECT * FROM '+name+'($1::uuid[])',[Array(100).fill(ids[0])])).rows.length,visible.length,'legitimate100-element inputs remain accepted and are deduplicated');
   await assert.rejects(db.query('SELECT * FROM '+name+'($1::uuid[])',[Array(101).fill(ids[0])]),error=>error.code==='22023');
   assert.equal((await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') allowed",[`${core}(uuid[])`])).rows[0].allowed,false);
   assert.equal((await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[`${core}(uuid[])`])).rows[0].allowed,false);
  }
  const decision=(await db.query('SELECT * FROM get_public_explore_decision_signals($1)',[[id(1)]])).rows[0];
  assert.equal(Number(decision.average_rating),5);assert.equal(Number(decision.review_count),1);assert.equal(decision.bookable_service_id,id(1001));assert.equal(decision.booking_enabled,true);
  const guard=(await db.query('SELECT salon_profile_public_salon_exists($1) visible',[id(5)])).rows[0];
  assert.equal(guard.visible,false,'operating930 retains its own closed-place exception rather than expanding every public profile RPC');
  await db.exec('SET ROLE anon');
  assert.equal((await db.query('SELECT * FROM get_public_explore_decision_signals($1)',[[id(1)]])).rows.length,1);
  await db.exec('RESET ROLE');
 }finally{await db.close();}
});
