import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sql=readFileSync('supabase/migrations/20261009121031_explore_query_area_lookup.sql','utf8');

test('query entities recognize only current public areas, bound ambiguous suggestions, and seek indexes before live checks', { timeout:120_000 },async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE SCHEMA extensions;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE locations(id uuid PRIMARY KEY,status text DEFAULT 'active',created_at timestamptz DEFAULT now());
   CREATE TABLE salon_settings(salon_id uuid PRIMARY KEY,public_discovery_enabled boolean DEFAULT true,public_discovery_published_at timestamptz);
   CREATE TABLE explore_salon_documents(salon_id uuid PRIMARY KEY,salon_name_search text,city text,city_search text,state_code text,created_at timestamptz NOT NULL DEFAULT now(),public_discovery_published_at timestamptz);
   CREATE FUNCTION public.normalize_search_text(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(btrim(regexp_replace(lower(coalesce(value,'')),'[^a-z0-9]+',' ','g')),'') $$;
   GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
  const boundary=readFileSync('supabase/migrations/20261009096031_explore_canonical_public_bounds.sql','utf8');
  await db.exec(boundary.slice(boundary.indexOf('CREATE OR REPLACE FUNCTION'),boundary.indexOf('CREATE FUNCTION public.explore_canonical_salon_ids')));
  const session=readFileSync('supabase/migrations/20261009052031_explore_search_sessions.sql','utf8');
  await db.exec(session.slice(session.indexOf('CREATE FUNCTION public.explore_search_state_codes'),session.indexOf('CREATE FUNCTION public.explore_search_region')));
  await db.exec(sql);
  const add=async(n,name,city,state,extra='')=>{
   await db.query('INSERT INTO locations(id) VALUES($1)',[id(n)]);
   await db.query('INSERT INTO salon_settings(salon_id) VALUES($1)',[id(n)]);
   await db.query('INSERT INTO explore_salon_documents(salon_id,salon_name_search,city,city_search,state_code) VALUES($1,normalize_search_text($2),$3,normalize_search_text($3),$4)',[id(n),name,city,state]);
   if(extra) await db.query(extra,[id(n)]);
  };
  await add(1,'King Nails','Milwaukee','WI');await add(2,'Design Nails','Chicago','IL');
  await add(3,'Nails Near Me','Madison','WI');await add(4,'Designs in Motion','Motion','CA');
  await add(5,'Secret Nails','Privateville','WI','UPDATE salon_settings SET public_discovery_enabled=false WHERE salon_id=$1');
  await add(6,'Future Nails','Futureville','WI',"UPDATE salon_settings SET public_discovery_published_at=now()+interval '1 day' WHERE salon_id=$1");
  await add(7,'Deleted Nails','Goneville','WI',"UPDATE locations SET status='deleted' WHERE id=$1");
  await add(8,'Future Document','Later','WI',"UPDATE explore_salon_documents SET created_at=now()+interval '1 day' WHERE salon_id=$1");
  await add(9,'Unknown State','Unmapped',null);
  const states=['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','WI'];
  for(let n=0;n<states.length;n++) await add(20+n,`Shared ${n}`,'Springfield',states[n]);
  const entity=async(query=null,city=null,preferred=null,constraint=null,limit=8,original=null)=>(await db.query('SELECT get_public_explore_query_entities($1,$2,$3,$4,$5,$6) data',[query,city,preferred,constraint,limit,original])).rows[0].data;
  let result=await entity('King Nails','Milwaukee');
  assert.equal(result.exactSalonName,true);assert.deepEqual(result.areaCandidates,[{kind:'city',city:'Milwaukee',stateCode:'WI',label:'Milwaukee, WI'}]);
  assert.equal((await entity('Nails',null,null,null,8,'Nails Near Me')).exactOriginalSalonName,true);
  assert.equal((await entity('Designs',null,null,null,8,'Designs in Motion')).exactOriginalSalonName,true);
  for(const [name,city] of [['Secret Nails','Privateville'],['Future Nails','Futureville'],['Deleted Nails','Goneville'],['Future Document','Later']]){
   result=await entity(name,city);assert.equal(result.exactSalonName,false);assert.deepEqual(result.areaCandidates,[]);
  }
  await db.query('DELETE FROM locations WHERE id=$1',[id(5)]);
  assert.equal((await entity('Secret Nails','Privateville')).areaCandidates.length,0,'a stale projection never recreates a deleted source');
  result=await entity(null,'Springfield');assert.equal(result.areaCandidates.length,8);assert.equal(result.moreAreaCandidates,true);assert.equal(result.areaStatus,'ambiguous');
  result=await entity(null,'Springfield','WI');assert.equal(result.areaCandidates[0].stateCode,'WI','positive context is sought before the bounded suggestion cap');
  result=await entity(null,'Springfield',null,'WI');assert.equal(result.areaCandidates.length,1);assert.equal(result.areaStatus,'unique');
  assert.equal((await entity(null,'Unmapped')).areaCandidates[0].stateCode,null);
  assert.equal((await entity()).version,1);assert.equal((await entity()).areaStatus,'none');
  await assert.rejects(entity('x'.repeat(161)),e=>e.code==='22023');await assert.rejects(entity(null,'Springfield',null,'ZZ'),e=>e.code==='22023');
  await db.exec(`INSERT INTO explore_salon_documents(salon_id,salon_name_search,city,city_search,state_code)
   SELECT ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'studio '||n,CASE WHEN n>49750 THEN 'Milwaukee' ELSE 'Other City' END,CASE WHEN n>49750 THEN 'milwaukee' ELSE 'other city' END,CASE WHEN n>49750 THEN 'WI' ELSE 'CA' END FROM generate_series(1,50000)n;ANALYZE explore_salon_documents;`);
  const plan=(await db.query(`EXPLAIN(ANALYZE,FORMAT JSON) SELECT d.salon_id,d.city FROM explore_salon_documents d WHERE d.city_search='milwaukee' AND d.state_code='WI'
   AND d.created_at<=now() AND(d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now()) ORDER BY d.salon_id LIMIT 8`)).rows[0]['QUERY PLAN'][0].Plan;
  const nodes=[];const walk=node=>{nodes.push(node);for(const child of node.Plans??[])walk(child);};walk(plan);
  assert.ok(nodes.some(node=>node['Index Name']==='explore_document_city_id_seek_idx' && /city_search/.test(node['Index Cond']) && /state_code/.test(node['Index Cond'])));
  assert.ok(!nodes.some(node=>node['Node Type']==='Sort'),'a huge city is sought by city/state/UUID before LIMIT, not sorted globally');assert.equal(plan['Actual Rows'],8);
  const exactPlan=(await db.query("EXPLAIN(ANALYZE,FORMAT JSON) SELECT salon_id FROM explore_salon_documents WHERE salon_name_search='king nails' ORDER BY salon_id LIMIT 8")).rows[0]['QUERY PLAN'][0].Plan;
  assert.equal(exactPlan.Plans[0]['Index Name'],'explore_document_exact_name_seek_idx');
  const definition=(await db.query("SELECT pg_get_functiondef('get_public_explore_query_entities(text,text,text,text,integer,text)'::regprocedure) definition")).rows[0].definition;
  assert.doesNotMatch(definition,/\bCOUNT\s*\(/i);assert.equal((definition.match(/LIMIT 8/g)??[]).length,4);
  await db.exec('SET ROLE anon');assert.equal((await entity('King Nails','Milwaukee')).exactSalonName,true);
  await assert.rejects(db.query('SELECT * FROM explore_salon_documents LIMIT 1'),e=>e.code==='42501');await db.exec('RESET ROLE');
 }finally{await db.close();}
});
