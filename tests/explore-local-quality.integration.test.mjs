import assert from 'node:assert/strict';
import test from 'node:test';
import {createUnifiedExploreFixture,fixtureId as id,seedSalon,seedPost,searchFixture as search} from './fixtures/explore-unified-search-bootstrap.mjs';

const fresh=async fn=>{const f=await createUnifiedExploreFixture({seed:false,localQuality:true});try{await fn(f.db);}finally{await f.close();}};
test('local relevance preserves actual service evidence and whole words',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Angel Nails',city:'Milwaukee',quality:100});
 await seedSalon(db,2,{name:'Gel Care',city:'Milwaukee',quality:30});
 await db.query("UPDATE explore_salon_documents SET service_search_text='basic manicure',service_names=ARRAY['Basic manicure'],search_document='angel nails basic manicure' WHERE salon_id=$1",[id(1)]);
 await seedSalon(db,3,{name:'Gelato Nails',city:'Milwaukee',quality:100});
 await db.query("UPDATE explore_salon_documents SET service_search_text='basic manicure',service_names=ARRAY['Basic manicure'],search_document='gelato nails basic manicure' WHERE salon_id=$1",[id(3)]);
 const r=await search(db,{query:'gel',contentQuery:'gel',queryKind:'service',location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true,category:'Nails'});
 assert.equal(r.rankingBasis,'local_quality_indexed_lanes');
 assert.equal(r.rows[0].salon_id,id(2));assert.equal(r.rows[0].match_type,'service');
 assert(!r.rows.some(x=>x.salon_id===id(1)&&x.is_primary_match));
 assert(!r.rows.some(x=>x.salon_id===id(3)&&x.is_primary_match));
 const plural=await search(db,{query:'gel manicures',contentQuery:'gel manicures',queryKind:'service',location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true,category:'Nails'});
 assert.equal(plural.rows[0].salon_id,id(2));assert(plural.rows[0].is_primary_match);
 for(const sort of ['newest','closest'])for(const query of ['gel','gel manicures']){
  const explicit=await search(db,{query,contentQuery:query,queryKind:'service',location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true,category:'Nails',sort,latitude:43.04,longitude:-87.9});
  assert(explicit.rows.some(x=>x.salon_id===id(2)&&x.is_primary_match),sort+' '+query);
  assert(!explicit.rows.some(x=>[id(1),id(3)].includes(x.salon_id)&&x.is_primary_match),sort+' '+query);
 }
}));

test('profile contact and description keywords stay searchable without whole-directory profile scans',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Accessible Studio',city:'Milwaukee'});
 await db.query("UPDATE explore_salon_documents SET description='Wheelchair accessible copper sanctuary',phone='(414) 555-0123',address_line1='8333 W Appleton Ave',postal_code='53222' WHERE salon_id=$1",[id(1)]);
 for(const query of ['wheelchair accessible','4145550123','414 555 0123','5550123','8333 appleton']){
  const r=await search(db,{query,contentQuery:query,queryKind:'name',category:'',location:'Milwaukee, WI',scopePolicy:'fixed'});
  assert.equal(r.rows[0]?.salon_id,id(1),query);assert.equal(r.rows[0].match_type,'profile',query);
 }
 await db.query("UPDATE explore_salon_documents SET phone='+1 (414) 555-0123' WHERE salon_id=$1",[id(1)]);
 for(const query of ['4145550123','5550123'])assert.equal((await search(db,{query,contentQuery:query,queryKind:'name',category:'',location:'Milwaukee, WI',scopePolicy:'fixed'})).rows[0]?.salon_id,id(1));
}));

test('unconstrained city, ZIP and English service inflections use actual scoped evidence',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{city:'Springfield',state:'IL'});await seedSalon(db,2,{city:'Springfield',state:'MA'});
 const input={query:'gel manicures',contentQuery:'gel manicures',queryKind:'service',scopePolicy:'fixed',category:'Nails',locationPriority:true};
 const city=await search(db,{...input,location:'Springfield'});assert.equal(city.primaryCount,2);
 const state=await search(db,{...input,location:'Springfield, IL'});assert.equal(state.primaryCount,1);assert(state.rows.filter(x=>x.is_primary_match).every(x=>x.state==='IL'));
 const zip=await search(db,{...input,location:'53703'});assert.equal(zip.primaryCount,2);
}));

