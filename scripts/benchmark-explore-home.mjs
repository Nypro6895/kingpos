// Legacy home compatibility RPCs on an owned localhost synthetic projection.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const options=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')];}));
const endpoint=new URL(process.env.EXPLORE_BENCHMARK_DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(endpoint.hostname)||!/^\/explore_load(?:_[a-z0-9_]+)?$/i.test(endpoint.pathname))throw new Error('Dedicated localhost benchmark database required.');
const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
const pool=new Pool({connectionString:endpoint.href,max:16,application_name:'explore_home_isolated_benchmark'});
const file='supabase/migrations/20261009090031_explore_home_candidate_cache.sql',sql=readFileSync(file,'utf8');
const hash=createHash('sha256').update(sql).digest('hex'),output=options.output??'work/explore-load-results/home-native-1m.json';
const report={startedAt:new Date().toISOString(),migrationFile:file,migrationSha256:hash,
 limitations:['Native localhost synthetic million-salon projection and service cache; no HTTP/browser/enrichment latency.',
 'Activity resolver uses an explicit fixture hint, so timings do not include real booking/work/POS evidence resolution.',
 'Buffers and OS cache are not evicted. Concurrency means SQL workers, not proven online users.'],groups:[],plans:[]};
mkdirSync(path.dirname(path.resolve(output)),{recursive:true});const persist=()=>writeFileSync(output,JSON.stringify(report,null,2));
const scalar=async(q,a=[])=> (await pool.query(q,a)).rows[0];
const p=(xs,n)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*n)-1)]??null;
const rounded=n=>n===null?null:Math.round(n*100)/100;
const users=[['11111111-1111-4111-8111-111111111111','WI'],['22222222-2222-4222-8222-222222222222','Milwaukee, WI'],
 ['33333333-3333-4333-8333-333333333333','53202'],['44444444-4444-4444-8444-444444444444','CA']];
const cases=[{name:'Guest home'},...users.slice(0,3).map(([viewer,location])=>({name:'Saved '+location,viewer})),
 {name:'Reliable activity over saved CA',viewer:users[3][0],activity:{source:'activity',label:'Milwaukee, WI',confidence:.8,evidenceDays:4}},
 {name:'Weak activity keeps saved CA',viewer:users[3][0],activity:{source:'activity',label:'Milwaukee, WI',confidence:.69,evidenceDays:4}},
 {name:'Popular cached categories',popular:true}];
