import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createUnifiedExploreFixture,fixtureId as id,seedPost,searchFixture as search} from './fixtures/explore-unified-search-bootstrap.mjs';

test('unified SQL: realistic 107414 salons/reference posts, global winner beyond UUID256',{timeout:600000},async t=>{
 const start=performance.now();const f=await createUnifiedExploreFixture({seed:false,scale:107414,onStage:stage=>console.log(`Scale fixture: ${stage} (${Math.round(performance.now()-start)} ms)`)});const db=f.db;
 try{
  t.diagnostic(`107414 salons + reference introductions bootstrap: ${Math.round(performance.now()-start)} ms`);
  await db.query("UPDATE explore_salon_documents SET salon_name='Precise Match',salon_name_search='precise match',profile_completeness=0,latitude=43.07,longitude=-89.4 WHERE salon_id=$1",[id(107414)]);
  await db.query('UPDATE explore_salon_documents SET latitude=43.07,longitude=-89.4 WHERE salon_id=$1',[id(107413)]);
  await seedPost(db,2000000,107413,{title:'Precise Match',caption:'Real text-only title',media:false});
  const timings={};
  let at=performance.now();const named=await search(db,{query:'precise match',queryKind:'name',category:'',limit:12});timings.nameMs=Math.round(performance.now()-at);console.log("Scale query nameMs: "+timings.nameMs+" ms");
  assert.equal(named.rows[0].salon_id,id(107414));assert.equal(named.rows[1].salon_id,id(107413));assert.equal(named.rows[1].match_type,'post');
  assert.equal(named.recommendationCategory,'nails');assert.equal(named.canonical.category,'');
  at=performance.now();const browse=await search(db,{query:'',queryKind:'service',limit:12,location:'Madison, WI',scopePolicy:'fixed',locationPriority:true});timings.browseMs=Math.round(performance.now()-at);console.log("Scale query browseMs: "+timings.browseMs+" ms");
  assert.equal(browse.rows.length,12);assert.equal(browse.hasMore,true);
  at=performance.now();const style=await search(db,{query:'precise match',queryKind:'style',limit:12,latitude:43.07,longitude:-89.4,locationPriority:true});timings.styleMs=Math.round(performance.now()-at);console.log("Scale query styleMs: "+timings.styleMs+" ms");
  assert.equal(style.rows[0].salon_id,id(107414));assert.equal(style.rows[1].salon_id,id(107413));assert.equal(style.rows[2].result_group,'reference');
  at=performance.now();const emptyArea=await search(db,{query:'precise match',queryKind:'name',limit:12,location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true});timings.emptyAreaReferencesMs=Math.round(performance.now()-at);console.log("Scale query emptyAreaReferencesMs: "+timings.emptyAreaReferencesMs+" ms");
  assert.equal(emptyArea.primaryCount,0);assert.equal(emptyArea.referenceCount,12);assert.equal(emptyArea.rows[0].salon_id,id(107414));assert.equal(emptyArea.rows[0].recommendation_reason,'matching_in_broader_area');assert.equal(emptyArea.scope.expanded,false);
  await seedPost(db,2000001,107412,{title:'Red French tips',caption:'Own manicure',media:true});
  at=performance.now();const partial=await search(db,{query:'red almond French',queryKind:'style',limit:12,location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true});timings.partialStyleReferencesMs=Math.round(performance.now()-at);console.log("Scale query partialStyleReferencesMs: "+timings.partialStyleReferencesMs+" ms");
  assert.equal(partial.primaryCount,0);assert.equal(partial.rows[0].salon_id,id(107412));assert.equal(partial.rows[0].match_type,'related_post');assert.equal(partial.rows[0].image_provenance,'salon_post');
  at=performance.now();const unknown=await search(db,{query:'unknownunrelatedword',queryKind:'name',category:'',location:'Milwaukee, WI',scopePolicy:'fixed'});timings.unknownNoCategoryMs=Math.round(performance.now()-at);console.log("Scale query unknownNoCategoryMs: "+timings.unknownNoCategoryMs+" ms");assert.deepEqual(unknown.rows,[]);assert.equal(unknown.recommendationCategory,null);
  const plan=(await db.query("EXPLAIN (FORMAT JSON) SELECT content_key FROM explore_unified_content_history WHERE search_terms@@plainto_tsquery('english','precise match')")).rows[0]['QUERY PLAN'];
  assert(JSON.stringify(plan).includes('explore_unified_content_terms_idx'),'keyword probe uses real GIN index');
  const count=(await db.query('SELECT count(*)::int n FROM explore_search_session_candidates')).rows[0].n;
  assert(count<=320,'queues persist only64 global candidates per first page, not107k per session');
  const sourceFiles=['supabase/migrations/20261016010001_explore_unified_salon_search.sql','tests/fixtures/explore-unified-search-bootstrap.mjs','tests/explore-unified-search.integration.test.mjs','tests/explore-unified-search-scale.integration.test.mjs'];
  const evidence={checkedAt:new Date().toISOString(),environment:'Local in-memory PGlite only; no external database connection',salons:107414,referencePosts:107414,timings,candidates:count,keywordPlan:plan,
   limitations:['WASM timings depend on host load; these are not production benchmarks.','Legacy source indexes are bulk-built unchanged for fixture loading; the complete new migration/backfill is executed.','Name matching is independent; style/facet evidence must occur in actual public post terms, never synthetic image labels or directory names.','Fallback ordering: fixed-area primary, actual broader names/full posts, partial real posts, category references with snapshotted real media, then suggested-only category references; every outside-area row is labelled.','Media availability freezes reference rank; current public media always hydrates fresh without changing the delivered ordinal.'],
   commands:['node --test tests/explore-unified-search.integration.test.mjs','node --test tests/explore-unified-search-scale.integration.test.mjs'],
   sourceHashes:Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')])),
   functionHashes:(await db.query("SELECT proname,md5(pg_get_functiondef(oid)) AS definition_md5 FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'explore_unified_%' OR proname IN ('refresh_explore_unified_search','hydrate_explore_unified_search','search_public_explore_session')) ORDER BY proname")).rows};
  if(process.env.EXPLORE_WRITE_LOCAL_AUDIT==='1'){mkdirSync('work/explore-search-continuity-20261016/audit',{recursive:true});writeFileSync('work/explore-search-continuity-20261016/audit/unified-sql-validation.json',JSON.stringify(evidence,null,2)+'\n');}
  t.diagnostic(JSON.stringify({timings,candidates:count,keywordPlan:plan}));
 }finally{await f.close();}
});
