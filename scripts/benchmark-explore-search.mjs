// Isolated synthetic SQL benchmark. Refuses remote hosts and non-benchmark DBs.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';

const options=Object.fromEntries(process.argv.slice(2).map(arg=>{
 const [key,...value]=arg.replace(/^--/,'').split('=');return [key,value.join('=')];
}));
const runtime=path.resolve(options.runtime??'work/explore-load-runtime');
const reportPath=path.resolve(options.output??'work/explore-load-results/search-scale.json');
const schemaPath=options.schema;
if(!schemaPath)throw new Error('Provide --schema=<isolated v2 search bootstrap SQL file>.');
const migrationPath=options.migration??'supabase/migrations/20261009052031_explore_search_sessions.sql';
const migrationText=readFileSync(migrationPath,'utf8');
const migrationSha=createHash('sha256').update(migrationText).digest('hex');
const corrections=(options.corrections??'').split(',').filter(Boolean).map(file=>{
 const sql=readFileSync(file,'utf8');return{file,sql,sha256:createHash('sha256').update(sql).digest('hex')};
});
const databaseUrl=options['database-url']??process.env.EXPLORE_BENCHMARK_DATABASE_URL;
if(!databaseUrl)throw new Error('Set EXPLORE_BENCHMARK_DATABASE_URL to a dedicated localhost explore_load database.');
const endpoint=new URL(databaseUrl);
if(!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||!/^\/explore_load(?:_[a-z0-9_]+)?$/i.test(endpoint.pathname)){
 throw new Error('Benchmark only accepts localhost and a dedicated explore_load database.');
}
const scales=(options.scales??'100000,500000,1000000').split(',').map(Number);
const concurrencyLevels=(options.concurrency??'1,8,16').split(',').map(Number);
const samples=Number(options.samples??28);
const pages=Number(options.pages??3);
const coordinateRatio=options['coordinate-ratio']===undefined?null:Number(options['coordinate-ratio']);
if(coordinateRatio!==null&&(!Number.isFinite(coordinateRatio)||coordinateRatio<0||coordinateRatio>1))throw new Error('Coordinate ratio must be between zero and one.');
if(coordinateRatio!==null&&options.reuse==='true')throw new Error('Changing coordinate distribution requires seeding a new dataset.');
if(scales.some(n=>!Number.isInteger(n)||n<1||n>1000000)||concurrencyLevels.some(n=>!Number.isInteger(n)||n<1||n>32)||!Number.isInteger(samples)||samples<1||samples>10000||!Number.isInteger(pages)||pages<1||pages>100)throw new Error('Invalid benchmark scale, concurrency, pages or sample count.');
const requireRuntime=createRequire(path.join(runtime,'package.json'));
const {Pool}=requireRuntime('pg');
const pool=new Pool({connectionString:databaseUrl,max:Math.max(...concurrencyLevels),application_name:'kingpos_explore_isolated_benchmark'});
const scalar=async(sql,params=[])=> (await pool.query(sql,params)).rows[0];
const percentile=(xs,p)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)]:null;
const round=n=>n===null?null:Math.round(n*100)/100;
const states=['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const cases=[
 {name:'Nail place national',query:'Nail place'},
 {name:'King Nails outside manual area',query:'King Nails',location:'Milwaukee, WI',scope:'expandable'},
 {name:'nail broad national',query:'nail'},
 {name:'Nails state',category:'Nails',location:'WI'},
 {name:'nail city',query:'nail',location:'Milwaukee, WI',scope:'expandable'},
 {name:'Nails GPS',category:'Nails',latitude:43.0389,longitude:-87.9065,scope:'expandable'},
 {name:'Guest browse',intent:'discover'},
];
if(options.workload==='extended')cases.push(
 {name:'GPS closest',category:'Nails',latitude:43.0389,longitude:-87.9065,scope:'expandable',sort:'closest'},
 {name:'GPS all nearby relevance',latitude:43.0389,longitude:-87.9065,scope:'expandable'},
 {name:'GPS all nearby closest',latitude:43.0389,longitude:-87.9065,scope:'expandable',sort:'closest'},
 {name:'New salons state',category:'Nails',location:'WI',sort:'newest'},
 {name:'Bookable state',category:'Nails',location:'WI',sort:'bookable'},
 {name:'Short prefix',query:'na',location:'WI'},
 {name:'No results',query:'zzzzunknownsalon'},
 {name:'GPS missing word',query:'zzzzunknownsalon',latitude:43.0389,longitude:-87.9065},
 {name:'GPS missing category',category:'Lashes',latitude:43.0389,longitude:-87.9065},
 {name:'GPS rare word',query:'studio 123',latitude:43.0389,longitude:-87.9065},
 {name:'GPS fuzzy fallback',query:'studio 1999',latitude:43.0389,longitude:-87.9065},
);
if(options.workload==='geo-probe')cases.splice(0,cases.length,
 {name:'GPS common category',category:'Nails',latitude:43.0389,longitude:-87.9065},
 {name:'GPS common word',query:'nail',latitude:43.0389,longitude:-87.9065},
 {name:'GPS missing word',query:'zzzzunknownsalon',latitude:43.0389,longitude:-87.9065},
 {name:'GPS missing category',category:'Lashes',latitude:43.0389,longitude:-87.9065},
 {name:'GPS rare word',query:'studio 123',latitude:43.0389,longitude:-87.9065});