test('same-post proof, block, future and imported references cannot establish primary style matches',{timeout:120000},()=>fresh(async db=>{
 for(let n=1;n<=4;n++)await seedSalon(db,n,{city:'Milwaukee'});
 await seedPost(db,701,1,{title:'Red',caption:'Different post'});await seedPost(db,702,1,{title:'Almond',caption:'Cannot combine posts'});
 const actor=id(999),author=id(998);await db.query('INSERT INTO users(id) VALUES($1),($2)',[actor,author]);await db.query("SELECT set_config('test.viewer',$1,false)",[actor]);
 await seedPost(db,703,2,{title:'Red almond',author});await db.query('INSERT INTO fixture_user_blocks(actor,subject) VALUES($1,$2)',[actor,author]);
 await seedPost(db,704,3,{title:'Red almond',type:'update',reference:true});
 await seedPost(db,705,4,{title:'Red almond',published:'2099-01-01T00:00:00Z'});
 const r=await search(db,{query:'red almond',contentQuery:'red almond',queryKind:'style',location:'Milwaukee, WI',scopePolicy:'fixed',category:'Nails'});
 assert.equal(r.primaryCount,0);assert.equal(r.rows.length,0);
 const serviceOnly=await search(db,{query:'gel manicure',contentQuery:'gel manicure',queryKind:'style',location:'Milwaukee, WI',scopePolicy:'fixed',category:'Nails'});
 assert.equal(serviceOnly.primaryCount,0,'a style request needs a real matching public post, even if a service name matches');assert.equal(serviceOnly.rows.length,0);
}));

