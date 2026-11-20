import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createUnifiedExploreFixture,fixtureId as id,seedSalon,searchFixture as search} from './fixtures/explore-unified-search-bootstrap.mjs';

const fresh=async run=>{const fixture=await createUnifiedExploreFixture({seed:false,localQuality:true});try{await run(fixture.db);}finally{await fixture.close();}};

test('signature and compact-prefix probes preserve every shipped fuzzy proof in the equivalence matrix',{timeout:120000},()=>fresh(async db=>{
 // Exercise the ACTUAL selected-token/OR predicate from the frozen migration,
 // independently comparing it with the unchanged canonical fuzzy predicate.
 const source=readFileSync('supabase/migrations/20261119042923_explore_local_quality_search.sql','utf8');
 const start=source.indexOf(' SELECT token INTO fuzzy_needle FROM unnest(name_terms) token');
 const end=source.indexOf('\n IF s.unified_anchor IS NOT NULL',start);
 assert(start>=0&&end>start,'the conservative probe source is explicit and reviewable');
 await db.exec(`CREATE FUNCTION fixture_name_probe_condition(p_query text) RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
  DECLARE q text:=p_query;name_terms text[]:=explore_local_words(p_query);fuzzy_needle text;fuzzy_keys text[];fuzzy_condition text;
  BEGIN ${source.slice(start,end)}
   RETURN fuzzy_condition;
  END$$;
  CREATE FUNCTION fixture_name_probe(p_name text,p_query text) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
  DECLARE fuzzy_condition text:=fixture_name_probe_condition(p_query);result boolean;
  BEGIN
   EXECUTE 'SELECT '||fuzzy_condition||' FROM (SELECT $1::text AS name_text) h' INTO result USING p_name;
   RETURN result;
  END$$;`);
 for(const query of ['1234 nails','東京 nails','ab nails','nails',"12'34 nails"]){
  const row=(await db.query('SELECT fixture_name_probe_condition($1) AS condition,quote_literal($1::text) AS literal',[query])).rows[0];
  assert.equal(row.condition,`h.name_text OPERATOR(extensions.%) ${row.literal}`,`${query}: unsupported signature tokens keep the visible old index predicate and an escaped literal`);
 }
 const long='a'.repeat(79)+'b';
 const cases=[
  ['digit substitution','king nails','kin9 nails',true],
  ['interior digit substitution','king nails','k9ng nails',true],
  ['leading digit insertion','king nails','9king nails',true],
  ['trailing digit prefix','king nails','king9 nails',true],
  ['letter substitution','king nails','kong nails',true],
  ['letter insertion','king nails','kiing nails',true],
  ['letter deletion','kng nails','king nails',true],
  ['adjacent transposition','kign nails','king nails',true],
  ['three-character query token','abc nails','axc nails',true],
  ['generic name word retained','naiks studio','nails studio',true],
  ['joined compact words','king nails','kingnails',true],
  ['cross-space compact prefix','king nails','kin g nails',true],
  ['selected token after generic','nails king','kin9 nails',true],
  ['multiple distinctive tokens','queen king nails','queen kin9 nails',true],
  ['conservative skipped extra generic','hair kign','hair king',true],
  ['eighty-character token and longer name',long,'z'+long,true],
  ['out-of-signature-bound compact prefix',long,long+'xy',true],
  ['short-token fallback','ab nails','abc nails',true],
  ['numeric fallback','1234 nails','1235 nails',true],
  ['Unicode fallback','東京 nails','東京 nails',true],
  ['Unicode name substitution','king nails','kíng nails',true],
  ['unrelated distinctive word','king nails','angel nails',false],
  ['too-short near token','abc nails','ab nails',false],
 ];
 const rows=(await db.query(`SELECT label,query,name,expected,
  name OPERATOR(extensions.%) query AND explore_unified_name_similarity(name,query)>0 AS old_match,
  fixture_name_probe(name,query) AS conservative_probe,explore_local_fuzzy_match(name,query) AS opaque_proof
  FROM unnest($1::text[],$2::text[],$3::text[],$4::boolean[]) pairs(label,query,name,expected)`,
  [cases.map(x=>x[0]),cases.map(x=>x[1]),cases.map(x=>x[2]),cases.map(x=>x[3])])).rows;
 for(const row of rows){
  assert.equal(row.old_match,row.expected,`${row.label}: the independent old predicate is exercised`);
  if(row.old_match)assert.equal(row.conservative_probe,true,`${row.label}: the indexed probe cannot discard an old fuzzy candidate`);
  assert.equal(row.opaque_proof,row.old_match,`${row.label}: the final opaque proof keeps the old semantics`);
 }
 assert.equal((await db.query("SELECT provolatile FROM pg_proc WHERE oid='explore_local_fuzzy_match(text,text)'::regprocedure")).rows[0].provolatile,'s','the trigram threshold is session configuration, so proof is STABLE');
}));

test('frozen fuzzy candidates retain matching renames and reject current names that no longer prove the query',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'King Nails',city:'Milwaukee'});
 const input={query:'kng nails',contentQuery:'kng nails',queryKind:'name',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed'};
 const first=await search(db,input);assert.equal(first.rows[0]?.salon_id,id(1));assert.equal(first.rows[0].match_type,'fuzzy_name');
 await db.query("UPDATE explore_salon_documents SET salon_name='King Nails Studio',salon_name_search='king nails studio' WHERE salon_id=$1",[id(1)]);
 const matching=await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(1)]});
 assert.equal(matching.rows[0]?.salon_id,id(1));assert.equal(matching.rows[0].salon_name,'King Nails Studio');
 await db.query("UPDATE explore_salon_documents SET salon_name='Queen Nails',salon_name_search='queen nails' WHERE salon_id=$1",[id(1)]);
 assert.deepEqual((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(1)]})).rows,[]);
 assert.deepEqual((await search(db,input)).rows,[]);
 const renamed=await search(db,{...input,query:'queen nails',contentQuery:'queen nails'});
 assert.equal(renamed.rows[0]?.salon_id,id(1));assert.equal(renamed.rows[0].match_type,'exact_name');
}));
