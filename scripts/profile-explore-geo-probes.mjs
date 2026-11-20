// Read-only plans in the dedicated localhost synthetic search database.
import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const target=new URL(process.env.EXPLORE_BENCHMARK_DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(target.hostname)||!/^\/explore_load(?:_[a-z0-9_]+)?$/i.test(target.pathname))throw new Error('Dedicated localhost benchmark database required.');
const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
const pool=new Pool({connectionString:target.href});
const client=await pool.connect();
const geo=`latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
 AND extensions.earth_box(extensions.ll_to_earth(43.0389,-87.9065),16093.44)
 OPERATOR(extensions.@>) extensions.ll_to_earth(latitude,longitude)
 AND extensions.earth_distance(extensions.ll_to_earth(43.0389,-87.9065),extensions.ll_to_earth(latitude,longitude))<=16093.44`;
const checks=[['all','true'],['common-category',"service_category_search_text LIKE '%nails%'"],
 ['common-word',"search_document LIKE '%nail%'"],['rare-word',"search_document LIKE '%king nails%'"],
 ['rare-tokens',"search_document LIKE '%studio%' AND search_document LIKE '%1999%'"],
 ['zero-word',"search_document LIKE '%zzzzunknownsalon%'"],['zero-category',"service_category_search_text LIKE '%lashes%'"]];
const reports=[];
const summarize=(node,rows=[])=>{
 rows.push({type:node['Node Type'],index:node['Index Name'],rows:node['Actual Rows'],loops:node['Actual Loops'],
  removed:node['Rows Removed by Filter'],blocks:(node['Shared Hit Blocks']??0)+(node['Shared Read Blocks']??0),indexCondition:node['Index Cond']});
 for(const child of node.Plans??[])summarize(child,rows);return rows;
};
try{
 await client.query("SET statement_timeout='30s'");
 for(const [base,filter] of checks)for(const [suffix,geometry,limit] of [
  ['probe',geo,257],['exists',geo,1],
  ['distance-only-probe',`latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
    AND extensions.earth_distance(extensions.ll_to_earth(43.0389,-87.9065),extensions.ll_to_earth(latitude,longitude))<=16093.44`,257]]){
  const name=base+'-'+suffix;
  const query=`SELECT salon_id FROM public.explore_salon_documents WHERE created_at<=now()
   AND (public_discovery_published_at IS NULL OR public_discovery_published_at<=now()) AND ${geometry} AND ${filter} LIMIT ${limit}`;
  const plan=(await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query)).rows[0]['QUERY PLAN'][0];
  const report={name,query,ms:plan['Execution Time'],nodes:summarize(plan.Plan),plan};reports.push(report);
  console.log(JSON.stringify({name,ms:report.ms,nodes:report.nodes}));
 }
 const output=process.argv[2]??'work/explore-load-results/geo-eligibility-probes.json';
 mkdirSync(path.dirname(path.resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(reports,null,2));
}finally{client.release();await pool.end();}