if(options.workload==='deep')cases.splice(0,cases.length,
 {name:'Nails state deep',category:'Nails',location:'WI'},
 {name:'Nails GPS deep',category:'Nails',latitude:43.0389,longitude:-87.9065});
const rpcSql=`SELECT public.search_public_explore_session(p_query=>$1,p_category=>$2,p_location=>$3,
 p_latitude=>$4,p_longitude=>$5,p_sort=>$9,p_limit=>12,p_cursor=>$6::jsonb,
 p_scope_policy=>$7,p_intent=>$8) AS page`;
const report={startedAt:new Date().toISOString(),mode:'native-postgresql-localhost',
 migrationFile:migrationPath,requestedMigrationSha256:migrationSha,
 corrections:corrections.map(({file,sha256})=>({file,sha256})),
 limitations:['Synthetic salons and projected search data; no production traffic or million-post social workload.',
  'Times cover SQL RPC calls over localhost, not browser rendering, network delivery or profile enrichment.',
  'First measured requests are after setup/analyze and can warm buffers; no OS cache eviction or claim of fully cold disk.',
  'pg_stat_statements rows are returned rows, not a count of all scanned rows. Candidate plan node visits are separate.'],
 environment:{platform:os.platform(),release:os.release(),arch:os.arch(),logicalCpus:os.cpus().length,
  cpuModel:os.cpus()[0]?.model,totalMemoryBytes:os.totalmem(),freeMemoryBytes:os.freemem()},runs:[]};
mkdirSync(path.dirname(reportPath),{recursive:true});
const persist=()=>writeFileSync(reportPath,JSON.stringify(report,null,2));

