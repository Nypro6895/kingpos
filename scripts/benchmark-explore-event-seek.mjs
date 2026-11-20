import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
const urls=[process.env.EXPLORE_EVENT_POSTS_DATABASE_URL,process.env.EXPLORE_EVENT_SALONS_DATABASE_URL];
for(let n=0;n<urls.length;n++){
 const endpoint=new URL(urls[n]);
 if(!['127.0.0.1','localhost'].includes(endpoint.hostname)||endpoint.pathname!==(n?'/explore_load_final':'/explore_load_feed_million'))throw new Error('Exact dedicated local benchmark database required.');
}
const source=readFileSync('supabase/migrations/20261009080031_explore_social_discovery.sql','utf8');
const newSource=readFileSync('supabase/migrations/20261009099031_explore_selected_directory_events.sql','utf8');
const definition=text=>text.match(/CREATE (?:OR REPLACE )?FUNCTION public\.record_explore_social_events\([\s\S]*?END \$\$;/)[0];
const oldDefinition=definition(source),newDefinition=definition(newSource);
const oldPredicate="'directory:'||d.salon_id=e->>'contentKey'";
const newPredicate="d.salon_id=CASE WHEN (e->>'contentKey') ~ '^directory:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN substring(e->>'contentKey' FROM 11)::uuid END";
assert.equal(newDefinition.replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION').replace(newPredicate,()=>oldPredicate),oldDefinition,'only selected event directory existence predicate may differ');
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
const nodes=(plan,predicate)=>[...(predicate(plan)?[plan]:[]),...(plan.Plans??[]).flatMap(child=>nodes(child,predicate))];
const report={scope:'native selected directory event admission only; transactions roll back all events and temporary functions',postFixture:{},salonFixture:{}};
const actor=`guest:${'f'.repeat(64)}`;
const pool=new Pool({connectionString:urls[0],max:1});const db=await pool.connect();
try{
 report.postFixture.counts=(await db.query('SELECT (SELECT count(*) FROM explore_salon_documents)::int AS salons,(SELECT count(*) FROM explore_social_content_documents)::int AS posts')).rows[0];
 assert.equal(report.postFixture.counts.salons,100000);assert.equal(report.postFixture.counts.posts,1000000);
 await db.query('BEGIN');
 await db.query(oldDefinition.replace('record_explore_social_events','_explore_event_bench_reference'));
 await db.query(newDefinition.replace('record_explore_social_events','_explore_event_bench_seek'));
 const docs=(await db.query('SELECT salon_id FROM explore_salon_documents ORDER BY salon_id DESC LIMIT 12')).rows;
 const at=(await db.query('SELECT now() AS at')).rows[0].at.toISOString();
 const queue=docs.map(row=>({contentKey:`directory:${row.salon_id}`,sourceType:'directory',contentId:row.salon_id,salonId:row.salon_id,publishedAt:null,scope:'wider',lane:'expanded'}));
 const session=(await db.query('SELECT create_explore_social_feed_session($1,$2,$3,$4,$5) AS value',[actor,{},at,{kind:'global'},JSON.stringify(queue)])).rows[0].value;
 const page=(await db.query('SELECT get_explore_social_feed_page($1,$2,$3,12) AS value',[actor,{},JSON.stringify({version:1,session:session.id,after:0})])).rows[0].value;
 assert.equal(page.keys.length,12);
 const events=page.keys.map(row=>({contentKey:row.contentKey,kind:'meaningful_view',elapsedMs:2000,ratio:.5}));
 const args=[actor,JSON.stringify(page.cursor),JSON.stringify(events)];const samples={reference:[],seek:[]};
 for(let n=0;n<12;n++)for(const [variant,name] of [['reference','_explore_event_bench_reference'],['seek','_explore_event_bench_seek']]){
  await db.query('SAVEPOINT event_sample');const started=process.hrtime.bigint();
  assert.equal((await db.query(`SELECT public.${name}($1,$2,$3) AS value`,args)).rows[0].value,12);
  if(n>=2)samples[variant].push(Number(process.hrtime.bigint()-started)/1e6);
  assert.equal((await db.query(`SELECT public.${name}($1,$2,$3) AS value`,args)).rows[0].value,0);
  await db.query('ROLLBACK TO SAVEPOINT event_sample');
 }
 report.postFixture.metrics=Object.fromEntries(Object.entries(samples).map(([variant,values])=>[variant,{samples:10,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95)}]));
 await db.query('ROLLBACK');
}finally{db.release();await pool.end();}
const large=new Pool({connectionString:urls[1],max:1});
try{
 report.salonFixture.salons=Number((await large.query('SELECT count(*) AS count FROM explore_salon_documents')).rows[0].count);assert.equal(report.salonFixture.salons,1000000);
 const events=(await large.query("SELECT 'directory:'||salon_id AS key FROM explore_salon_documents ORDER BY salon_id DESC LIMIT 20")).rows.map(row=>({contentKey:row.key}));
 for(const [variant,predicate] of [['reference',oldPredicate],['seek',newPredicate]]){
  const result=(await large.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT count(*) FROM jsonb_array_elements($1::jsonb) e WHERE EXISTS(SELECT 1 FROM explore_salon_documents d WHERE ${predicate})`,[JSON.stringify(events)])).rows[0]['QUERY PLAN'][0];
  report.salonFixture[variant]={executionMs:result['Execution Time'],planningMs:result['Planning Time'],directoryNodes:nodes(result.Plan,node=>node['Relation Name']==='explore_salon_documents').map(node=>({type:node['Node Type'],index:node['Index Name']??null,rows:node['Actual Rows'],loops:node['Actual Loops'],hits:node['Shared Hit Blocks'],reads:node['Shared Read Blocks']}))};
  if(variant==='seek')assert.ok(report.salonFixture[variant].directoryNodes.every(node=>node.type!=='Seq Scan'&&node.rows<=1&&node.loops<=20),'selected directory events must seek at most one UUID row for each bounded key');
 }
}finally{await large.end();}
writeFileSync('work/explore-load-results/event-directory-seek.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
