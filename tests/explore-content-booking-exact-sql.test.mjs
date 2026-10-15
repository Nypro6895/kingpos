import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('exact content RPC selects inside source branches, retains old posts, and rechecks public booking and staff fields', {timeout:120_000},async()=>{
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try {
  await db.exec(readFileSync('tests/fixtures/explore-social-bootstrap.sql','utf8'));
  await db.exec(`ALTER TABLE locations ADD status text DEFAULT 'active',ADD created_at timestamptz DEFAULT now();
   ALTER TABLE salon_settings ADD public_discovery_enabled boolean DEFAULT true,ADD public_discovery_published_at timestamptz;
   ALTER TABLE staff ADD salon_id uuid,ADD is_active boolean DEFAULT true,ADD account_user_id uuid,ADD user_id uuid;
   ALTER TABLE users ADD auth_user_id uuid;
   GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
  // Use the actual projection shape/indexes but omit source-sync triggers so
  // stale projection rows can deliberately test the source visibility gates.
  const social=readFileSync('supabase/migrations/20261009080031_explore_social_discovery.sql','utf8');
  await db.exec(social.slice(0,social.indexOf('CREATE VIEW'))+'COMMIT;');
  const boundary=readFileSync('supabase/migrations/20261009096031_explore_canonical_public_bounds.sql','utf8');
  await db.exec(boundary.slice(0,boundary.indexOf('DO $migration$'))+'COMMIT;');
  const production=JSON.parse(readFileSync('tests/fixtures/explore-canonical-production-contract.json','utf8')).find(row=>row.proname==='get_public_content_booking_options').definition;
  await db.exec(production);
  await db.exec(production.replace('FUNCTION public.get_public_content_booking_options(', 'FUNCTION public._explore_core_get_public_content_booking_options('));
  const beforeOid=(await db.query("SELECT 'get_public_content_booking_options(uuid[])'::regprocedure::oid AS oid")).rows[0].oid;
  await db.exec(readFileSync('supabase/migrations/20261009097031_explore_exact_content_booking.sql','utf8'));
  assert.equal((await db.query("SELECT 'get_public_content_booking_options(uuid[])'::regprocedure::oid AS oid")).rows[0].oid,beforeOid);
  for(let n=1;n<=2;n++) {
   await db.query('INSERT INTO locations(id,name,created_at) VALUES($1,$2,now()-interval \'2 days\')',[id(n),`Salon${n}`]);
   await db.query('INSERT INTO salon_settings(salon_id) VALUES($1)',[id(n)]);
   await db.query("INSERT INTO services VALUES($1,$2,'Manicure','Nails',35,45,true,true)",[id(100+n),id(n)]);
   await db.query('INSERT INTO booking_settings VALUES($1,true,true,true)',[id(n)]);
  }
  await db.query("INSERT INTO staff(id,salon_id,display_name) VALUES($1,$2,'Current professional'),($3,$4,'Other salon professional')",[id(500),id(1),id(501),id(2)]);
  for(let n=1;n<=150;n++) {
   const content=id(1000+n);
   await db.query("INSERT INTO salon_profile_looks(id,salon_id,title,caption,media_path,status,published_at) VALUES($1,$2,'Look','Caption',$3,'published',now()-($4||' minutes')::interval)",[content,id(1),`look-${n}.webp`,n]);
   await db.query("INSERT INTO salon_profile_content_booking_configs(id,salon_id,look_id,source_type,primary_service_id,credited_staff_id,booking_cta_enabled) VALUES($1,$2,$3,'salon_profile_look',$4,$5,true)",[id(3000+n),id(1),content,id(101),id(500)]);
   await db.query("INSERT INTO explore_social_content_documents(content_key,source_type,content_id,salon_id,published_at,bookable) SELECT 'salon_profile_look:'||id,'salon_profile_look',id,salon_id,published_at,true FROM salon_profile_looks WHERE id=$1",[content]);
  }
  const exact=async(salons,ids)=>(await db.query('SELECT * FROM get_public_explore_content_booking_options($1::uuid[],$2::uuid[])',[salons,ids])).rows;
  const initial=async(salons)=>(await db.query('SELECT * FROM get_public_content_booking_options($1::uuid[])',[salons])).rows;
  const old=id(1150);
  const latest=await initial([id(1)]);
  assert.equal(latest.length,100);assert.ok(!latest.some(row=>row.content_id===old));
  assert.equal((await exact([id(1)],[old]))[0].content_id,old,'a known old post is not lost behind the initial-list cap');
  assert.equal((await exact([id(2)],[old])).length,0,'requested salon and post identities must belong together');
  assert.equal((await exact([id(1)],[old,old]))[0].booking_enabled,true);
  await db.query("INSERT INTO salon_profile_content_booking_configs(id,salon_id,look_id,source_type,primary_service_id,credited_staff_id,booking_cta_enabled,booking_note,updated_at) VALUES($1,$2,$3,'salon_profile_look',$4,$5,true,'Latest configuration',now()+interval '1 minute')",[id(9999),id(1),old,id(101),id(500)]);
  assert.equal((await exact([id(1)],[old])).length,1,'duplicate config history yields only the latest selected configuration');
  assert.equal((await exact([id(1)],[old]))[0].booking_note,'Latest configuration');
  for(const [salons,posts] of [[null,[old]],[[id(1)],null],[[],[old]],[[id(1)],[]]]) assert.equal((await exact(salons,posts)).length,0);
  assert.equal((await initial(null)).length,0);
  await assert.rejects(exact(Array(101).fill(id(1)),[old]),e=>e.code==='22023');
  await assert.rejects(exact([id(1)],Array(101).fill(old)),e=>e.code==='22023');
  const patch=async(sql,params=[])=>db.query(sql,params);
  await patch('UPDATE booking_settings SET online_booking_visible=false WHERE salon_id=$1',[id(1)]);
  assert.equal((await exact([id(1)],[old]))[0].booking_enabled,false,'current settings override a stale bookable projection');
  assert.equal((await exact([id(1)],[old]))[0].booking_href,null);
  await patch('UPDATE booking_settings SET online_booking_visible=true,guest_booking_enabled=false WHERE salon_id=$1',[id(1)]);
  assert.equal((await exact([id(1)],[old]))[0].booking_enabled,false);
  await patch('UPDATE booking_settings SET guest_booking_enabled=true WHERE salon_id=$1',[id(1)]);
  await patch('UPDATE salon_profile_content_booking_configs SET primary_service_id=$1,credited_staff_id=$2 WHERE look_id=$3',[id(102),id(501),old]);
  let option=(await exact([id(1)],[old]))[0];
  assert.equal(option.primary_service_id,null);assert.equal(option.credited_staff_name,null);assert.equal(option.credited_staff_id,null);
  assert.equal(option.readiness_state,'inspiration_only');assert.equal(option.booking_enabled,false);
  await patch('UPDATE salon_profile_content_booking_configs SET primary_service_id=$1,credited_staff_id=$2 WHERE look_id=$3',[id(101),id(500),old]);
  await patch('UPDATE staff SET is_active=false WHERE id=$1',[id(500)]);
  assert.equal((await exact([id(1)],[old]))[0].credited_staff_name,null);
  await patch('UPDATE staff SET is_active=true,account_user_id=$1 WHERE id=$2',[id(9000),id(500)]);
  await patch("INSERT INTO users(id,status,display_name) VALUES($1,'deleted','Deleted professional')",[id(9000)]);
  assert.equal((await exact([id(1)],[old]))[0].credited_staff_name,null);
  await patch('UPDATE services SET online_booking_enabled=false WHERE id=$1',[id(101)]);
  option=(await exact([id(1)],[old]))[0];assert.equal(option.primary_service_id,null);assert.equal(option.booking_enabled,false);
  await patch('UPDATE services SET online_booking_enabled=true WHERE id=$1',[id(101)]);
  for(const sql of ["UPDATE salon_profile_looks SET safety_hold=true WHERE id=$1","UPDATE salon_profile_looks SET published_at=now()+interval '1 day' WHERE id=$1","UPDATE salon_profile_looks SET status='draft' WHERE id=$1"]) {
   await patch(sql,[old]);assert.equal((await exact([id(1)],[old])).length,0);
   await patch("UPDATE salon_profile_looks SET safety_hold=false,status='published',published_at=now()-interval '1 day' WHERE id=$1",[old]);
  }
  await patch("INSERT INTO salon_profile_media_assets(id,salon_id,object_path,status) VALUES($1,$2,'look-150.webp','quarantined')",[id(6000),id(1)]);
  assert.equal((await exact([id(1)],[old])).length,0);
  await patch('DELETE FROM salon_profile_media_assets WHERE id=$1',[id(6000)]);
  await patch('UPDATE salon_settings SET public_discovery_published_at=now()+interval \'1 day\' WHERE salon_id=$1',[id(1)]);
  assert.equal((await exact([id(1)],[old])).length,0);
  await patch('UPDATE salon_settings SET public_discovery_published_at=NULL WHERE salon_id=$1',[id(1)]);
  await patch("INSERT INTO users(id,status,display_name) VALUES($1,'active','Author')",[id(9001)]);
  await patch("INSERT INTO beauty_profiles VALUES($1,$2,'public')",[id(7000),id(9001)]);
  await patch("INSERT INTO beauty_posts(id,profile_id,author_user_id,created_at,caption,post_type,visibility,moderation_status) VALUES($1,$2,$3,now()-interval '1 day','Transformation','before_after','public','visible')",[id(7001),id(7000),id(9001)]);
  await patch('INSERT INTO beauty_post_attributions VALUES($1,$2,NULL)',[id(7001),id(1)]);
  await patch("INSERT INTO beauty_post_verifications VALUES($1,'verified')",[id(7001)]);
  await patch("INSERT INTO beauty_post_media(id,post_id,object_path,role) VALUES($1,$2,'after.webp','after')",[id(7002),id(7001)]);
  await patch("INSERT INTO explore_social_content_documents(content_key,source_type,content_id,salon_id,published_at,bookable) VALUES($1,'beauty_post',$2,$3,now()-interval '1 day',true)",[`beauty_post:${id(7001)}`,id(7001),id(1)]);
  assert.equal((await exact([id(1)],[id(7001)]))[0].source_type,'beauty_post');
  for(const sql of ["UPDATE beauty_posts SET safety_hold=true WHERE id=$1","UPDATE beauty_posts SET visibility='private' WHERE id=$1","UPDATE beauty_posts SET moderation_status='hidden' WHERE id=$1","UPDATE beauty_posts SET deleted_at=now() WHERE id=$1","UPDATE beauty_posts SET created_at=now()+interval '1 day' WHERE id=$1"]) {
   await patch(sql,[id(7001)]);assert.equal((await exact([id(1)],[id(7001)])).length,0);
   await patch("UPDATE beauty_posts SET safety_hold=false,visibility='public',moderation_status='visible',deleted_at=NULL,created_at=now()-interval '1 day' WHERE id=$1",[id(7001)]);
  }
  await patch("UPDATE users SET status='deleted' WHERE id=$1",[id(9001)]);
  assert.equal((await exact([id(1)],[id(7001)])).length,0);
  await patch('DELETE FROM salon_profile_looks WHERE id=$1',[old]);
  assert.equal((await exact([id(1)],[old])).length,0,'missing source cannot reappear from its stale projection');
  const core=(await db.query("SELECT pg_get_functiondef('_explore_core_selected_content_booking_options(uuid[],uuid[])'::regprocedure) definition")).rows[0].definition;
  assert.ok(core.includes('configs.look_id = any(target_content_ids)'));assert.ok(core.includes('posts.id = any(target_content_ids)'));
  assert.equal((await db.query("SELECT has_function_privilege('anon','_explore_core_selected_content_booking_options(uuid[],uuid[])','EXECUTE') allowed")).rows[0].allowed,false);
  await db.exec('SET ROLE anon');
  assert.equal((await exact([id(1)],[id(1001)])).length,1);
  await db.exec('RESET ROLE');
 }finally{await db.close();}
});
