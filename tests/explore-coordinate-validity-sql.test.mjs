import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';
const id=n=>`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const load=path=>readFileSync(path,'utf8');
export async function bootstrapCoordinateValidity(db) {
 await db.exec(load('tests/fixtures/explore-coordinate-validity-bootstrap.sql'));
 await db.exec('CREATE EXTENSION pg_trgm WITH SCHEMA extensions;');
 const model=load('supabase/migrations/20261008223001_explore_read_model.sql');
 await db.exec(model.slice(0,model.indexOf('CREATE OR REPLACE FUNCTION public.get_public_explore_home_salons'))+'COMMIT;');
 for(const file of ['20261009052031_explore_search_sessions.sql','20261009064031_explore_region_index_predicates.sql',
  '20261009065531_explore_session_publication_cutoff.sql','20261009071031_explore_candidate_seek_paths.sql',
  '20261009123031_explore_gps_address_context.sql','20261009122031_directory_geocode_worker.sql','20261009124031_directory_geocode_yield_locks.sql']) await db.exec(load('supabase/migrations/'+file));
}
test('actual canonical projection, owner refresh and directory maintenance obey coordinate validity',async t=>{
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try{
  await bootstrapCoordinateValidity(db);
  // Existing stale pin is invalidated at migration, source values remain untouched.
  await db.query("UPDATE locations SET latitude=43,longitude=-88,geocoding_status='stale' WHERE id=$1",[id(299)]);
  await db.query("UPDATE locations SET latitude=43,longitude=-88,postal_code=NULL WHERE id=$1",[id(298)]);
  const oldFingerprint='419 6th st|racine|wi|53403|us';
  await db.query("UPDATE locations SET latitude=43,longitude=-88,geocoding_status='mapped',geocoding_provider='us_census',geocoding_address_fingerprint=$2 WHERE id=$1",[id(300),oldFingerprint]);
  await db.query("INSERT INTO directory_geocode_jobs(salon_id,fingerprint,status,match_metadata) VALUES($1,$2,'succeeded',$3)",[id(300),oldFingerprint,{latitude:43,longitude:-88,provider:'us_census',accuracy:'address_range_interpolated'}]);
  const before=(await db.query("SELECT attname,atttypid FROM pg_attribute WHERE attrelid='explore_document_source'::regclass AND attnum>0 ORDER BY attnum")).rows;
  await db.exec(load('supabase/migrations/20261009127031_explore_coordinate_validity.sql'));
  assert.deepEqual((await db.query("SELECT attname,atttypid FROM pg_attribute WHERE attrelid='explore_document_source'::regclass AND attnum>0 ORDER BY attnum")).rows,before);
  assert.equal((await db.query('SELECT latitude FROM explore_salon_documents WHERE salon_id=$1',[id(299)])).rows[0].latitude,null);
  assert.equal((await db.query('SELECT latitude FROM locations WHERE id=$1',[id(299)])).rows[0].latitude,43);
  assert.equal((await db.query('SELECT geocoding_status FROM locations WHERE id=$1',[id(300)])).rows[0].geocoding_status,'stale');
  assert.equal((await db.query('SELECT latitude FROM explore_salon_documents WHERE salon_id=$1',[id(300)])).rows[0].latitude,null);
  assert.equal((await db.query('SELECT latitude FROM explore_salon_documents WHERE salon_id=$1',[id(298)])).rows[0].latitude,43,'legacy complete pin remains valid without a complete mailing address');
  const snapshot=async n=>(await db.query('SELECT directory_geocode_address_snapshot($1) item',[id(n)])).rows[0].item;
  const claim=async(n,fp)=>(await db.query('SELECT claim_directory_geocode_job($1,$2) token',[id(n),fp])).rows[0].token;
  const match=(fp,latitude=42.72667)=>({latitude,longitude:-87.785287,fingerprint:fp,provider:'us_census',accuracy:'address_range_interpolated',matchedAddress:'420 6TH ST, RACINE, WI, 53403',tigerLineId:'77910452',side:'R'});
  const finish=async(n,fp,token,latitude)=>(await db.query('SELECT finish_directory_geocode_job($1,$2,$3,$4,NULL) result',[id(n),fp,token,match(fp,latitude)])).rows[0].result;
  const mapped=async n=>{const s=await snapshot(n),token=await claim(n,s.fingerprint);assert.equal(await finish(n,s.fingerprint,token),'succeeded');return s;};
  const pin=async n=>(await db.query('SELECT location_geocoding_pin_snapshot(l) pin FROM locations l WHERE id=$1',[id(n)])).rows[0].pin;
  const isolated=(name,fn)=>t.test(name,async()=>{await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}});
  await isolated('legacy, owner-confirmed and current automatic complete pins survive; partial/null/error/mismatched pins do not',async()=>{
   for(const [n,extra,valid] of [[1,"",true],[2,",geocoding_pin_origin='owner_confirmed'",true],[3,",geocoding_status='mapped',geocoding_address_fingerprint='wrong'",false],
    [4,",geocoding_status='pending'",false],[5,",geocoding_status='failed'",false],[6,",geocoding_status='address_required'",false]]){
    await db.query(`UPDATE locations SET latitude=43,longitude=-88 ${extra} WHERE id=$1`,[id(n)]);
    assert.equal((await db.query('SELECT latitude FROM explore_salon_documents WHERE salon_id=$1',[id(n)])).rows[0].latitude,valid?43:null);
   }
   await db.query('UPDATE locations SET latitude=43 WHERE id=$1',[id(7)]);assert.equal((await db.query('SELECT latitude FROM explore_salon_documents WHERE salon_id=$1',[id(7)])).rows[0].latitude,null);
   assert.equal(await snapshot(7),null);assert.equal(await snapshot(2),null);
  });
  await isolated('automatic address edit preserves source pin, invalidates projection and re-enriches using the new fingerprint',async()=>{
   const original=await mapped(8);const originalPin=await pin(8);
   await db.query("UPDATE salon_settings SET address_line1='421 6th St' WHERE salon_id=$1",[id(8)]);
   assert.deepEqual(await pin(8),originalPin);assert.equal((await db.query('SELECT latitude FROM explore_salon_documents WHERE salon_id=$1',[id(8)])).rows[0].latitude,null);
   const fresh=await snapshot(8);assert.notEqual(fresh.fingerprint,original.fingerprint);
   assert.equal(fresh.sourcePin.latitude,originalPin.latitude);
   const candidates=(await db.query('SELECT get_directory_geocode_candidates($1,5,256) page',[id(7)])).rows[0].page;assert.equal(candidates.candidates[0].salonId,id(8));
   const token=await claim(8,fresh.fingerprint);assert.ok(token);assert.equal(await finish(8,fresh.fingerprint,token,42.727),'succeeded');
   assert.equal((await db.query('SELECT latitude FROM explore_salon_documents WHERE salon_id=$1',[id(8)])).rows[0].latitude,42.727);
   // Returning to an earlier successful address starts a new bounded source cycle.
   await db.query("UPDATE salon_settings SET address_line1=NULL WHERE salon_id=$1",[id(8)]);
   const restored=await snapshot(8);assert.equal(restored.fingerprint,original.fingerprint);
   assert.equal(restored.mode,'refresh_auto');const restoredToken=await claim(8,restored.fingerprint);assert.ok(restoredToken);
   assert.equal(await finish(8,restored.fingerprint,restoredToken),'succeeded');
  });
  await isolated('owner confirmation, replacement, claim, suppression and a second edit defeat stale automatic completion',async()=>{
   const changes=["UPDATE locations SET geocoding_pin_origin='owner_confirmed' WHERE id=$1",
    "UPDATE locations SET latitude=43,longitude=-88 WHERE id=$1","UPDATE salon_directory_listings SET claim_state='claimed' WHERE salon_id=$1",
    "INSERT INTO salon_directory_suppressions SELECT listing_id,'other','removed' FROM salon_directory_listings WHERE salon_id=$1",
    "UPDATE salon_settings SET address_line1='422 6th St' WHERE salon_id=$1"];
   for(const change of changes){await db.exec('SAVEPOINT change');await mapped(9);await db.query("UPDATE salon_settings SET address_line1='421 6th St' WHERE salon_id=$1",[id(9)]);
    const fresh=await snapshot(9),token=await claim(9,fresh.fingerprint);await db.query(change,[id(9)]);const preserved=await pin(9);
    assert.equal(await finish(9,fresh.fingerprint,token),'stale');assert.deepEqual(await pin(9),preserved);await db.exec('ROLLBACK TO change; RELEASE change');}
  });
  await isolated('old pin without matching successful Census provenance cannot be replaced',async()=>{
   await db.query("UPDATE locations SET latitude=43,longitude=-88,geocoding_status='stale',geocoding_provider='us_census',geocoding_address_fingerprint='old' WHERE id=$1",[id(10)]);
   assert.equal(await snapshot(10),null);await db.query("UPDATE locations SET geocoding_provider='maptiler' WHERE id=$1",[id(10)]);assert.equal(await snapshot(10),null);
  });
  await isolated('two different incomplete effective addresses still invalidate a preserved legacy pin',async()=>{
   const before=(await db.query('SELECT explore_location_address_fingerprint(l,s) fp FROM locations l JOIN salon_settings s ON s.salon_id=l.id WHERE l.id=$1',[id(298)])).rows[0].fp;assert.equal(before,null);
   await db.query("UPDATE salon_settings SET address_line1='999 Different St' WHERE salon_id=$1",[id(298)]);
   const changed=(await db.query('SELECT l.latitude,l.longitude,l.geocoding_status,d.latitude projected,explore_location_address_fingerprint(l,s) fp FROM locations l JOIN salon_settings s ON s.salon_id=l.id JOIN explore_salon_documents d ON d.salon_id=l.id WHERE l.id=$1',[id(298)])).rows[0];
   assert.equal(changed.fp,null);assert.equal(changed.latitude,43);assert.equal(changed.longitude,-88);assert.equal(changed.geocoding_status,'address_required');assert.equal(changed.projected,null);
  });
  await isolated('manual city/ZIP do not synthesize a GPS center or mileage; actual point measures only current pins',async()=>{
   await mapped(11);
   for(const location of ['Racine, WI','53403']){
    const region=(await db.query('SELECT explore_search_region($1,NULL,NULL) region',[location])).rows[0].region;assert.equal(region.latitude,null);assert.equal(region.longitude,null);
    const response=(await db.query("SELECT search_public_explore_session(NULL,NULL,$1,NULL,NULL,'closest',12,NULL,'fixed') response",[location])).rows[0].response;
    assert.ok(response.rows.length);assert.ok(response.rows.every(row=>row.distance_miles===null));
   }
   const actual=(await db.query("SELECT search_public_explore_session(NULL,NULL,'Racine, WI',42.72,-87.78,'closest',12,NULL,'fixed') response")).rows[0].response;
   assert.equal(actual.rows[0].salon_id,id(11));assert.ok(actual.rows[0].distance_miles>0&&actual.rows[0].distance_miles<1);
   await db.query("UPDATE salon_settings SET address_line1='422 6th St' WHERE salon_id=$1",[id(11)]);
   const stale=(await db.query("SELECT search_public_explore_session(NULL,NULL,'Racine, WI',42.72,-87.78,'closest',12,NULL,'fixed') response")).rows[0].response;
   assert.equal(stale.rows.find(row=>row.salon_id===id(11)).distance_miles,null);
   assert.ok(stale.rows.some(row=>row.salon_id===id(298)&&row.distance_miles!==null),'another unchanged legacy pin remains measurable');
  });
  await isolated('owner refresh metadata is CAS protected and keeps prior pin through failure; owner pin never overwritten',async()=>{
   await db.exec("SELECT set_config('test.viewer','30000000-0000-0000-0000-000000000001',true)");
   await db.query('UPDATE locations SET latitude=43,longitude=-88 WHERE id=$1',[id(12)]);
   const original=await pin(12);const fp=(await db.query('SELECT explore_location_address_fingerprint(l,s) fp FROM locations l JOIN salon_settings s ON s.salon_id=l.id WHERE l.id=$1',[id(12)])).rows[0].fp;
   const owner=async(values)=>(await db.query('SELECT set_current_salon_geocoding_state($1,$2,$3,$4) result',[id(12),fp,original,values])).rows[0].result;
   assert.equal(await owner({status:'pending'}),'updated');assert.deepEqual(await pin(12),original);
   assert.equal(await owner({status:'failed',errorCode:'timeout'}),'updated');assert.deepEqual(await pin(12),original);
   await db.query("UPDATE salon_settings SET address_line1='421 6th St' WHERE salon_id=$1",[id(12)]);
   assert.equal(await owner({status:'mapped',provider:'maptiler',latitude:44,longitude:-89}),'stale');assert.deepEqual(await pin(12),original);
   await db.query("UPDATE salon_settings SET address_line1=NULL WHERE salon_id=$1",[id(12)]);await db.query("UPDATE locations SET geocoding_pin_origin='owner_confirmed' WHERE id=$1",[id(12)]);
   const confirmed=await pin(12);assert.equal((await db.query('SELECT set_current_salon_geocoding_state($1,$2,$3,$4) result',[id(12),fp,confirmed,{status:'mapped',provider:'maptiler',latitude:44,longitude:-89}])).rows[0].result,'owner_pin_preserved');
  });
  await isolated('owner mutation permission and private helper ACLs remain restricted',async()=>{
   await db.exec('SAVEPOINT acl; SET ROLE anon');await assert.rejects(db.query("SELECT set_current_salon_geocoding_state($1,NULL,'{}','{}')",[id(1)]),/permission denied/);await db.exec('ROLLBACK TO acl; RELEASE acl');
   await db.exec("SELECT set_config('test.viewer','30000000-0000-0000-0000-000000000002',true)");await db.exec('SAVEPOINT denied');
   await assert.rejects(db.query("SELECT set_current_salon_geocoding_state($1,NULL,'{}','{}')",[id(1)]),/permission required/);await db.exec('ROLLBACK TO denied; RELEASE denied');
  });
 }finally{await db.close();}
});
