import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('verified city eligibility retains unmapped salons while actual GPS and cursor filters remain stable', {timeout:120_000},async()=>{
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try{
  await db.exec(readFileSync('tests/fixtures/explore-search-session-bootstrap.sql','utf8'));
  for(const file of ['20261009052031_explore_search_sessions.sql','20261009062031_explore_booking_rank_gate.sql','20261009064031_explore_region_index_predicates.sql','20261009065531_explore_session_publication_cutoff.sql','20261009071031_explore_candidate_seek_paths.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
  const before=(await db.query("SELECT 'search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)'::regprocedure::oid oid,has_function_privilege('anon','search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)','EXECUTE') anon")).rows[0];
  await db.exec(readFileSync('supabase/migrations/20261009123031_explore_gps_address_context.sql','utf8'));
  const after=(await db.query("SELECT 'search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)'::regprocedure::oid oid,has_function_privilege('anon','search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)','EXECUTE') anon")).rows[0];
  assert.deepEqual(after,before,'replacement preserves compiled caller identity and anonymous execute permission');
  await db.exec(`INSERT INTO explore_salon_documents(salon_id,salon_name,salon_name_search,city,city_search,state,state_code,postal_code,latitude,longitude,service_category_search_text,search_document,created_at,profile_completeness)
   SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Local nails '||n,'local nails '||n,'Milwaukee','milwaukee','WI','WI','53202',43.5,-87.9,'nails','local nails manicure milwaukee',now()-interval '1 day',50 FROM generate_series(1,30)n;
   UPDATE explore_salon_documents SET latitude=NULL,longitude=NULL WHERE salon_id='${id(1)}';
   INSERT INTO explore_salon_documents(salon_id,salon_name,salon_name_search,city,city_search,state,state_code,latitude,longitude,service_category_search_text,search_document,created_at,profile_completeness)
   VALUES('${id(31)}','Neighbor nails','neighbor nails','Wauwatosa','wauwatosa','WI','WI',43.07,-87.96,'nails','neighbor nails manicure',now()-interval '1 day',50);
   ANALYZE explore_salon_documents;`);
  const region=(await db.query("SELECT explore_search_region('Milwaukee, WI',43.0389,-87.9065) region")).rows[0].region;
  assert.equal(region.kind,'city');assert.equal(region.state,'WI');assert.equal(region.latitude,43.0389);assert.equal(region.longitude,-87.9065,'coordinates come from GPS, not the average salon address');
  const call=async(cursor=null,latitude=43.0389,longitude=-87.9065)=>(await db.query("SELECT search_public_explore_session(p_query=>'nails',p_category=>'Nails',p_location=>'Milwaukee, WI',p_latitude=>$1,p_longitude=>$2,p_scope_policy=>'fixed',p_cursor=>$3) result",[latitude,longitude,cursor])).rows[0].result;
  await db.exec('SET ROLE anon');
  let page=await call();assert.equal(page.rows.length,12);assert.equal(page.hasMore,true);
  const firstToken=page.nextCursor,seen=new Set(),rows=[];
  for(let number=0;number<4;number++){
   for(const row of page.rows){assert.ok(!seen.has(row.salon_id));seen.add(row.salon_id);rows.push(row);assert.equal(row.city_search,'milwaukee');assert.equal(row.search_scope,'A');}
   if(!page.hasMore)break;page=await call(page.nextCursor);
  }
  assert.equal(rows.length,30,'every eligible selected-city salon remains reachable across first/next pages');
  const unmapped=rows.find(row=>row.salon_id===id(1));assert.ok(unmapped,'a verified city includes unmapped addresses');assert.equal(unmapped.distance_miles,null,'an unmapped address has no invented distance');
  assert.ok(rows.find(row=>row.salon_id===id(2)).distance_miles>30,'mapped distance must be from actual GPS, not a salon average');
  assert.ok(!seen.has(id(31)),'fixed verified city is stronger than a nearby salon outside its boundary');
  await assert.rejects(call(firstToken,43.2,-87.9065),e=>e.code==='22023','cursor binds actual GPS alongside its city label');
  await assert.rejects(call(firstToken,null,null),e=>e.code==='22023','dropping GPS changes frozen filters');
  const replay=await call(firstToken);assert.equal(replay.rows.length,12);assert.ok(replay.rows.every(row=>seen.has(row.salon_id)));
  await db.exec('RESET ROLE');
  const legacy=(await db.query("SELECT explore_search_region('Milwaukee, WI',NULL,NULL) region")).rows[0].region;
  assert.equal(legacy.latitude,43.5,'legacy no-GPS requests retain their existing address center');
  const invalid=(await db.query("SELECT explore_search_region('WI',91,181) region")).rows[0].region;assert.equal(invalid.latitude,null);assert.equal(invalid.longitude,null);
 }finally{await db.close();}
});