test('activity cap excludes references and future posts; many actual posts cannot erase content tiers',{timeout:120000},()=>fresh(async db=>{
 for(let n=1;n<=4;n++)await seedSalon(db,n,{name:'Local Studio '+n,city:'Milwaukee',quality:30});
 for(let n=0;n<7;n++)await seedPost(db,800+n,1,{title:'Actual announcement',type:'update'});
 await seedPost(db,810,2,{title:'Imported intro',type:'update',reference:true});
 await seedPost(db,811,3,{title:'Scheduled work',published:'2099-01-01T00:00:00Z'});
 await seedPost(db,812,4,{title:'Actual news',type:'update'});
 const d=(await db.query('SELECT salon_id,quality,activity_count FROM explore_local_quality_documents WHERE valid_to IS NULL ORDER BY salon_id')).rows;
 assert.equal(d[0].activity_count,5);assert.equal(d[0].quality,40);assert.equal(d[1].activity_count,0);assert.equal(d[2].activity_count,0);assert.equal(d[3].activity_count,1);
 const r=await search(db,{query:'',contentQuery:'',queryKind:'service',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed'});assert.equal(r.rows[0].salon_id,id(1));
}));

test('pre-migration v3 cursors keep their shipped continuation path and private tables stay private',{timeout:120000},async()=>{
 const {readFileSync}=await import('node:fs');const f=await createUnifiedExploreFixture({seed:false});
 try{
  for(let n=1;n<=70;n++)await seedSalon(f.db,n,{city:'Milwaukee'});
  const input={query:'gel manicure',contentQuery:'gel manicure',queryKind:'service',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed',limit:7};
  const first=await search(f.db,input),before=await search(f.db,{...input,cursor:first.nextCursor});
  await f.db.exec(readFileSync('supabase/migrations/20261119042923_explore_local_quality_search.sql','utf8'));
  await f.db.exec(readFileSync('supabase/migrations/20261119052341_explore_local_quality_preparation.sql','utf8'));
  const after=await search(f.db,{...input,cursor:first.nextCursor});assert.deepEqual(after.rows,before.rows);assert.notEqual(after.rankingBasis,'local_quality_indexed_lanes');
  let state;do{state=(await f.db.query('SELECT prepare_explore_local_quality_batch(100) AS state')).rows[0].state;}while(!state.done);
  assert.equal((await f.db.query('SELECT activate_explore_local_quality() AS state')).rows[0].state.ready,true);
  const fresh=await search(f.db,input);assert.equal(fresh.rankingBasis,'local_quality_indexed_lanes');
  const perms=(await f.db.query("SELECT has_table_privilege('anon','explore_local_quality_documents','select') docs,has_table_privilege('authenticated','explore_local_quality_postings','select') postings,has_function_privilege('anon','refresh_explore_local_quality(uuid[])','execute') refresh")).rows[0];assert.deepEqual(perms,{docs:false,postings:false,refresh:false});
  const helpers=(await f.db.query("SELECT proname,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') auth FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'explore_local_%' OR proname IN ('explore_unified_candidate_live','explore_unified_pull_batch','_explore_search_before_local_quality','_explore_search_local_quality','cleanup_explore_search_sessions','refresh_explore_local_quality'))")).rows;assert(helpers.length>=9);assert(helpers.every(x=>!x.anon&&!x.auth));
  const api=(await f.db.query("SELECT has_function_privilege('anon','search_public_explore_session(text,text,text,float8,float8,text,integer,jsonb,text,text,text,text,boolean,jsonb,uuid[])','execute') anon,has_function_privilege('authenticated','search_public_explore_session(text,text,text,float8,float8,text,integer,jsonb,text,text,text,text,boolean,jsonb,uuid[])','execute') auth")).rows[0];assert.deepEqual(api,{anon:true,auth:true});
  const surfaces=(await f.db.query("SELECT relname,relrowsecurity,has_table_privilege('anon',oid,'select') anon,has_table_privilege('authenticated',oid,'select') auth FROM pg_class WHERE oid IN('explore_local_quality_documents'::regclass,'explore_local_quality_postings'::regclass,'explore_local_quality_preparation'::regclass,'explore_local_quality_dirty'::regclass)")).rows;assert.equal(surfaces.length,4);assert(surfaces.every(x=>x.relrowsecurity&&!x.anon&&!x.auth));
  assert.equal((await f.db.query("SELECT has_table_privilege('anon','explore_local_quality_source','select') allowed")).rows[0].allowed,false);
 }finally{await f.close();}
});

test('quality winners beyond UUID256 and activity are frozen, source edits stay live',{timeout:120000},()=>fresh(async db=>{
 for(let n=1;n<=300;n++)await seedSalon(db,n,{name:'Care Studio '+n,city:'Milwaukee',quality:n===300?99:10});
 const input={query:'gel manicure',contentQuery:'gel manicure',queryKind:'service',location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true,category:'Nails',limit:7};
 const first=await search(db,input);assert.equal(first.rows[0].salon_id,id(300));
 await seedPost(db,501,299,{title:'Gel manicure',caption:'Public work',media:true,published:'2026-11-01T00:00:00Z'});
 const newer=await search(db,input);assert(newer.rows.findIndex(x=>x.salon_id===id(299))<newer.rows.findIndex(x=>x.salon_id===id(1)));
 const pages=[...first.rows];let cursor=first.nextCursor;
 while(cursor){const p=await search(db,{...input,cursor});pages.push(...p.rows);cursor=p.nextCursor;assert(pages.length<400);}
 assert.equal(pages.length,300);assert.equal(new Set(pages.map(x=>x.salon_id)).size,300);
 await db.query("UPDATE explore_salon_documents SET service_search_text='basic pedicure' WHERE salon_id=$1",[id(300)]);
 const hydrated=await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(300)]});assert.deepEqual(hydrated.rows,[]);
}));

test('one bulk source statement refreshes each affected salon once per history statement',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{city:'Milwaukee'});
 await db.exec(`CREATE TABLE local_projection_inserts(n integer);CREATE FUNCTION audit_local_projection_insert() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO local_projection_inserts VALUES(1);RETURN NULL;END$$;CREATE TRIGGER audit_local_projection_insert AFTER INSERT ON explore_local_quality_documents FOR EACH ROW EXECUTE FUNCTION audit_local_projection_insert();`);
 await db.query("INSERT INTO salon_profile_updates(id,salon_id,title,caption,status,published_at) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'Actual public update '||n,'Copper chrome','published','2026-11-01' FROM generate_series(900,909) n",[id(1)]);
 assert.equal((await db.query('SELECT count(*)::int n FROM local_projection_inserts')).rows[0].n,1);
 assert.equal((await db.query('SELECT activity_count FROM explore_local_quality_documents WHERE salon_id=$1 AND valid_to IS NULL',[id(1)])).rows[0].activity_count,5);
}));

