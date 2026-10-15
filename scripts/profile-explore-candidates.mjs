import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const url=process.env.EXPLORE_BENCHMARK_DATABASE_URL;
const target=new URL(url);
if(!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/explore_load(?:_[a-z0-9_]+)?$/i.test(target.pathname))throw new Error('Dedicated localhost benchmark database required.');
const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
const pool=new Pool({connectionString:url});
const output=process.argv[2]??'work/explore-load-results/nested-candidate-plans.json';
const result=[];
const geo="latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND extensions.earth_box(extensions.ll_to_earth(43.0389,-87.9065),16093.44) OPERATOR(extensions.@>) extensions.ll_to_earth(latitude,longitude) AND extensions.earth_distance(extensions.ll_to_earth(43.0389,-87.9065),extensions.ll_to_earth(latitude,longitude))<=16093.44";
const common="created_at<=now() AND (public_discovery_published_at IS NULL OR public_discovery_published_at<=now())";
const client=await pool.connect();
try{
 for(const [name,predicate,order,noBitmap] of [
  ['state-quality',"state_code='WI' AND service_category_search_text LIKE '%nails%'",'profile_completeness DESC,salon_id'],
  ['city-quality',"state_code='WI' AND city_search='milwaukee' AND search_document LIKE '%nail%'",'profile_completeness DESC,salon_id'],
  ['gps-quality',geo+" AND service_category_search_text LIKE '%nails%'",'profile_completeness DESC,salon_id'],
  ['gps-closest',geo+" AND service_category_search_text LIKE '%nails%'",'extensions.ll_to_earth(latitude,longitude) OPERATOR(extensions.<->) extensions.ll_to_earth(43.0389,-87.9065),salon_id'],
  ['gps-closest-untied',geo+" AND service_category_search_text LIKE '%nails%'",'extensions.ll_to_earth(latitude,longitude) OPERATOR(extensions.<->) extensions.ll_to_earth(43.0389,-87.9065)'],
  ['gps-closest-no-bitmap',geo+" AND service_category_search_text LIKE '%nails%'",'extensions.ll_to_earth(latitude,longitude) OPERATOR(extensions.<->) extensions.ll_to_earth(43.0389,-87.9065),salon_id',true],
  ['state-id',"state_code='WI' AND service_category_search_text LIKE '%nails%'",'salon_id'],
  ['city-id',"state_code='WI' AND city_search='milwaukee' AND search_document LIKE '%nail%'",'salon_id'],
 ]){
  const query=`SELECT salon_id,salon_name_search,profile_completeness,created_at,service_categories,
   featured_service_name,active_service_count,-profile_completeness::float8 AS raw_sort,NULL::float8 AS distance_miles
   FROM public.explore_salon_documents WHERE ${common} AND ${predicate} ORDER BY ${order} LIMIT 256`;
  if(noBitmap)await client.query('SET enable_bitmapscan=off');
  const plan=(await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query)).rows[0]['QUERY PLAN'][0];
  if(noBitmap)await client.query('RESET enable_bitmapscan');
  result.push({name,query,plan});
  console.log(JSON.stringify({name,ms:plan['Execution Time'],plan:plan.Plan}));
 }
 const probeQuery=`SELECT salon_id FROM public.explore_salon_documents WHERE ${common}
  AND ${geo} AND service_category_search_text LIKE '%nails%' LIMIT 257`;
 const probe=(await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+probeQuery)).rows[0]['QUERY PLAN'][0];
 result.push({name:'gps-capped-eligibility-probe',query:probeQuery,plan:probe});
 console.log(JSON.stringify({name:'gps-capped-eligibility-probe',ms:probe['Execution Time'],plan:probe.Plan}));
 const anchor=(await client.query("SELECT salon_id FROM public.explore_salon_documents WHERE state_code='WI' AND service_category_search_text LIKE '%nails%' ORDER BY salon_id OFFSET 255 LIMIT 1")).rows[0]?.salon_id;
 if(anchor)for(const [name,condition] of [
  ['state-id-row-anchor','ROW(0::float8,salon_id)>ROW(0::float8,$1::uuid)'],
  ['state-id-direct-anchor','salon_id>$1::uuid'],
 ]){
  const query=`SELECT salon_id FROM public.explore_salon_documents WHERE ${common} AND state_code='WI'
   AND service_category_search_text LIKE '%nails%' AND ${condition} ORDER BY salon_id LIMIT 256`;
  const plan=(await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,[anchor])).rows[0]['QUERY PLAN'][0];
  result.push({name,query,plan});console.log(JSON.stringify({name,ms:plan['Execution Time'],plan:plan.Plan}));
 }
 mkdirSync(path.dirname(path.resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2));
}finally{client.release();await pool.end();}
