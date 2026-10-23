import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const endpoint=new URL(process.env.EXPLORE_BENCHMARK_DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||!/^\/explore_load_feed_[a-z0-9_]+$/i.test(endpoint.pathname))throw new Error('Dedicated localhost feed benchmark database required.');
const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg'),pool=new Pool({connectionString:endpoint.href,max:16});
const file='supabase/migrations/20261009091031_explore_inspiration_cursor_projection.sql',sql=readFileSync(file,'utf8');
const output=process.argv[2]??'work/explore-load-results/inspiration-native-1m.json',report={startedAt:new Date().toISOString(),migrationFile:file,
 migrationSha256:createHash('sha256').update(sql).digest('hex'),limitations:['Native localhost synthetic media projection; no HTTP/browser/enrichment cost.','Buffers/OS cache not evicted.'],groups:[]};
mkdirSync(path.dirname(path.resolve(output)),{recursive:true});const persist=()=>writeFileSync(output,JSON.stringify(report,null,2));
const p=(xs,n)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*n)-1)]??null,round=n=>n===null?null:Math.round(n*100)/100;
try{
 const owned=(await pool.query("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='explore_social_benchmark_environment' AND table_schema='public') owned")).rows[0].owned;
 if(!owned)throw new Error('Owned million-post feed fixture required.');
 const loaded=(await pool.query("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='explore_home_inspiration_documents' AND table_schema='public') loaded")).rows[0].loaded;
 const setup=performance.now();if(!loaded)await pool.query(sql);report.projectionSetupMs=round(performance.now()-setup);
 await pool.query('ANALYZE explore_home_inspiration_documents');
 report.fixture=(await pool.query('SELECT count(*)::int projected_media FROM explore_home_inspiration_documents')).rows[0];persist();
 for(const concurrency of [1,8,16]){let next=0;const events=[],start=performance.now();await Promise.all(Array.from({length:concurrency},async()=>{const client=await pool.connect();try{
  await client.query("SET statement_timeout='3s'");
  while(next++<48){let cursor=null;const seen=new Set();for(let page=0;page<3;page++){const timer=performance.now();try{
   const rows=(await client.query('SELECT * FROM get_public_explore_inspiration($1,$2,24)',[cursor?.media_id??null,cursor?.published_at??null])).rows;
   let duplicates=0;for(const row of rows.slice(0,24)){if(seen.has(row.media_id))duplicates++;seen.add(row.media_id);}
   events.push({page,ms:performance.now()-timer,rows:rows.length,duplicates,overLimit:rows.length>25});if(rows.length<25)break;cursor=rows[23];
  }catch(error){events.push({page,ms:performance.now()-timer,errorCode:error.code,error:error.message});break;}}}
 }finally{try{await client.query('RESET statement_timeout');}finally{client.release();}}}));
 const summarize=es=>({requests:es.length,p50Ms:round(p(es.map(e=>e.ms),.5)),p95Ms:round(p(es.map(e=>e.ms),.95))});
 const group={concurrency,durationMs:round(performance.now()-start),...summarize(events),firstPage:summarize(events.filter(e=>e.page===0)),continuation:summarize(events.filter(e=>e.page>0)),errors:events.filter(e=>e.errorCode).length,timeouts:events.filter(e=>e.errorCode==='57014').length,duplicates:events.reduce((s,e)=>s+(e.duplicates??0),0),overLimit:events.some(e=>e.overLimit),events};
 report.groups.push(group);persist();console.log(JSON.stringify({concurrency,...summarize(events),errors:group.errors,timeouts:group.timeouts,duplicates:group.duplicates,overLimit:group.overLimit}));}
 const anchor=(await pool.query('SELECT media_id,published_at FROM explore_home_inspiration_documents ORDER BY published_at DESC,media_id DESC,content_key DESC OFFSET 23 LIMIT 1')).rows[0];
 report.continuationPlan=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM explore_home_inspiration_documents WHERE ROW(published_at,media_id)<ROW($1::timestamptz,$2::uuid) ORDER BY published_at DESC,media_id DESC,content_key DESC LIMIT 25',[anchor.published_at,anchor.media_id])).rows[0]['QUERY PLAN'][0];
 report.completedAt=new Date().toISOString();persist();
}catch(error){report.failure={message:error.message,code:error.code};persist();throw error;}finally{await pool.end();}