test('retired-history cleanup neither refreshes current projections nor queues staging work',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{city:'Milwaukee'});await seedPost(db,1701,1,{title:'Original copper'});
 await db.query('UPDATE explore_salon_documents SET profile_completeness=44 WHERE salon_id=$1',[id(1)]);
 await db.query("UPDATE salon_profile_looks SET title='Changed copper' WHERE id=$1",[id(1701)]);
 // Instrument the existing refresh OID, so cached trigger plans are counted.
 await db.exec('CREATE TABLE local_refresh_calls(n integer)');
 const definition=(await db.query("SELECT pg_get_functiondef('refresh_explore_local_quality(uuid[])'::regprocedure) definition")).rows[0].definition;
 const instrumented=definition.replace('BEGIN\n','BEGIN\n INSERT INTO local_refresh_calls VALUES(1);\n');assert.notEqual(instrumented,definition);await db.exec(instrumented);
 assert((await db.query('SELECT count(*)::int n FROM explore_unified_salon_history WHERE valid_to IS NOT NULL')).rows[0].n>0);
 assert((await db.query('SELECT count(*)::int n FROM explore_unified_content_history WHERE valid_to IS NOT NULL')).rows[0].n>0);
 await db.exec('DELETE FROM explore_unified_salon_history WHERE valid_to IS NOT NULL;DELETE FROM explore_unified_content_history WHERE valid_to IS NOT NULL;');
 assert.equal((await db.query('SELECT count(*)::int n FROM local_refresh_calls')).rows[0].n,0);
 await db.query('UPDATE explore_salon_documents SET profile_completeness=55 WHERE salon_id=$1',[id(1)]);
 await db.query("UPDATE salon_profile_looks SET title='Newest copper' WHERE id=$1",[id(1701)]);
 assert((await db.query('SELECT count(*)::int n FROM local_refresh_calls')).rows[0].n>0);
 await db.exec('UPDATE explore_local_quality_preparation SET enabled=false;TRUNCATE explore_local_quality_dirty;TRUNCATE local_refresh_calls;');
 await db.exec('DELETE FROM explore_unified_salon_history WHERE valid_to IS NOT NULL;DELETE FROM explore_unified_content_history WHERE valid_to IS NOT NULL;');
 assert.equal((await db.query('SELECT count(*)::int n FROM explore_local_quality_dirty')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM local_refresh_calls')).rows[0].n,0);
 assert((await db.query('SELECT count(*)::int n FROM explore_local_quality_documents WHERE valid_to IS NULL')).rows[0].n>0);
}));

test('exact names and bounded typo fallback retain intent while explicit sorts use indexed lanes',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'King Nails',city:'Milwaukee',quality:20});await seedSalon(db,2,{name:'King Nails Studio',city:'Milwaukee',quality:100});
 const input={query:'king nails',contentQuery:'king nails',queryKind:'name',location:'Milwaukee, WI',category:'Nails',scopePolicy:'fixed'};
 const exact=await search(db,input);assert.equal(exact.rows[0].salon_id,id(1));assert.equal(exact.rows[0].match_type,'exact_name');
 const typo=await search(db,{...input,query:'kng nails',contentQuery:'kng nails'});assert.equal(typo.rows[0].match_type,'fuzzy_name');
 for(const query of ['z','zz']){const absent=await search(db,{...input,query,contentQuery:query});assert.deepEqual(absent.rows,[]);}
 const newest=await search(db,{...input,query:'',contentQuery:'',queryKind:'service',sort:'newest'});assert.equal(newest.appliedSort,'newest');assert.equal(newest.rankingBasis,'local_quality_indexed_lanes');
 const closest=await search(db,{...input,query:'',contentQuery:'',queryKind:'service',sort:'closest',latitude:43.04,longitude:-87.9});assert.equal(closest.appliedSort,'closest');assert.equal(closest.rankingBasis,'local_quality_indexed_lanes');
}));

