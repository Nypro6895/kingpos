// Actual private feed RPCs and the production bounded-pool ranker; localhost only.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import ts from 'typescript';
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const [k,...v]=arg.replace(/^--/,'').split('=');return[k,v.join('=')];}));
const url=new URL(options['database-url']??process.env.EXPLORE_BENCHMARK_DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||!/^\/explore_load_feed_[a-z0-9_]+$/i.test(url.pathname))throw new Error('Dedicated localhost explore_load_feed_<suffix> database required.');
const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
const levels=(options.concurrency??'1,8,16').split(',').map(Number),samples=Number(options.samples??80);
const shops=Number(options.salons??100000),posts=Number(options.posts??1000000),coordinateRatio=Number(options['coordinate-ratio']??.05);
if(levels.some(n=>!Number.isInteger(n)||n<1||n>32)||!Number.isInteger(samples)||samples<1||samples>10000||
 !Number.isInteger(shops)||shops<100||shops>1000000||!Number.isInteger(posts)||posts<100||posts>1000000||coordinateRatio<0||coordinateRatio>1)throw new Error('Invalid isolated fixture parameters.');
const pool=new Pool({connectionString:url.href,max:Math.max(...levels),application_name:'explore_social_isolated_benchmark'});
const file=options.migration??'supabase/migrations/20261009080031_explore_social_discovery.sql';
let sql=readFileSync(file,'utf8'),rankingText=readFileSync('lib/explore-social-feed-ranking.ts','utf8');
const sha=value=>createHash('sha256').update(value).digest('hex'),rankExports={};
const output=options.output??'work/explore-load-results/social-scale.json';mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
const report={startedAt:new Date().toISOString(),mode:'native-postgresql-feed-sql-plus-production-ranker',migrationFile:file,migrationSha256:sha(sql),rankerSha256:sha(rankingText),
 environment:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),platform:os.platform()},
 fixture:{salons:shops,posts,coordinateRatio,postMix:'60% salon looks,20% salon updates,20% public beauty posts;regional and national engagement'},
 limitations:['Synthetic public sources and engagements, no production mutations or stress.',
 'Measured lifecycle includes native SQL candidate/page/hydration RPCs plus real bounded TypeScript ranking; excludes reputation/operating-status enrichment, HTTP/browser/media delivery.',
 'Postgres buffers/OS cache are not evicted; local background work and chronological cache warmth can affect results.',
 'Concurrent SQL workers are not a proven count of online users. Source import/backfill costs are setup, not measured request times.'],groups:[]};
const corrections=(options.corrections??'').split(',').filter(Boolean).map(file=>{const text=readFileSync(file,'utf8');return{file,text,sha256:sha(text)};});
report.corrections=corrections.map(({file,sha256})=>({file,sha256}));
const persist=()=>writeFileSync(output,JSON.stringify(report,null,2)),scalar=async(query,args=[])=> (await pool.query(query,args)).rows[0];
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)]??null;
const round=x=>x===null?null:Math.round(x*100)/100;
const summarize=events=>({requests:events.length,p50Ms:round(percentile(events.map(e=>e.ms),.5)),p95Ms:round(percentile(events.map(e=>e.ms),.95))});
const cases=[{name:'National discover',filters:{}},{name:'State discover',filters:{location:'WI'}},
 {name:'City discover',filters:{location:'Milwaukee, WI'}},{name:'GPS discover',filters:{latitude:43.0389,longitude:-87.9065}},
 {name:'State latest',filters:{location:'WI',intent:'latest'}},{name:'GPS latest',filters:{latitude:43.0389,longitude:-87.9065,intent:'latest'}},
 {name:'Nails city price/bookable',filters:{location:'Milwaukee, WI',category:'Nails',maxPrice:70,bookableOnly:true}},
 {name:'GPS strict Nails',filters:{latitude:43.0389,longitude:-87.9065,category:'Nails',strictLocation:true}}];
