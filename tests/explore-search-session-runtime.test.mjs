import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';

test('real PostgreSQL search sessions preserve bounded scopes, queue order, expiry and privacy', { timeout: 120_000 }, async () => {
 const db = new PGlite({ extensions: { pg_trgm, cube, earthdistance } });
 try {
  await db.exec(readFileSync('tests/fixtures/explore-search-session-bootstrap.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009052031_explore_search_sessions.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009062031_explore_booking_rank_gate.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009064031_explore_region_index_predicates.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009065531_explore_session_publication_cutoff.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009071031_explore_candidate_seek_paths.sql','utf8'));
  await db.exec(readFileSync('tests/explore-search-session.integration.sql','utf8'));
  const result=await db.query('SELECT id FROM public.explore_search_sessions');
  assert.equal(result.rows.length,0,'fixture transaction must roll back');
  // A selective region within a common national term must retain its index.
  // This catches the COALESCE wrapper that passed small correctness fixtures
  // but caused real anonymous requests to scan the national browse index.
  await db.exec(`INSERT INTO public.explore_salon_documents(salon_id,state_code,city_search,postal_code,profile_completeness,created_at,search_document,salon_name_search,latitude,longitude)
   SELECT ('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,CASE WHEN i<=800 THEN 'WI' ELSE 'FL' END,
    CASE WHEN i<=800 THEN 'madison' ELSE 'miami' END,CASE WHEN i<=800 THEN '53703' ELSE '33101' END,(i%5)*20,now()-interval '1 day','nail salon manicure','nail salon '||i,
    CASE WHEN i<=800 THEN 43.0731 ELSE 25.7617 END,CASE WHEN i<=800 THEN -89.4012 ELSE -80.1918 END
   FROM generate_series(1,20000) i; ANALYZE public.explore_salon_documents;`);
  const findIndexes=(plan)=>[...(plan['Index Name']?[plan['Index Name']]:[]),...(plan.Plans??[]).flatMap(findIndexes)];
  const explain=async(region)=>{
   const predicate=(await db.query('SELECT public.explore_search_region_predicate($1::jsonb) AS predicate',[JSON.stringify(region)])).rows[0].predicate;
   const plan=await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT d.salon_id FROM public.explore_salon_documents d
    WHERE ${predicate} AND d.search_document LIKE '%nail%' ORDER BY d.profile_completeness DESC,d.salon_id LIMIT 256`);
   return findIndexes(plan.rows[0]['QUERY PLAN'][0].Plan);
  };
  assert.ok((await explain({kind:'state',state:'WI'})).includes('explore_document_state_idx'),'state filter must retain its ordered regional index');
  assert.ok((await explain({kind:'geo',latitude:43.0731,longitude:-89.4012,radius:16093.44})).includes('explore_document_earth_idx'),'radius filter must use its geographic index');
  const seekIndexes=async(region)=>{
   const predicate=(await db.query('SELECT public.explore_search_region_predicate($1::jsonb) AS predicate',[JSON.stringify(region)])).rows[0].predicate;
   const plan=await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT d.salon_id FROM public.explore_salon_documents d
    WHERE ${predicate} AND d.search_document LIKE '%nail%' AND d.salon_id>'20000000-0000-0000-0000-000000000256'::uuid ORDER BY d.salon_id LIMIT 256`);
   const executionPlan=plan.rows[0]['QUERY PLAN'][0].Plan;
   const findConditions=(node)=>[...(node['Index Cond']?[node['Index Cond']]:[]),...(node.Plans??[]).flatMap(findConditions)];
   assert.ok(findConditions(executionPlan).some(condition=>condition.includes('salon_id >')),'continuation anchor must enter Index Cond rather than a post-scan Filter');
   return findIndexes(executionPlan);
  };
  assert.ok((await seekIndexes({kind:'state',state:'WI'})).includes('explore_document_state_id_seek_idx'),'filtered state continuation must use its UUID seek index');
  assert.ok((await seekIndexes({kind:'city',state:'WI',city:'madison'})).includes('explore_document_city_id_seek_idx'),'filtered city continuation must use its UUID seek index');
  assert.ok((await seekIndexes({kind:'postal',postal:'53703'})).includes('explore_document_postal_id_seek_idx'),'filtered ZIP continuation must use its UUID seek index');
  const pullDefinition=(await db.query("SELECT pg_get_functiondef('public.explore_search_pull_batch(uuid)'::regprocedure) AS definition")).rows[0].definition;
  assert.match(pullDefinition,/IF raw_sort='0::float8' THEN[\s\S]*?d\.salon_id>%L::uuid/,'actual candidate helper must express its UUID anchor directly');
 } finally { await db.close(); }
});