test('Closest and newest sort before quality and retain complete stable keyset pages',{timeout:120000},()=>fresh(async db=>{
 for(let n=1;n<=75;n++)await seedSalon(db,n,{name:'Care Studio '+n,city:'Milwaukee',latitude:43.04,longitude:-87.9+n/10000,quality:n===75?100:10,created:n<30?'2026-01-01T00:00:00Z':'2026-11-01T00:00:00Z'});
 await db.query("UPDATE explore_salon_documents SET salon_name='Gel Nails',salon_name_search='gel nails',service_search_text='basic manicure',search_document='gel nails basic manicure' WHERE salon_id=$1",[id(1)]);
 for(const sort of ['closest','newest']){
  const input={query:'gel manicure',contentQuery:'gel manicure',queryKind:'service',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed',sort,latitude:43.04,longitude:-87.9,limit:7};
  const first=await search(db,input);const rows=[...first.rows];let cursor=first.nextCursor;
  while(cursor){const page=await search(db,{...input,cursor});rows.push(...page.rows);cursor=page.nextCursor;assert(rows.length<100);}
  assert.equal(rows.length,75);assert.equal(new Set(rows.map(x=>x.salon_id)).size,75);
  if(sort==='closest'){assert.equal(rows[0].salon_id,id(1));assert.equal(rows[0].match_type,'profile');assert(rows.every((x,n)=>n===0||x.distance_miles>=rows[n-1].distance_miles));}
  else assert(rows.slice(0,46).every(x=>Number(x.salon_id.slice(-12))>=30));
 }
}));

test('hiding a profile or replacing its incarnation cannot resurrect an old local session',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'King Nails',city:'Milwaukee'});
 const input={query:'king nails',contentQuery:'king nails',queryKind:'name',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed'};
 const first=await search(db,input);assert(first.rows[0].is_primary_match);
 await db.query('UPDATE explore_salon_documents SET has_public_profile=false WHERE salon_id=$1',[id(1)]);
 assert.deepEqual((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(1)]})).rows,[]);
 await db.query('UPDATE explore_salon_documents SET has_public_profile=true WHERE salon_id=$1',[id(1)]);
 await db.query('DELETE FROM explore_salon_documents WHERE salon_id=$1',[id(1)]);
 await db.query("INSERT INTO explore_salon_documents(salon_id,salon_name,salon_name_search,service_category_search_text,service_search_text,service_categories,city,city_search,state,state_code,has_public_profile,created_at,public_discovery_published_at,profile_completeness) VALUES($1,'King Nails','king nails','nails','gel manicure',ARRAY['nails'],'Milwaukee','milwaukee','WI','WI',true,'2026-01-01','2026-01-01',100)",[id(1)]);
 assert.deepEqual((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(1)]})).rows,[]);
 assert.equal((await search(db,input)).rows[0].salon_id,id(1));
}));

test('manual area, current pins and same-post visibility remain authoritative',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Local Studio',city:'Milwaukee',latitude:null,longitude:null});
 await seedSalon(db,2,{name:'Far Studio',city:'Honolulu',state:'HI',latitude:21.3,longitude:-157.8,quality:100});
 await seedPost(db,601,1,{title:'Red almond',caption:'Actual public work',media:true});
 await seedPost(db,602,2,{title:'Red almond',caption:'Far public work',media:true});
 const input={query:'red almond',contentQuery:'red almond',queryKind:'style',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true};
 const r=await search(db,input);assert.equal(r.rows[0].salon_id,id(1));assert(r.rows[0].is_primary_match);assert.equal(r.rows[0].distance_miles,null);
 assert(r.rows.filter(x=>x.salon_id===id(2)).every(x=>!x.is_primary_match));
 const gps={...input,location:'',scopePolicy:'expandable',latitude:43.04,longitude:-87.9};
 assert(!(await search(db,gps)).rows.some(x=>x.salon_id===id(1)&&x.is_primary_match));
 await db.query('UPDATE explore_salon_documents SET latitude=43.04,longitude=-87.9 WHERE salon_id=$1',[id(1)]);
 const located=await search(db,gps);assert(located.rows.find(x=>x.salon_id===id(1))?.is_primary_match);assert.equal(located.rows.find(x=>x.salon_id===id(1)).distance_miles,0);
 await db.query('UPDATE salon_profile_looks SET safety_hold=true WHERE id=$1',[id(601)]);
 assert.deepEqual((await search(db,{...input,cursor:r.sessionCursor,hydrateIds:[id(1)]})).rows,[]);
}));

test('geographic cells preserve quality winners across local cells despite higher-quality far salons',{timeout:120000},()=>fresh(async db=>{
 for(let n=1;n<=80;n++)await seedSalon(db,n,{name:'Far Studio '+n,city:'Honolulu',state:'HI',latitude:21.3,longitude:-157.8,quality:100});
 for(let n=200;n<280;n++)await seedSalon(db,n,{name:'Local Studio '+n,city:'Milwaukee',latitude:43.04,longitude:-87.9,quality:10});
 await seedSalon(db,300,{name:'Best Local Studio',city:'Milwaukee',latitude:43.1,longitude:-88.01,quality:95});
 const input={query:'gel manicure',contentQuery:'gel manicure',queryKind:'service',category:'Nails',scopePolicy:'expandable',locationPriority:true,latitude:43.04,longitude:-87.9,limit:12};
 const r=await search(db,input);assert.equal(r.rows[0].salon_id,id(300));assert(r.rows.every(x=>x.is_primary_match&&x.state==='WI'));
 assert.equal(new Set(r.rows.map(x=>x.salon_id)).size,r.rows.length);
}));

