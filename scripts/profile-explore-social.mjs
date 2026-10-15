import {createRequire} from 'node:module';
import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const endpoint=new URL(process.env.EXPLORE_BENCHMARK_DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||!/^\/explore_load_feed_[a-z0-9_]+$/i.test(endpoint.pathname))throw new Error('Dedicated localhost feed database required.');
const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg'),db=new Pool({connectionString:endpoint.href});
const output=process.argv[2]??'work/explore-load-results/social-native-candidate-plans.json',report={startedAt:new Date().toISOString(),plans:[]};
try{
 const region=(await db.query('SELECT explore_search_region(NULL,43.0389,-87.9065) AS value')).rows[0].value;
 const predicate=(await db.query('SELECT explore_search_region_predicate($1) AS value',[region])).rows[0].value;
 for(const [name,query] of [
  ['state-new-pool',"SELECT d.content_key,d.source_type,d.content_id,d.salon_id,d.published_at FROM explore_social_content_documents d WHERE d.state_code='WI' AND d.published_at<=now() ORDER BY d.published_at DESC,d.content_key LIMIT 96"],
  ['gps-new-pool',`SELECT d.content_key,d.source_type,d.content_id,d.salon_id,d.published_at FROM explore_social_content_documents d WHERE ${predicate} AND d.published_at<=now() ORDER BY d.published_at DESC,d.content_key LIMIT 96`],
  ['gps-trending-pool',`SELECT d.content_key,c.source_type,c.content_id,c.salon_id,c.published_at,d.score FROM explore_social_trending d JOIN explore_social_content_documents c USING(content_key) WHERE ${predicate} AND c.published_at<=now() ORDER BY d.score DESC,d.content_key LIMIT 96`],
  ['gps-directory-pool',`SELECT salon_id FROM explore_salon_documents d WHERE ${predicate} AND d.salon_id>='80000000-0000-4000-8000-000000000000' ORDER BY d.salon_id LIMIT 64`],
 ]){
  const plan=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query)).rows[0]['QUERY PLAN'][0];
  report.plans.push({name,query,plan});console.log(JSON.stringify({name,executionMs:plan['Execution Time'],rootType:plan.Plan['Node Type']}));
 }
 const timer=performance.now();await db.query('SELECT refresh_explore_social_pools()');report.backgroundTrendAndDirectoryRefreshMs=performance.now()-timer;
 report.cache=(await db.query('SELECT (SELECT count(*) FROM explore_social_trending)::int trending,(SELECT count(*) FROM explore_social_directory_pool)::int directory')).rows[0];
 report.completedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({refreshMs:report.backgroundTrendAndDirectoryRefreshMs,cache:report.cache}));
}finally{await db.end();}
