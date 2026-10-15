import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const migration = 'supabase/migrations/20261009125031_explore_negative_fuzzy_guard.sql';

export async function verifyNegativeFuzzyGuard(db) {
 const query = async (q, category='Nails', location=null, policy='expandable', cursor=null) => (await db.query('SELECT public.search_public_explore_session(p_query=>$1,p_category=>$2,p_location=>$3,p_scope_policy=>$4,p_cursor=>$5) result',[q,category,location,policy,cursor])).rows[0].result;
 const pulls = async () => Number((await db.query('SELECT count(*) n FROM public.explore_guard_test_pull_calls')).rows[0].n);
 const clear = () => db.query('DELETE FROM public.explore_guard_test_pull_calls');
 const baseline = await query('Qzxv Unlisted Salon 917482');
 assert.equal(baseline.rows.length,0);assert.equal(await pulls(),53,'baseline enumerates exact plus51states andother for a globally absent fuzzy name');
 const known = [
  ['exact outside A','King Nails','Nails','Madison, WI','expandable'],
  ['common partial','nail','Nails','WI','fixed'],
  ['service all tokens','full set','Nails','WI','fixed'],
  ['fuzzy positive','prismatik nail studio','Nails','WA','fixed'],
  ['fuzzy outside fixed area','prismatik nail studio','Nails','WI','fixed'],
  ['legacy null publication','legacy pearl studip','Nails','WA','fixed'],
 ];
 const oldResults = [];
 for (const [name,...parameters] of known) oldResults.push({name,parameters,result:await query(...parameters)});
 assert.equal(oldResults[0].result.rows[0].salon_name,'King Nails');assert.equal(oldResults[0].result.rows[0].search_scope,'exact');
 assert.equal(oldResults[1].result.rows.length,12);assert.equal(oldResults[2].result.rows.length,12);
 assert.equal(oldResults[3].result.rows.length,12,'fixture has a real positive fuzzy name');assert.equal(oldResults[3].result.fuzzy,true);assert.equal(oldResults[3].result.hasMore,true);
 assert.equal(oldResults[4].result.rows.length,0);assert.equal(oldResults[5].result.rows.length,1);
 const before = (await db.query("SELECT 'public.search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)'::regprocedure::oid oid,proacl::text acl FROM pg_proc WHERE oid='public.search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)'::regprocedure")).rows[0];
 if(db.exec)await db.exec(readFileSync(migration,'utf8'));else await db.query(readFileSync(migration,'utf8'));
 const after = (await db.query("SELECT 'public.search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)'::regprocedure::oid oid,proacl::text acl FROM pg_proc WHERE oid='public.search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)'::regprocedure")).rows[0];
 assert.deepEqual(after,before,'public OID and all ACLs must be preserved');
 const strip = row => ({id:row.salon_id,scope:row.search_scope,rank:row.relevance_score,match:row.match_type,distance:row.distance_miles});
 for (const item of oldResults) {
  const current = await query(...item.parameters);
  assert.deepEqual(current.rows.map(strip),item.result.rows.map(strip),item.name+' retains selected matches/order');
  assert.equal(current.hasMore,item.result.hasMore,item.name+' retains continuation');assert.equal(current.fuzzy,item.result.fuzzy,item.name+' retains match class');
 }
 await clear();
 const negatives = ['Qzxv Unlisted Salon 917482','Qzxv Unlisted 917482','hidden violet studip','deleted amber studip','future crystal studip'];
 for (const term of negatives) {
  const page = await query(term);
  assert.equal(page.rows.length,0,term);assert.equal(page.hasMore,false);assert.equal(page.nextCursor,null);assert.equal(page.totalCount,0);
 }
 assert.equal(await pulls(),0,'one negative global-index probe eliminates all regional pulls');
 const newSessions = (await db.query("SELECT region_plan,exhausted FROM public.explore_search_sessions WHERE query_text=public.normalize_search_text('Qzxv Unlisted Salon 917482') ORDER BY created_at DESC,id")).rows;
 assert.ok(newSessions.some(row=>row.exhausted&&row.region_plan.length===0));
 await clear();
 const wrongCategory = await query('prismatik hair studio','Nails');assert.equal(wrongCategory.rows.length,0);assert.equal(await pulls(),0,'category-ineligible fuzzy names cannot force enumeration');
 const hair = await query('prismatik hair studio','Hair','WA','fixed');assert.equal(hair.rows.length,1);assert.equal(hair.rows[0].service_category_search_text,'hair');
 const first = await query('prismatik nail studio','Nails','WA','fixed');
 const hidden = (await db.query('SELECT salon_id FROM public.explore_search_session_candidates WHERE session_id=$1 AND ordinal>$2 ORDER BY ordinal LIMIT 1',[first.nextCursor.session,first.nextCursor.after])).rows[0].salon_id;
 await db.query('DELETE FROM public.explore_salon_documents WHERE salon_id=$1',[hidden]);
 let page = first,seen=new Set(first.rows.map(row=>row.salon_id));
 while(page.hasMore) {
  page=await query('prismatik nail studio','Nails','WA','fixed',page.nextCursor);
  for(const row of page.rows){assert.ok(!seen.has(row.salon_id));assert.notEqual(row.salon_id,hidden);seen.add(row.salon_id);}
 }
 assert.equal(seen.size,29,'positive fuzzy continuation remains reachable and rechecks hidden/deleted rows');
 const definition=(await db.query("SELECT pg_get_functiondef('public.search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)'::regprocedure) definition")).rows[0].definition;
 assert.ok(!/count\s*\(/i.test(definition),'search still has no exact global COUNT');
 return {baselineNegativeRegionalPulls:53,patchedNegativeRegionalPulls:0,negativeCases:negatives.length,positiveParityCases:known.length,paginatedVisibleFuzzyRows:seen.size,oidAndAclPreserved:true};
}