test('longitude wrap uses exact spatial fallback without losing nearby points',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{city:'Dateline',latitude:0,longitude:179.99});await seedSalon(db,2,{city:'Dateline',latitude:0,longitude:-179.99});
 const r=await search(db,{query:'gel manicure',contentQuery:'gel manicure',queryKind:'service',category:'Nails',scopePolicy:'expandable',locationPriority:true,latitude:0,longitude:179.995});
 assert.equal(r.primaryCount,2);assert(r.rows.every(x=>x.distance_miles<10));
}));

test('style keeps an exact business-name match after real posts and facets still require actual work',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Red Nails',city:'Milwaukee',quality:100});await seedSalon(db,2,{name:'Local Studio',city:'Milwaukee',quality:10});
 await seedPost(db,1501,2,{title:'Red almond',caption:'Actual public work'});
 const input={query:'red nails',contentQuery:'red',queryKind:'style',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed'};
 const r=await search(db,input);assert.equal(r.rows[0].salon_id,id(2));const exact=r.rows.find(x=>x.salon_id===id(1));assert(exact?.is_primary_match);assert.equal(exact.match_type,'exact_name');assert.equal(exact.match_source,'salon_name');
 const filtered=await search(db,{...input,contentQuery:'red almond',filters:{shape:'almond'}});assert(!filtered.rows.some(x=>x.salon_id===id(1)&&x.is_primary_match));assert.equal(filtered.rows[0].salon_id,id(2));
}));

test('Closest resolves complete finite boundary ties and unknown-coordinate tails without losing quality winners',{timeout:120000},()=>fresh(async db=>{
 for(let n=1;n<=80;n++)await seedSalon(db,n,{name:'Tie Studio '+n,city:'Milwaukee',latitude:43.04,longitude:-87.9,quality:n===80?100:10});
 for(let n=81;n<=100;n++)await seedSalon(db,n,{name:'Unknown Studio '+n,city:'Milwaukee',latitude:null,longitude:null,quality:n===100?100:10});
 const input={query:'gel manicure',contentQuery:'gel manicure',queryKind:'service',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed',sort:'closest',latitude:43.04,longitude:-87.9,limit:7};
 const first=await search(db,input);assert.equal(first.rows[0].salon_id,id(80));let cursor=first.nextCursor;const rows=[...first.rows];
 while(cursor){const page=await search(db,{...input,cursor});rows.push(...page.rows);cursor=page.nextCursor;assert(rows.length<110);}
 assert.equal(rows.length,100);assert.equal(new Set(rows.map(x=>x.salon_id)).size,100);assert(rows.slice(0,80).every(x=>x.distance_miles===0));assert(rows.slice(80).every(x=>x.distance_miles===null));assert.equal(rows[80].salon_id,id(100));
}));

test('Closest raw pages cross an ineligible nearest prefix without truncating a quality winner',{timeout:180000},()=>fresh(async db=>{
 for(let n=1;n<=2100;n++)await seedSalon(db,n,{name:'Expensive Studio '+n,city:'Milwaukee',price:100,latitude:43.04,longitude:-87.9,quality:100});
 for(let n=2101;n<=4200;n++)await seedSalon(db,n,{name:'Boundary Studio '+n,city:'Milwaukee',price:35,latitude:43.04,longitude:-87.89,quality:n===4200?100:10});
 const r=await search(db,{query:'gel manicure',contentQuery:'gel manicure',queryKind:'service',category:'Nails',location:'Milwaukee, WI',scopePolicy:'fixed',sort:'closest',latitude:43.04,longitude:-87.9,limit:12,filters:{maxPrice:50}});
 assert.equal(r.rows[0].salon_id,id(4200));assert(r.rows[0].distance_miles>0);assert(r.rows.every(x=>x.starting_price<=50));assert.equal(r.rankingBasis,'local_quality_indexed_lanes');assert.equal(r.hasMore,true);
}));
