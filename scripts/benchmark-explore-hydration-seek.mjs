import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
const urls=[process.env.EXPLORE_HYDRATE_POSTS_DATABASE_URL,process.env.EXPLORE_HYDRATE_SALONS_DATABASE_URL];
for(let n=0;n<urls.length;n++){
 const endpoint=new URL(urls[n]);
 if(!['127.0.0.1','localhost'].includes(endpoint.hostname)||endpoint.pathname!==(n?'/explore_load_final':'/explore_load_feed_million'))throw new Error('Exact dedicated local benchmark database required.');
}
const actor=`guest:${'e'.repeat(64)}`;
const oldSource=readFileSync('supabase/migrations/20261009080031_explore_social_discovery.sql','utf8');
const newSource=readFileSync('supabase/migrations/20261009098031_explore_selected_directory_hydration.sql','utf8');
const definition=source=>source.match(/CREATE (?:OR REPLACE )?FUNCTION public\.hydrate_explore_social_feed_items\([\s\S]*?END \$\$;/)[0];
const oldDefinition=definition(oldSource),newDefinition=definition(newSource);
const oldJoin="s.key='directory:'||d.salon_id";
const newJoin="d.salon_id=CASE WHEN s.key ~ '^directory:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN substring(s.key FROM 11)::uuid END";
assert.equal(newDefinition.replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION').replace(newJoin,()=>oldJoin),oldDefinition,'only the selected directory join may differ');
const report={scope:'native selected hydration only; no HTTP/browser/canonical trust enrichment',provider:[],postFixture:{},salonFixture:{}};
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
function nodes(plan,predicate){return[...(predicate(plan)?[plan]:[]),...(plan.Plans??[]).flatMap(child=>nodes(child,predicate))];}
const pool=new Pool({connectionString:urls[0],max:1});
const db=await pool.connect();
try{
 report.provider.push((await db.query("SELECT current_setting('jit') AS jit,pg_jit_available() AS available")).rows[0]);
 report.postFixture.counts=(await db.query('SELECT (SELECT count(*) FROM explore_salon_documents)::int AS salons,(SELECT count(*) FROM explore_social_content_documents)::int AS posts')).rows[0];
 assert.equal(report.postFixture.counts.salons,100000);assert.equal(report.postFixture.counts.posts,1000000);
 await db.query('BEGIN');
 await db.query(oldDefinition.replace('hydrate_explore_social_feed_items','_explore_hydration_bench_reference'));
 await db.query(newDefinition.replace('hydrate_explore_social_feed_items','_explore_hydration_bench_seek'));
 const docs=(await db.query('SELECT salon_id FROM explore_salon_documents ORDER BY salon_id LIMIT 12')).rows;
 const at=(await db.query('SELECT now() AS at')).rows[0].at.toISOString();
 const queue=docs.map(row=>({contentKey:`directory:${row.salon_id}`,sourceType:'directory',contentId:row.salon_id,salonId:row.salon_id,publishedAt:at,scope:'wider',lane:'expanded'}));
 const session=(await db.query('SELECT create_explore_social_feed_session($1,$2,$3,$4,$5) AS value',[actor,{},at,{kind:'global'},JSON.stringify(queue)])).rows[0].value;
 const page=(await db.query('SELECT get_explore_social_feed_page($1,$2,$3,12) AS value',[actor,{},JSON.stringify({version:1,session:session.id,after:0})])).rows[0].value;
 assert.equal(page.keys.length,12);const args=[actor,JSON.stringify(page.cursor),page.keys.map(row=>row.contentKey)];
 const samples={reference:[],seek:[]};let expected;
 for(let n=0;n<22;n++)for(const [variant,name] of [['reference','_explore_hydration_bench_reference'],['seek','_explore_hydration_bench_seek']]){
  const start=process.hrtime.bigint();
  const data=(await db.query(`SELECT public.${name}($1,$2,$3) AS value`,args)).rows[0].value;
  assert.equal(data.length,12);if(!expected)expected=data;else assert.deepEqual(data,expected);
  if(n>=2)samples[variant].push(Number(process.hrtime.bigint()-start)/1e6);
 }
 report.postFixture.metrics=Object.fromEntries(Object.entries(samples).map(([variant,values])=>[variant,{samples:20,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95)}]));
 await db.query('ROLLBACK');
}finally{db.release();await pool.end();}

const large=new Pool({connectionString:urls[1],max:1});
try{
 report.provider.push((await large.query("SELECT current_setting('jit') AS jit,pg_jit_available() AS available")).rows[0]);
 report.salonFixture.salons=(await large.query('SELECT count(*)::int AS n FROM explore_salon_documents')).rows[0].n;
 assert.equal(report.salonFixture.salons,1000000);
 const ids=(await large.query('SELECT salon_id FROM explore_salon_documents ORDER BY salon_id LIMIT 12')).rows.map(row=>row.salon_id);
 const query=join=>`WITH selected AS (SELECT key,ordinality FROM unnest($1::text[]) WITH ORDINALITY x(key,ordinality)) SELECT jsonb_agg(to_jsonb(d) ORDER BY s.ordinality) FROM selected s JOIN explore_salon_documents d ON ${join}`;
 const keys=ids.map(value=>`directory:${value}`);
 report.salonFixture.beforePlan=(await large.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query(oldJoin),[keys])).rows[0]['QUERY PLAN'][0];
 report.salonFixture.afterPlan=(await large.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query(newJoin),[keys])).rows[0]['QUERY PLAN'][0];
 const scans=nodes(report.salonFixture.afterPlan.Plan,node=>node['Relation Name']==='explore_salon_documents');
 assert.ok(scans.length>0&&scans.every(node=>node['Node Type']==='Index Scan'&&node['Index Name']==='explore_salon_documents_pkey'),'one-million-salon directory branch must seek primary key, never sequential scan');
 assert.ok(scans.every(node=>node['Actual Rows']<=1&&node['Actual Loops']<=12));
 writeFileSync('work/explore-load-results/hydration-directory-seek.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({postFixture:report.postFixture,salonCount:report.salonFixture.salons,salonBeforeMs:report.salonFixture.beforePlan['Execution Time'],salonAfterMs:report.salonFixture.afterPlan['Execution Time'],afterScans:scans.map(node=>({type:node['Node Type'],index:node['Index Name'],rows:node['Actual Rows'],loops:node['Actual Loops']})),provider:report.provider}));
}finally{await large.end();}