try{
 const marker=await scalar("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='explore_benchmark_environment' AND table_schema='public') owned");
 if(!marker.owned)throw new Error('Owned search benchmark fixture required.');
 await pool.query(`CREATE TABLE IF NOT EXISTS explore_user_preferences(user_id uuid PRIMARY KEY,location_label text,categories text[]);
  CREATE TABLE IF NOT EXISTS locations(id uuid PRIMARY KEY,status text);
  CREATE TABLE IF NOT EXISTS salon_settings(salon_id uuid PRIMARY KEY,public_discovery_enabled boolean);
  CREATE TABLE IF NOT EXISTS services(id uuid PRIMARY KEY,salon_id uuid,category text,is_active boolean,online_booking_enabled boolean);
  CREATE INDEX IF NOT EXISTS home_services_salon_idx ON services(salon_id);
  CREATE OR REPLACE FUNCTION public.get_explore_activity_region() RETURNS jsonb LANGUAGE sql STABLE AS $$
   SELECT coalesce(nullif(current_setting('test.activity',true),'')::jsonb,'{"source":"none"}'::jsonb) $$;
  CREATE OR REPLACE FUNCTION public.explore_preferred_categories() RETURNS text[] LANGUAGE sql STABLE AS $$
   SELECT coalesce((SELECT categories FROM explore_user_preferences WHERE user_id=current_public_user_id()),'{}'::text[]) $$;`);
 for(const [viewer,location] of users)await pool.query(`INSERT INTO explore_user_preferences VALUES($1,$2,ARRAY['Nails'])
  ON CONFLICT(user_id) DO UPDATE SET location_label=excluded.location_label,categories=excluded.categories`,[viewer,location]);
 const setupStart=performance.now();
 if(options.reuse!=='true')await pool.query(`INSERT INTO locations SELECT salon_id,'active' FROM explore_salon_documents ON CONFLICT DO NOTHING;
  INSERT INTO salon_settings SELECT salon_id,true FROM explore_salon_documents ON CONFLICT DO NOTHING;
  INSERT INTO services SELECT md5('home-service:'||salon_id)::uuid,salon_id,service_categories[1],true,true FROM explore_salon_documents ON CONFLICT DO NOTHING;
  ANALYZE locations; ANALYZE salon_settings; ANALYZE services;`);
 const loaded=await scalar("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='explore_popular_service_cache' AND table_schema='public') loaded");
 if(!loaded.loaded)await pool.query(sql);
 const refreshStart=performance.now();await pool.query('SELECT refresh_explore_popular_service_cache()');
 report.backgroundCacheRefreshMs=rounded(performance.now()-refreshStart);
 report.fixture=await scalar('SELECT (SELECT count(*) FROM explore_salon_documents)::int salons,(SELECT count(*) FROM services)::int services,(SELECT count(*) FROM explore_popular_service_cache)::int categories');
 report.backgroundSetupMs=rounded(performance.now()-setupStart);persist();
 for(const concurrency of [1,8,16]){
  let next=0;const events=[],begin=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{const client=await pool.connect();try{
   await client.query("SET statement_timeout='3s'");
   while(next<140){const item=cases[next++%cases.length];await client.query("SELECT set_config('test.viewer',$1,false),set_config('test.activity',$2,false)",[item.viewer??'',item.activity?JSON.stringify(item.activity):'']);
    const timer=performance.now();try{const result=await client.query(item.popular?'SELECT * FROM get_public_explore_popular_services(8)':'SELECT * FROM get_public_explore_home_salons(6,6)');
     const isZip=item.name==='Saved 53202';
     const expected=item.name==='Weak activity keeps saved CA'?'CA':item.viewer&&!isZip?'WI':null;
     const regionViolations=isZip?result.rows.filter(row=>row.postal_code!=='53202').length:expected?result.rows.filter(row=>row.state!==expected).length:0;
     events.push({case:item.name,ms:performance.now()-timer,rows:result.rowCount,regionViolations});
    }catch(error){events.push({case:item.name,ms:performance.now()-timer,error:error.message,errorCode:error.code});}}
  }finally{try{await client.query("RESET statement_timeout;SELECT set_config('test.viewer','',false),set_config('test.activity','',false)");}finally{client.release();}}}));
  const group={concurrency,requests:events.length,durationMs:rounded(performance.now()-begin),p50Ms:rounded(p(events.map(e=>e.ms),.5)),p95Ms:rounded(p(events.map(e=>e.ms),.95)),
   errors:events.filter(e=>e.errorCode).length,timeouts:events.filter(e=>e.errorCode==='57014').length,regionViolations:events.reduce((sum,e)=>sum+(e.regionViolations??0),0),
   cases:cases.map(item=>{const e=events.filter(e=>e.case===item.name);return{name:item.name,p50Ms:rounded(p(e.map(v=>v.ms),.5)),p95Ms:rounded(p(e.map(v=>v.ms),.95))};}),events};
  report.groups.push(group);persist();console.log(JSON.stringify({concurrency,p50Ms:group.p50Ms,p95Ms:group.p95Ms,errors:group.errors,timeouts:group.timeouts,regionViolations:group.regionViolations}));
 }
 for(const [name,query] of [['recommended-state-seek',"SELECT salon_id FROM explore_salon_documents WHERE state_code='WI' AND salon_id>='80000000-0000-4000-8000-000000000000' ORDER BY salon_id LIMIT 256"],
  ['newest-state',"SELECT salon_id FROM explore_salon_documents WHERE state_code='WI' ORDER BY created_at DESC,salon_id LIMIT 20"],
  ['cached-popular','SELECT * FROM get_public_explore_popular_services(8)']])report.plans.push({name,query,plan:(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query)).rows[0]['QUERY PLAN'][0]});
 report.completedAt=new Date().toISOString();persist();
}catch(error){report.failure={message:error.message,code:error.code};persist();throw error;}finally{await pool.end();}
