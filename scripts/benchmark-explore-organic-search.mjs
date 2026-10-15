// Synthetic source-only database clone. Production and prior matrices stay intact.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
const url=new URL(process.env.EXPLORE_ORGANIC_DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/explore_load_feed_organic')throw new Error('Exact isolated organic clone required.');
const adminUrl=new URL(url);adminUrl.pathname='/postgres';
const admin=new Pool({connectionString:adminUrl.href,max:1});
const sql=readFileSync('supabase/migrations/20261009120031_explore_organic_content_search.sql','utf8');
const hash=createHash('sha256').update(sql).digest('hex');
try{
 if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='explore_load_feed_organic'")).rows.length){
  console.log('Cloning isolated million-post source fixture');
  await admin.query('CREATE DATABASE explore_load_feed_organic TEMPLATE explore_load_feed_million');
 }
}finally{await admin.end();}
const db=new Pool({connectionString:url.href,max:16});
const report={scope:'native organic keyword candidates/session/page/hydration; excludes HTTP, browser and canonical enrichment',migrationSha256:hash,counts:{},cases:[],plans:[]};
const actor=`guest:${'d'.repeat(64)}`;
const rankingModule={exports:{}};
const compiled=ts.transpileModule(readFileSync('lib/explore-social-feed-ranking.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
new Function('module','exports',compiled)(rankingModule,rankingModule.exports);
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
const nodes=(plan)=>[{type:plan['Node Type'],relation:plan['Relation Name']??null,index:plan['Index Name']??null,rows:plan['Actual Rows'],loops:plan['Actual Loops'],removed:plan['Rows Removed by Filter']??0},...(plan.Plans??[]).flatMap(nodes)];
try{
 report.counts=(await db.query('SELECT (SELECT count(*) FROM explore_salon_documents)::int AS salons,(SELECT count(*) FROM explore_social_content_documents)::int AS posts')).rows[0];
 assert.equal(report.counts.posts,1000000);assert.equal(report.counts.salons,100000);
 const existing=(await db.query("SELECT to_regclass('public.explore_social_keyword_benchmark_meta') AS name")).rows[0].name;
 if(!existing){
  console.log('Materializing one million private keyword documents');
  await db.query(sql);
  await db.query('CREATE TABLE explore_social_keyword_benchmark_meta(migration_hash text NOT NULL,seeded boolean NOT NULL DEFAULT false)');
  await db.query('INSERT INTO explore_social_keyword_benchmark_meta VALUES($1,false)',[hash]);
 }else assert.equal((await db.query('SELECT migration_hash FROM explore_social_keyword_benchmark_meta')).rows[0].migration_hash,hash,'clone must match frozen migration');
 if(!(await db.query('SELECT seeded FROM explore_social_keyword_benchmark_meta')).rows[0].seeded){
  console.log('Adding actual public source captions with selective themes');
  await db.query("UPDATE salon_profile_looks SET title='Gold Christmas nail design',caption='#Christmas gold holiday ombre' WHERE id IN(SELECT content_id FROM explore_social_content_documents WHERE source_type='salon_profile_look' AND state_code='WI' ORDER BY content_key LIMIT 1200)");
  await db.query('UPDATE explore_social_keyword_benchmark_meta SET seeded=true');
  await db.query('ANALYZE explore_social_content_keywords; ANALYZE explore_social_content_documents;');
 }
 report.counts.keywords=Number((await db.query('SELECT count(*) AS count FROM explore_social_content_keywords')).rows[0].count);
 const cases=[{name:'selective compound WI',query:'gold christmas',location:'WI',strictLocation:true},{name:'common compound WI',query:'synthetic caption',location:'WI',strictLocation:true},{name:'common beauty global',query:'synthetic beauty'},{name:'selective Latest WI',query:'gold christmas',location:'WI',strictLocation:true,intent:'latest'},{name:'common Latest global',query:'synthetic beauty',intent:'latest'},{name:'missing theme',query:'halloween turquoise'},{name:'missing selective Latest',query:'gold turquoise',intent:'latest'}];
 for(const filters of cases){
  const name=filters.name;delete filters.name;
  for(const concurrency of [1,8,16]){
   let next=0;const elapsed=[],first=[],continuation=[];let totalItems=0;
   await Promise.all(Array.from({length:concurrency},async()=>{while(next++<32){
    const start=performance.now();
    const pool=(await db.query('SELECT get_explore_social_candidate_pool($1,$2) AS value',[actor,filters])).rows[0].value;
    elapsed.push(performance.now()-start);
    const queue=rankingModule.exports.buildExploreSocialFeedQueue(pool,filters.intent);assert.ok(queue.length<=384);
    assert.ok(queue.every(item=>item.sourceType!=='directory'));
    if(name.startsWith('missing')){assert.equal(queue.length,0);continue;}
    if(filters.intent==='latest')assert.ok(queue.every((item,n)=>n===0||Date.parse(queue[n-1].publishedAt)>=Date.parse(item.publishedAt)),'Latest candidates stay chronological');
    assert.ok(queue.length>=12);const params=[actor,filters,pool.asOf,pool.region,JSON.stringify(queue)];
    const session=(await db.query('SELECT create_explore_social_feed_session($1,$2,$3,$4,$5) AS value',params)).rows[0].value;
    const page=(await db.query('SELECT get_explore_social_feed_page($1,$2,$3,12) AS value',[actor,filters,{version:1,session:session.id,after:0}])).rows[0].value;
    const keys=page.keys.map(row=>row.contentKey);assert.equal(keys.length,12);
    const relevant=Number((await db.query("SELECT count(*) AS n FROM explore_social_content_keywords WHERE content_key=ANY($1::text[]) AND search_terms @@ plainto_tsquery('english',$2)",[keys,filters.query])).rows[0].n);assert.equal(relevant,keys.length);
    const items=(await db.query('SELECT hydrate_explore_social_feed_items($1,$2,$3) AS value',[actor,page.cursor,keys])).rows[0].value;
    assert.equal(items.length,12);first.push(performance.now()-start);totalItems+=items.length;
    const laterStart=performance.now();
    const later=(await db.query('SELECT get_explore_social_feed_page($1,$2,$3,12) AS value',[actor,filters,page.cursor])).rows[0].value;
    assert.ok(later.keys.every(item=>!keys.includes(item.contentKey)));
    await db.query('SELECT hydrate_explore_social_feed_items($1,$2,$3)',[actor,later.cursor,later.keys.map(item=>item.contentKey)]);
    continuation.push(performance.now()-laterStart);
   }}));
   report.cases.push({name,concurrency,samples:elapsed.length,candidateP50Ms:percentile(elapsed,.5),candidateP95Ms:percentile(elapsed,.95),firstP95Ms:first.length?percentile(first,.95):null,nextP95Ms:continuation.length?percentile(continuation,.95):null,totalItems,errors:0,duplicates:0});
   console.log(JSON.stringify(report.cases.at(-1)));
  }
  const region=filters.location?"AND k.state_code='WI' AND d.state_code='WI'":'';
  const order=filters.intent==='latest'?'ORDER BY k.published_at DESC,k.content_key':'';
  const explain=(await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) WITH matched AS MATERIALIZED(SELECT k.content_key,k.search_terms FROM explore_social_content_keywords k JOIN explore_social_content_documents d USING(content_key) WHERE k.search_terms @@ plainto_tsquery('english',$1) ${region} AND k.published_at<=now() AND d.published_at<=now() ${order} LIMIT 256) SELECT d.content_key,ts_rank_cd(m.search_terms,plainto_tsquery('english',$1)) FROM matched m JOIN explore_social_content_documents d USING(content_key) ORDER BY ts_rank_cd(m.search_terms,plainto_tsquery('english',$1)) DESC,d.published_at DESC,d.content_key`,[filters.query])).rows[0]['QUERY PLAN'][0];
  if(name==='missing selective Latest')assert.ok(nodes(explain.Plan).some(node=>node.index==='explore_social_keyword_terms_idx'&&node.rows===0),'missing compound Latest must use low-hit GIN instead of scanning historical timestamps');
  report.plans.push({name,executionMs:explain['Execution Time'],nodes:nodes(explain.Plan)});
 }
 const watermark=await db.connect();
 try{
  await watermark.query('BEGIN');
  const filters={query:'synthetic caption'};
  const pool=(await watermark.query('SELECT get_explore_social_candidate_pool($1,$2) AS value',[actor,filters])).rows[0].value;
  const asOf=(await watermark.query("SELECT now()-interval '1 second' AS at")).rows[0].at.toISOString();
  const queue=module.exports.buildExploreSocialFeedQueue(pool);
  const session=(await watermark.query('SELECT create_explore_social_feed_session($1,$2,$3,$4,$5) AS value',[actor,filters,asOf,pool.region,JSON.stringify(queue)])).rows[0].value;
  const cursor={version:1,session:session.id,after:0};
  assert.equal((await watermark.query('SELECT get_explore_social_feed_updates($1,$2,$3) AS value',[actor,filters,cursor])).rows[0].value.hasNewPosts,false);
  const service=(await watermark.query('SELECT id,salon_id FROM services WHERE is_active AND online_booking_enabled LIMIT 1')).rows[0];
  await watermark.query("INSERT INTO salon_profile_looks(id,salon_id,title,caption,service_id,media_path,status,published_at) VALUES(md5('organic-watermark-fixture')::uuid,$1,'Synthetic post','Synthetic caption new style',$2,'synthetic/newtheme.webp','published',now())",[service.salon_id,service.id]);
  const values=[];
  for(let n=0;n<22;n++){
   const started=performance.now();assert.equal((await watermark.query('SELECT get_explore_social_feed_updates($1,$2,$3) AS value',[actor,filters,cursor])).rows[0].value.hasNewPosts,true);
   if(n>=2)values.push(performance.now()-started);
  }
  const plan=(await watermark.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT k.content_key FROM explore_social_content_keywords k JOIN explore_social_content_documents d USING(content_key) WHERE k.search_terms @@ plainto_tsquery('english',$1) AND k.published_at>$2 AND k.published_at<=now() AND d.published_at<=now() LIMIT 1",[filters.query,asOf])).rows[0]['QUERY PLAN'][0];
  const planNodes=nodes(plan.Plan);assert.ok(planNodes.some(node=>node.index==='explore_social_keyword_new_idx'),'common-theme watermark must seek recent publication timestamps');
  report.watermark={samples:20,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),executionMs:plan['Execution Time'],nodes:planNodes};
 }finally{await watermark.query('ROLLBACK');watermark.release();}
 writeFileSync('work/explore-load-results/organic-native-1m.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({counts:report.counts,cases:report.cases,watermark:report.watermark,plans:report.plans.map(plan=>({name:plan.name,executionMs:plan.executionMs,nodes:plan.nodes.filter(node=>node.index||node.type==='Seq Scan')}))},null,2));
}finally{await db.end();}
