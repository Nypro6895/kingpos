import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';

test('legacy home limits regional candidates before personal ranking and serves cached category counts', { timeout: 120_000 }, async () => {
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try {
  await db.exec(readFileSync('tests/fixtures/explore-search-session-bootstrap.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009052031_explore_search_sessions.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009064031_explore_region_index_predicates.sql','utf8'));
  await db.exec(`CREATE TABLE explore_user_preferences(user_id uuid PRIMARY KEY,location_label text,categories text[]);
   CREATE FUNCTION get_explore_activity_region() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.activity',true),'')::jsonb,'{"source":"none"}'::jsonb) $$;
   CREATE OR REPLACE FUNCTION explore_preferred_categories() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT categories FROM explore_user_preferences WHERE user_id=current_public_user_id()),'{}') $$;
   CREATE TABLE locations(id uuid PRIMARY KEY,status text);
   CREATE TABLE salon_settings(salon_id uuid PRIMARY KEY,public_discovery_enabled boolean);
   CREATE TABLE services(id uuid PRIMARY KEY,salon_id uuid,category text,is_active boolean,online_booking_enabled boolean);
   INSERT INTO users VALUES('10000000-0000-0000-0000-000000000001');
   INSERT INTO explore_user_preferences VALUES('10000000-0000-0000-0000-000000000001','Madison, Wisconsin',ARRAY['Nails']);
   INSERT INTO explore_salon_documents(salon_id,salon_name,state_code,city_search,state,city,postal_code,profile_completeness,created_at,updated_at,public_discovery_published_at,service_categories,location_search_text)
   SELECT ('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Salon '||i,CASE WHEN i<=800 THEN 'WI' ELSE 'FL' END,
    CASE WHEN i<=400 THEN 'madison' WHEN i<=800 THEN 'milwaukee' ELSE 'miami' END,CASE WHEN i<=800 THEN 'WI' ELSE 'FL' END,
    CASE WHEN i<=400 THEN 'Madison' WHEN i<=800 THEN 'Milwaukee' ELSE 'Miami' END,CASE WHEN i<=400 THEN '53703' ELSE '33101' END,
    CASE WHEN i%16=0 THEN 0 ELSE 100 END,now()-make_interval(mins=>i),now()-make_interval(mins=>i),now()-make_interval(mins=>i),
    CASE WHEN i%16=0 THEN ARRAY['Nails'] ELSE ARRAY['Hair'] END,'madison street' FROM generate_series(1,20000) i;
   INSERT INTO locations VALUES('20000000-0000-0000-0000-000000000001','active'),('20000000-0000-0000-0000-000000000002','active'),('20000000-0000-0000-0000-000000000003','active'),('20000000-0000-0000-0000-000000000004','inactive');
   INSERT INTO salon_settings SELECT id,id<>'20000000-0000-0000-0000-000000000003' FROM locations;
   INSERT INTO services SELECT ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
    ('20000000-0000-0000-0000-'||lpad(CASE WHEN i<=2 THEN '1' WHEN i<=4 THEN '2' WHEN i=5 THEN '3' ELSE '4' END,12,'0'))::uuid,
    CASE WHEN i=4 THEN 'Hair' ELSE 'Nails' END,true,true FROM generate_series(1,6) i;
   ANALYZE explore_salon_documents;`);
  await db.exec(readFileSync('supabase/migrations/20261009090031_explore_home_candidate_cache.sql','utf8'));
  const home=async(r=6,n=6)=>(await db.query('SELECT * FROM get_public_explore_home_salons($1,$2)',[r,n])).rows;
  await db.exec("SELECT set_config('test.viewer','10000000-0000-0000-0000-000000000001',false)");
  const rows=await home();
  assert.equal(rows.length,12);
  assert.ok(rows.every(row=>row.city==='Madison'&&row.state==='WI'),'saved full-state city is a structured region, not a street token');
  assert.ok(rows.filter(row=>row.section==='recommended').every(row=>row.service_categories.includes('Nails')),'preferences rank a bounded pool ahead of completeness');
  assert.equal(rows.find(row=>row.section==='new').salon_name,'Salon 1','latest rail retains indexed recency');
  assert.deepEqual(await home(),rows,'authenticated samples remain stable within a day');
  assert.equal((await home(999,999)).length,40);
  assert.equal((await home(0,0)).length,0);
  await db.query("SELECT set_config('test.activity',$1,false)",[JSON.stringify({label:'Milwaukee, WI',source:'activity',confidence:0.8,evidenceDays:4})]);
  assert.ok((await home()).every(row=>row.city==='Milwaukee'),'reliable activity region precedes saved preferences');
  await db.query("SELECT set_config('test.activity',$1,false)",[JSON.stringify({label:'Milwaukee, WI',source:'activity',confidence:0.4,evidenceDays:1})]);
  assert.ok((await home()).every(row=>row.city==='Madison'),'a one-off/weak activity signal does not replace saved location');
  await db.exec("SELECT set_config('test.activity','',false)");
  await db.exec("UPDATE explore_user_preferences SET location_label='53703'");
  assert.ok((await home()).every(row=>row.postal_code==='53703'));
  await db.exec("UPDATE explore_user_preferences SET location_label='Wisconsin'");
  assert.ok((await home()).every(row=>row.state==='WI'));
  await db.exec("UPDATE explore_user_preferences SET location_label='Unmatched, WI'");
  assert.equal((await home()).length,0,'a saved fixed region does not silently widen');
  await db.exec("UPDATE explore_user_preferences SET location_label='Madison, WI'");
  await db.exec("DELETE FROM explore_salon_documents WHERE salon_id='20000000-0000-0000-0000-000000000001'");
  assert.ok((await home()).every(row=>row.salon_name!=='Salon 1'),'source projection removal wins immediately');
  await db.exec("UPDATE explore_salon_documents SET public_discovery_published_at=now()+interval '1 day' WHERE salon_id='20000000-0000-0000-0000-000000000002'");
  assert.ok((await home()).every(row=>row.salon_name!=='Salon 2'),'future publication is ineligible');
  await db.exec("SELECT set_config('test.viewer','',false)");
  assert.equal((await home()).length,12,'guest path works without location or preferences');

  const categories=async()=>(await db.query('SELECT * FROM get_public_explore_popular_services(8)')).rows;
  assert.deepEqual(await categories(),[{category:'Nails',salon_count:2,active_service_count:3},{category:'Hair',salon_count:1,active_service_count:1}]);
  await db.exec("UPDATE services SET is_active=false WHERE category='Nails'");
  assert.equal((await categories())[0].category,'Nails','requests read the cache without recomputing the source');
  await db.exec('SELECT refresh_explore_popular_service_cache()');
  assert.deepEqual(await categories(),[{category:'Hair',salon_count:1,active_service_count:1}]);
  assert.equal((await db.query("SELECT has_table_privilege('anon','explore_popular_service_cache','SELECT') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege('anon','refresh_explore_popular_service_cache()','EXECUTE') allowed")).rows[0].allowed,false);
  const definition=(await db.query("SELECT pg_get_functiondef('get_public_explore_popular_services(integer)'::regprocedure) definition")).rows[0].definition;
  assert.doesNotMatch(definition,/count\s*\(|\bFROM\s+services\b/i,'no aggregate/source scan in the public category RPC');

  const find=(plan,key)=>[...(plan[key]?[plan[key]]:[]),...(plan.Plans??[]).flatMap(child=>find(child,key))];
  for(const region of [{kind:'state',state:'WI'},{kind:'city',city:'madison',state:'WI'},{kind:'postal',postal:'53703'}]) {
   const predicate=(await db.query('SELECT explore_search_region_predicate($1::jsonb) predicate',[JSON.stringify(region)])).rows[0].predicate;
   const candidatePlan=(await db.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT d.salon_id FROM explore_salon_documents d WHERE ${predicate} AND d.salon_id>'20000000-0000-0000-0000-000000000010'::uuid ORDER BY d.salon_id LIMIT 256`)).rows[0]['QUERY PLAN'][0].Plan;
   assert.ok(find(candidatePlan,'Index Cond').some(value=>value.includes('salon_id >')),'UUID home sample anchor must use an index condition');
   const latestPlan=(await db.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT d.salon_id FROM explore_salon_documents d WHERE ${predicate} ORDER BY d.created_at DESC,d.salon_id LIMIT 20`)).rows[0]['QUERY PLAN'][0].Plan;
   assert.ok(find(latestPlan,'Index Name').some(value=>value.includes('new_seek')),'latest home rail retains a scoped recency index');
   assert.ok(!find(latestPlan,'Node Type').includes('Sort'),'latest branch must not sort all regional documents');
  }
 } finally {await db.close();}
});