const actorHex=createHash('md5').update('actor:1').digest('hex'),personalActor=`user:${actorHex.slice(0,8)}-${actorHex.slice(8,12)}-${actorHex.slice(12,16)}-${actorHex.slice(16,20)}-${actorHex.slice(20)}`;
if(options.personalized==='true')cases.push({name:'Personal Nails local',actor:personalActor,filters:{location:'Milwaukee, WI'}},
 {name:'Personal interests global',actor:personalActor,filters:{}});
try{
 const existing=await scalar("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'");
 if(options.reuse==='true'){
  const marker=await scalar('SELECT * FROM explore_social_benchmark_environment LIMIT 1');
  if(marker.migration_sha!==sha(sql)||marker.salons!==shops||marker.posts!==posts||Number(marker.coordinate_ratio)!==coordinateRatio)throw new Error('Reused fixture differs from requested SQL/data.');
 }else{
  if(existing.n&&options.seeded!=='true')throw new Error('Fresh empty dedicated benchmark database required for seeding.');
  const start=performance.now();
  console.log(`Preparing ${shops.toLocaleString()} salons and ${posts.toLocaleString()} public source posts`);
  if(options.seeded==='true'){
   const source=await scalar('SELECT * FROM explore_social_benchmark_source_environment');
   if(!source.seeded||source.salons!==shops||source.posts!==posts||Number(source.coordinate_ratio)!==coordinateRatio)throw new Error('Owned source fixture differs from requested setup.');
   const triggers=(await pool.query("SELECT tgname,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgname LIKE 'explore_z_social_%' AND c.relnamespace='public'::regnamespace")).rows;
   for(const trigger of triggers)await pool.query(`DROP TRIGGER "${trigger.tgname}" ON public."${trigger.relname}"`);
   const functions=(await pool.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE '%explore_social%' OR p.proname='refresh_explore_social_pools')")).rows;
   for(const fn of functions)await pool.query('DROP FUNCTION IF EXISTS '+fn.signature+' CASCADE');
   await pool.query('DROP VIEW IF EXISTS explore_social_content_source CASCADE');
   const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'explore_social_%' AND tablename<>'explore_social_benchmark_source_environment'")).rows;
   for(const table of tables)await pool.query('DROP TABLE IF EXISTS public."'+table.tablename+'" CASCADE');
   for(const block of readFileSync('tests/fixtures/explore-social-bootstrap.sql','utf8').matchAll(/CREATE INDEX (?!IF NOT EXISTS)[\s\S]*?;/g))await pool.query(block[0].replace('CREATE INDEX ','CREATE INDEX IF NOT EXISTS '));
  }else{
  await pool.query(readFileSync('tests/fixtures/explore-social-bootstrap.sql','utf8'));
  await pool.query('CREATE TABLE explore_social_benchmark_source_environment(salons int,posts int,coordinate_ratio numeric,seeded boolean)');
  await pool.query('INSERT INTO explore_social_benchmark_source_environment VALUES($1,$2,$3,false)',[shops,posts,coordinateRatio]);
  const search=readFileSync('supabase/migrations/20261009052031_explore_search_sessions.sql','utf8');
  for(const block of search.matchAll(/CREATE FUNCTION public\.(?:explore_search_state_codes|explore_search_region)\([\s\S]*?\$\$;/g))await pool.query(block[0]);
  await pool.query(readFileSync('supabase/migrations/20261009064031_explore_region_index_predicates.sql','utf8'));
  await pool.query(`INSERT INTO users(id,status,display_name) SELECT md5('actor:'||n)::uuid,'active','Synthetic author '||n FROM generate_series(0,999)n;
   INSERT INTO beauty_profiles(id,user_id,visibility) SELECT md5('profile:'||n)::uuid,md5('actor:'||n)::uuid,'public' FROM generate_series(0,999)n;`);
  await pool.query(`INSERT INTO locations(id,name) SELECT md5(n::text)::uuid,'Synthetic salon '||n FROM generate_series(1,$1::int)n`,[shops]);
  await pool.query(`WITH seed AS(SELECT n,md5(n::text)::uuid id,CASE WHEN n%10<3 THEN 'CA' WHEN n%10=3 THEN 'WI' WHEN n%10=4 THEN 'FL' ELSE 'TX' END state_code FROM generate_series(1,$1::int)n)
   INSERT INTO explore_salon_documents(salon_id,salon_name,city,state,state_code,city_search,postal_code,country,latitude,longitude,service_categories,service_names,service_category_search_text,created_at,public_discovery_published_at,has_public_profile,starting_price,featured_service_name,active_service_count)
   SELECT id,'Synthetic salon '||n,CASE WHEN state_code='WI' THEN 'Milwaukee' ELSE 'Metro' END,state_code,state_code,CASE WHEN state_code='WI' THEN 'milwaukee' ELSE 'metro' END,'53202','US',
    CASE WHEN (n%997)::float8/997<$2 THEN CASE WHEN state_code='WI' THEN 43.0389+(n%31-15)*.006 ELSE 34.05 END END,
    CASE WHEN (n%997)::float8/997<$2 THEN CASE WHEN state_code='WI' THEN -87.9065+(n%37-18)*.006 ELSE -118.25 END END,
    CASE WHEN n%7<4 THEN ARRAY['Nails'] ELSE ARRAY['Hair'] END,ARRAY['Service'],CASE WHEN n%7<4 THEN 'nails' ELSE 'hair' END,
    now()-interval '90 days',now()-interval '90 days',true,25+n%75,'Service',1 FROM seed`,[shops,coordinateRatio]);
  await pool.query(`INSERT INTO services(id,salon_id,name,category,base_price,duration_minutes,is_active,online_booking_enabled)
   SELECT md5('service:'||n)::uuid,md5(n::text)::uuid,'Service',CASE WHEN n%7<4 THEN 'Nails' ELSE 'Hair' END,25+n%75,45,true,true FROM generate_series(1,$1::int)n`,[shops]);
  await pool.query('INSERT INTO booking_settings SELECT salon_id,true,true,true FROM explore_salon_documents');
  console.log('Seeding salon media posts');
  for(const [type,residue] of [['looks','n%5<3'],['updates','n%5=3']])await pool.query(`INSERT INTO salon_profile_${type}(id,salon_id,author_user_id,title,caption,service_id,media_path,status,published_at)
   SELECT md5('post:'||n)::uuid,md5((1+n%$2::int)::text)::uuid,md5('actor:'||n%1000)::uuid,'Synthetic post','Synthetic caption',
    md5('service:'||(1+n%$2::int))::uuid,'synthetic/'||n||'.webp','published',now()-make_interval(secs=>n%604800) FROM generate_series(1,$1::int)n WHERE ${residue}`,[posts,shops]);
  await pool.query(`INSERT INTO beauty_posts(id,profile_id,author_user_id,created_at,caption,post_type,visibility,moderation_status)
   SELECT md5('post:'||n)::uuid,md5('profile:'||n%1000)::uuid,md5('actor:'||n%1000)::uuid,now()-make_interval(secs=>n%604800),'Synthetic beauty post','regular','public','visible' FROM generate_series(1,$1::int)n WHERE n%5=4`,[posts]);
  await pool.query("INSERT INTO beauty_post_media SELECT id,id,'synthetic/'||id||'.webp','beauty-profile-media','image',400,600,0,created_at FROM beauty_posts");
  await pool.query("INSERT INTO beauty_post_attributions SELECT md5('post:'||n)::uuid,md5((1+n%$2::int)::text)::uuid,NULL FROM generate_series(1,$1::int)n WHERE n%5=4",[posts,shops]);
  await pool.query("INSERT INTO beauty_post_verifications SELECT id,'verified' FROM beauty_posts");
  console.log('Seeding engagement fixtures');
  await pool.query("INSERT INTO salon_profile_look_saves SELECT md5('post:'||n)::uuid,md5('actor:'||n%1000)::uuid,now()-interval '1 day' FROM generate_series(1,$1::int)n WHERE n%20 IN(1,2)",[posts]);
  await pool.query("INSERT INTO salon_profile_comments(id,look_id,author_user_id,status,created_at) SELECT md5('comment:'||n)::uuid,md5('post:'||n)::uuid,md5('actor:'||n%1000)::uuid,'published',now()-interval '1 day' FROM generate_series(1,$1::int)n WHERE n%40 IN(1,2)",[posts]);
  await pool.query('UPDATE explore_social_benchmark_source_environment SET seeded=true');
  }
  // Query measurements use exact final indexes, while initial bulk backfill is setup.
  if(options['defer-migration']==='true'){
   sql=readFileSync(file,'utf8');report.migrationSha256=sha(sql);
   for(const block of readFileSync('tests/fixtures/explore-social-bootstrap.sql','utf8').matchAll(/CREATE INDEX (?!IF NOT EXISTS)[\s\S]*?;/g))await pool.query(block[0].replace('CREATE INDEX ','CREATE INDEX IF NOT EXISTS '));
  }
  console.log('Applying feed SQL and backfilling its private read model');
  const deferred=sql.replace('INSERT INTO public.explore_social_content_documents SELECT * FROM public.explore_social_content_source;','-- Backfill deferred in isolated benchmark setup.');
  if(deferred===sql)throw new Error('Expected standalone feed backfill statement was not found.');
  await pool.query(deferred);
  const indexes=(await pool.query("SELECT i.relname name,pg_get_indexdef(i.oid) definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid WHERE x.indrelid='explore_social_content_documents'::regclass AND NOT x.indisprimary AND NOT x.indisunique")).rows;
  for(const index of indexes)await pool.query('DROP INDEX public."'+index.name.replaceAll('"','""')+'"');
  await pool.query('INSERT INTO explore_social_content_documents SELECT * FROM explore_social_content_source');
  for(const index of indexes)await pool.query(index.definition);
  await pool.query('SELECT refresh_explore_social_pools()');
  await pool.query('CREATE TABLE explore_social_benchmark_environment(migration_sha text,salons int,posts int,coordinate_ratio numeric)');
  await pool.query('INSERT INTO explore_social_benchmark_environment VALUES($1,$2,$3,$4)',[sha(sql),shops,posts,coordinateRatio]);
  report.setupMs=round(performance.now()-start);
 }
 rankingText=readFileSync('lib/explore-social-feed-ranking.ts','utf8');report.rankerSha256=sha(rankingText);
 await pool.query('CREATE TABLE IF NOT EXISTS explore_social_benchmark_corrections(file text PRIMARY KEY,sha256 text NOT NULL)');
 for(const correction of corrections){
  const prior=(await pool.query('SELECT sha256 FROM explore_social_benchmark_corrections WHERE file=$1',[correction.file])).rows[0];
  if(prior&&prior.sha256!==correction.sha256)throw new Error('A loaded feed correction differs from the requested file.');
  if(!prior){await pool.query(correction.text);await pool.query('INSERT INTO explore_social_benchmark_corrections VALUES($1,$2)',[correction.file,correction.sha256]);}
 }
 if(options.personalized==='true'){
  await pool.query(`INSERT INTO explore_user_preferences(user_id,categories) VALUES($1,ARRAY['Nails']) ON CONFLICT(user_id) DO UPDATE SET categories=excluded.categories`,[personalActor.slice(5)]);
  await pool.query(`DELETE FROM salon_profile_follows WHERE user_id=$1`,[personalActor.slice(5)]);
  await pool.query(`INSERT INTO salon_profile_follows SELECT $1::uuid,salon_id,now() FROM explore_salon_documents WHERE state_code='WI' ORDER BY salon_id LIMIT 100`,[personalActor.slice(5)]);
 }
 // Execute the controlled, import-free ranker in this Node context so VM cross-
 // realm callback costs are not mistaken for production ranking overhead.
 const rankerModule={exports:rankExports};
 new Function('exports','module',ts.transpileModule(rankingText,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(rankExports,rankerModule);
 await pool.query('ANALYZE; CREATE EXTENSION IF NOT EXISTS pg_stat_statements;');
 report.fixture.actual=await scalar(`SELECT (SELECT count(*) FROM explore_social_content_documents)::int projected_posts,
  (SELECT count(*) FROM explore_social_trending)::int trending_posts,
  (SELECT count(*) FROM explore_social_trending WHERE state_code='WI')::int local_trending_posts,
  (SELECT count(*) FROM salon_profile_look_saves)::int saves,(SELECT count(*) FROM salon_profile_comments)::int comments,
  (SELECT count(*) FROM explore_salon_documents WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int coordinate_salons`);persist();
 if(options['setup-only']!=='true')for(const concurrency of levels){
  await pool.query('TRUNCATE explore_social_feed_sessions; SELECT pg_stat_statements_reset()');
  let next=0;const events=[],start=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{const client=await pool.connect();try{
   await client.query("SET statement_timeout='3s'");
   while(next<samples){const sample=next++,item=cases[sample%cases.length],actor=item.actor??'guest:'+sha(`${concurrency}:${sample}`),filter=JSON.stringify(item.filters);let cursor=null;const seen=new Set();
    for(let pageNumber=0;pageNumber<3;pageNumber++){const timer=performance.now(),stages={};let phase='pool';try{
     const call=async(name,args)=>{phase=name;const t=performance.now();const result=(await client.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,args)).rows[0].value;stages[name]=performance.now()-t;return result;};
     if(!cursor){const candidates=await call('get_explore_social_candidate_pool',[actor,filter]);const rankStart=performance.now();
      const queue=rankExports.buildExploreSocialFeedQueue(candidates,item.filters.intent??'discover');stages.ranking=performance.now()-rankStart;
      const session=await call('create_explore_social_feed_session',[actor,filter,candidates.asOf,JSON.stringify(candidates.region),JSON.stringify(queue)]);cursor={version:1,session:session.id,after:0};}
     const page=await call('get_explore_social_feed_page',[actor,filter,JSON.stringify(cursor),12]);cursor=page.cursor;
     const hydrated=await call('hydrate_explore_social_feed_items',[actor,JSON.stringify(cursor),page.keys.map(row=>row.contentKey)]);
     let duplicates=0;for(const row of page.keys){if(seen.has(row.contentKey))duplicates++;seen.add(row.contentKey);}
     events.push({case:item.name,page:pageNumber,ms:performance.now()-timer,stages,rows:page.keys.length,hydrated:hydrated.length,duplicates,
      personalRows:page.keys.filter(row=>row.lane==='personal').length,
      localRows:page.keys.filter(row=>row.scope==='local').length,widerRows:page.keys.filter(row=>row.scope==='wider').length});
     if(!page.hasMore)break;
    }catch(error){events.push({case:item.name,page:pageNumber,ms:performance.now()-timer,phase,errorCode:error.code??'unknown',error:error.message});break;}}
   }
  }finally{try{await client.query('RESET statement_timeout');}finally{client.release();}}}));
  const group={concurrency,sessions:samples,durationMs:round(performance.now()-start),...summarize(events),firstPage:summarize(events.filter(e=>e.page===0)),continuation:summarize(events.filter(e=>e.page>0)),
   errors:events.filter(e=>e.errorCode).length,timeouts:events.filter(e=>e.errorCode==='57014').length,duplicates:events.reduce((s,e)=>s+(e.duplicates??0),0),
   cases:cases.map(item=>({name:item.name,...summarize(events.filter(e=>e.case===item.name)),firstPage:summarize(events.filter(e=>e.case===item.name&&e.page===0)),continuation:summarize(events.filter(e=>e.case===item.name&&e.page>0)),errors:events.filter(e=>e.case===item.name&&e.errorCode).length})),events};
  group.databaseStatements=await scalar(`SELECT sum(calls)::bigint calls,sum(rows)::bigint returned_rows,sum(shared_blks_hit)::bigint shared_blocks_hit,sum(shared_blks_read)::bigint shared_blocks_read FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())`);
  report.groups.push(group);persist();console.log(JSON.stringify({concurrency,firstPage:group.firstPage,continuation:group.continuation,errors:group.errors,timeouts:group.timeouts,duplicates:group.duplicates}));
 }
 report.completedAt=new Date().toISOString();persist();
}catch(error){report.failure={message:error.message,code:error.code??null};persist();throw error;}finally{await pool.end();}