try{
 const existing=await scalar(`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public'
  AND table_name='explore_benchmark_environment') AS owned,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tables`);
 if(!existing.owned&&Number(existing.tables)>0)throw new Error('Database contains existing objects without a benchmark ownership marker.');
 if(!existing.owned){
  const bootstrap=readFileSync(schemaPath,'utf8').replace(/CREATE ROLE (anon|authenticated|service_role);/g,
   (_,role)=>`DO $role$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $role$;`);
  await pool.query(bootstrap);
  await pool.query(migrationText);
  await pool.query(`CREATE TABLE public.explore_benchmark_environment(marker text PRIMARY KEY,migration_sha text);`);
  await pool.query(`INSERT INTO public.explore_benchmark_environment VALUES('isolated synthetic explore load test',$1)`,[migrationSha]);
 }
 const loaded=await scalar('SELECT migration_sha FROM public.explore_benchmark_environment LIMIT 1');
 report.databaseMigrationSha256=loaded.migration_sha;
 if(loaded.migration_sha!==migrationSha)throw new Error('Database migration differs from requested SQL; use a fresh dedicated database.');
 for(const correction of corrections)await pool.query(correction.sql);
 await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
 report.environment.database=await scalar(`SELECT version() AS version,current_setting('shared_buffers') AS shared_buffers,
  current_setting('work_mem') AS work_mem,current_setting('max_connections') AS max_connections,
  current_setting('jit') AS jit,current_setting('pg_stat_statements.track') AS statement_tracking`);
 for(const scale of scales){
  console.log(`Preparing ${scale.toLocaleString()} projected salons`);
  const started=performance.now();
  if(options.reuse!=='true'){
  const rebuildIndexes=options['seed-mode']!=='incremental'
   ?(await pool.query(`SELECT i.relname AS name,pg_get_indexdef(i.oid) AS definition FROM pg_class i
    JOIN pg_index x ON x.indexrelid=i.oid WHERE x.indrelid='public.explore_salon_documents'::regclass AND NOT x.indisprimary`)).rows:[];
  for(const index of rebuildIndexes)await pool.query('DROP INDEX public."'+index.name.replaceAll('"','""')+'"');
  await pool.query(`TRUNCATE public.explore_search_session_candidates,public.explore_search_sessions,
   public.explore_salon_documents,public.booking_settings CASCADE`);
  await pool.query(`WITH seed AS (
   SELECT n,md5(n::text)::uuid AS id,
    CASE WHEN n%10<3 THEN 'CA' WHEN n%10=3 THEN 'WI' WHEN n%10=4 THEN 'FL'
      ELSE ($2::text[])[n%51+1] END AS state_code FROM generate_series(1,$1::integer) n
  ), named AS (
   SELECT *,CASE WHEN n%2003=0 THEN 'Nail place' WHEN n%1999=0 THEN 'King Nails'
    WHEN n%5<3 THEN 'Nail Studio '||n ELSE 'Hair and Spa '||n END AS name,
    CASE WHEN state_code='WI' AND n%3<>0 THEN 'Milwaukee' ELSE 'Region '||(n%7) END AS city
   FROM seed
  ) INSERT INTO public.explore_salon_documents(salon_id,salon_name,phone,address_line1,city,state,postal_code,country,
   latitude,longitude,description,public_discovery_published_at,profile_completeness,active_service_count,
   service_categories,service_names,created_at,updated_at,cover_image_path,latest_media_created_at,
   featured_service_category,featured_service_name,has_public_profile,starting_price,
   salon_name_search,description_search,search_document,location_search_text,service_search_text,
   service_category_search_text,state_code,city_search)
   SELECT id,name,'5550000000',n||' Main Street',city,state_code,
    CASE WHEN state_code='WI' THEN '53202' ELSE lpad((10000+n%89999)::text,5,'0') END,'US',
    CASE WHEN CASE WHEN $3::float8 IS NULL THEN n%13=0 ELSE (n%997)::float8/997 >= $3::float8 END THEN NULL WHEN state_code='WI' THEN 43.0389+(n%31-15)*.006 ELSE 30+n%15 END,
    CASE WHEN CASE WHEN $3::float8 IS NULL THEN n%13=0 ELSE (n%997)::float8/997 >= $3::float8 END THEN NULL WHEN state_code='WI' THEN -87.9065+(n%37-18)*.006 ELSE -120+n%45 END,
    'Beauty services',now()-make_interval(days=>n%120),(n%5)*20,3,
    CASE WHEN n%5<3 THEN ARRAY['Nails','Manicure'] ELSE ARRAY['Hair','Spa'] END,
    CASE WHEN n%5<3 THEN ARRAY['Full set','Manicure'] ELSE ARRAY['Haircut','Massage'] END,
    now()-make_interval(days=>n%300),now(),NULL,NULL,
    CASE WHEN n%5<3 THEN 'Nails' ELSE 'Hair' END,
    CASE WHEN n%5<3 THEN 'Manicure' ELSE 'Haircut' END,true,25+n%75,
    public.normalize_search_text(name),'beauty services',
    public.normalize_search_text(name||' beauty services '||CASE WHEN n%5<3 THEN 'nails manicure full set' ELSE 'hair spa haircut massage' END),
    public.normalize_search_text(city||' '||state_code||' '||n||' Main Street'),
    CASE WHEN n%5<3 THEN 'nails manicure full set' ELSE 'hair spa haircut massage' END,
    CASE WHEN n%5<3 THEN 'nails manicure' ELSE 'hair spa' END,state_code,public.normalize_search_text(city)
   FROM named`,[scale,states,coordinateRatio]);
  for(const index of rebuildIndexes)await pool.query(index.definition);
  await pool.query(`INSERT INTO public.booking_settings(salon_id,booking_enabled)
   SELECT salon_id,true FROM public.explore_salon_documents WHERE starting_price::integer%3=0;`);
  }else{
   const existingScale=await scalar('SELECT count(*)::integer AS total FROM public.explore_salon_documents');
   if(existingScale.total!==scale)throw new Error('Reused projected dataset differs from requested scale.');
  }
  await pool.query(`UPDATE public.booking_settings SET online_booking_visible=booking_enabled AND hashtext(salon_id::text)%5<>0,
   guest_booking_enabled=hashtext(salon_id::text)%7<>0;
   ANALYZE public.explore_salon_documents; ANALYZE public.booking_settings;`);
  const scaleRun={salons:scale,reused:options.reuse==='true',setupMs:round(performance.now()-started),groups:[],candidatePlans:[]};
  scaleRun.coordinates=await scalar(`SELECT count(*)::integer AS documents,
   count(*) FILTER(WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::integer AS known
   FROM public.explore_salon_documents`);
  report.runs.push(scaleRun);persist();
  for(const concurrency of concurrencyLevels){
   await pool.query('TRUNCATE public.explore_search_session_candidates,public.explore_search_sessions');
   await pool.query('SELECT pg_stat_statements_reset()');
   let next=0;const events=[];const groupStart=performance.now();
   await Promise.all(Array.from({length:concurrency},async()=>{
    const client=await pool.connect();
    try{
     await client.query("SET statement_timeout='3s'");
     while(next<samples){
      const sample=next++;const item=cases[sample%cases.length];let cursor=null;
      const seen=new Set();
      for(let page=0;page<pages;page++){
       const timer=performance.now();
       try{
        const result=await client.query(rpcSql,[item.query??null,item.category??null,item.location??null,
         item.latitude??null,item.longitude??null,cursor?JSON.stringify(cursor):null,item.scope??'fixed',item.intent??'search',item.sort??options.sort??'relevance']);
        const body=result.rows[0].page;let duplicates=0;
        for(const row of body.rows??[]){if(seen.has(row.salon_id))duplicates++;seen.add(row.salon_id);}
        const scopes={};for(const row of body.rows??[])scopes[row.search_scope??'unknown']=(scopes[row.search_scope??'unknown']??0)+1;
        events.push({case:item.name,page,ms:performance.now()-timer,rows:body.rows?.length??0,duplicates,scopeCounts:scopes,
         knownDistanceRows:(body.rows??[]).filter(row=>row.distance_miles!==null&&row.distance_miles!==undefined).length,
         scopeLabels:[...new Set((body.rows??[]).map(row=>row.scope_label).filter(Boolean))]});
        if(!body.hasMore||!body.nextCursor)break;cursor=body.nextCursor;
       }catch(error){events.push({case:item.name,page,ms:performance.now()-timer,errorCode:error.code??'unknown',error:error.message});break;}
      }
     }
    }finally{try{await client.query('RESET statement_timeout');}finally{client.release();}}
   }));
   const elapsed=performance.now()-groupStart;
   const stats=await scalar(`SELECT sum(calls)::bigint AS calls,sum(rows)::bigint AS returned_rows,
    sum(total_exec_time) AS execution_ms,sum(shared_blks_hit)::bigint AS shared_blocks_hit,
    sum(shared_blks_read)::bigint AS shared_blocks_read FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())`);
   const group={concurrency,sessions:samples,requests:events.length,durationMs:round(elapsed),
    p50Ms:round(percentile(events.map(e=>e.ms),.5)),p95Ms:round(percentile(events.map(e=>e.ms),.95)),
    requestsPerSecond:round(events.length/(elapsed/1000)),timeouts:events.filter(e=>e.errorCode==='57014').length,
    errors:events.filter(e=>e.errorCode).length,duplicates:events.reduce((sum,e)=>sum+(e.duplicates??0),0),
    firstPage:{requests:events.filter(e=>e.page===0).length,p50Ms:round(percentile(events.filter(e=>e.page===0).map(e=>e.ms),.5)),
     p95Ms:round(percentile(events.filter(e=>e.page===0).map(e=>e.ms),.95))},
    continuation:{requests:events.filter(e=>e.page>0).length,p50Ms:round(percentile(events.filter(e=>e.page>0).map(e=>e.ms),.5)),
     p95Ms:round(percentile(events.filter(e=>e.page>0).map(e=>e.ms),.95))},
    sqlRpcCalls:events.length,nestedDatabaseStatements:stats,cases:cases.map(item=>{
     const rows=events.filter(e=>e.case===item.name);return{name:item.name,requests:rows.length,
      p50Ms:round(percentile(rows.map(e=>e.ms),.5)),p95Ms:round(percentile(rows.map(e=>e.ms),.95)),
      errors:rows.filter(e=>e.errorCode).length,returnedRows:rows.reduce((sum,e)=>sum+(e.rows??0),0),
      firstPage:{requests:rows.filter(e=>e.page===0).length,p50Ms:round(percentile(rows.filter(e=>e.page===0).map(e=>e.ms),.5)),
       p95Ms:round(percentile(rows.filter(e=>e.page===0).map(e=>e.ms),.95))},
      continuation:{requests:rows.filter(e=>e.page>0).length,p50Ms:round(percentile(rows.filter(e=>e.page>0).map(e=>e.ms),.5)),
       p95Ms:round(percentile(rows.filter(e=>e.page>0).map(e=>e.ms),.95))}};
    }),events:options.events==='true'?events:events.filter(e=>e.errorCode)};
   scaleRun.groups.push(group);persist();
   console.log(JSON.stringify({salons:scale,concurrency,p50Ms:group.p50Ms,p95Ms:group.p95Ms,timeouts:group.timeouts,errors:group.errors,duplicates:group.duplicates}));
  }
  for(const [name,sql] of [
   ['exact-name',"SELECT salon_id FROM public.explore_salon_documents WHERE salon_name_search='king nails' ORDER BY salon_id LIMIT 256"],
   ['city-keyword',"SELECT salon_id FROM public.explore_salon_documents WHERE city_search='milwaukee' AND state_code='WI' AND search_document LIKE '%nail%' ORDER BY salon_id LIMIT 256"],
   ['gps-region-by-id',"SELECT salon_id FROM public.explore_salon_documents WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND extensions.earth_box(extensions.ll_to_earth(43.0389,-87.9065),16093.44) OPERATOR(extensions.@>) extensions.ll_to_earth(latitude,longitude) AND extensions.earth_distance(extensions.ll_to_earth(43.0389,-87.9065),extensions.ll_to_earth(latitude,longitude))<=16093.44 ORDER BY salon_id LIMIT 256"],
   ['gps-knn',"SELECT salon_id FROM public.explore_salon_documents WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND extensions.earth_box(extensions.ll_to_earth(43.0389,-87.9065),16093.44) OPERATOR(extensions.@>) extensions.ll_to_earth(latitude,longitude) AND extensions.earth_distance(extensions.ll_to_earth(43.0389,-87.9065),extensions.ll_to_earth(latitude,longitude))<=16093.44 ORDER BY extensions.ll_to_earth(latitude,longitude) OPERATOR(extensions.<->) extensions.ll_to_earth(43.0389,-87.9065),salon_id LIMIT 256"],
   ['state-quality',"SELECT salon_id FROM public.explore_salon_documents WHERE state_code='WI' AND service_category_search_text LIKE '%nails%' ORDER BY profile_completeness DESC,salon_id LIMIT 256"]]){
   const plan=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql)).rows[0]['QUERY PLAN'][0];
   const nodes=[];const visit=node=>{nodes.push({type:node['Node Type'],index:node['Index Name']??null,
    actualRows:node['Actual Rows'],loops:node['Actual Loops'],rowsRemoved:node['Rows Removed by Filter']??0,
    hitBlocks:node['Shared Hit Blocks']??0,readBlocks:node['Shared Read Blocks']??0});for(const child of node.Plans??[])visit(child);};
   visit(plan.Plan);scaleRun.candidatePlans.push({name,executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],
    planNodeRowVisits:nodes.reduce((sum,n)=>sum+(n.actualRows+n.rowsRemoved)*n.loops,0),nodes});
  }
  persist();
 }
 report.completedAt=new Date().toISOString();persist();
}catch(error){report.failure={message:error.message,code:error.code??null};persist();throw error;}
finally{await pool.end();}
