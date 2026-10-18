import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createUnifiedExploreFixture,fixtureId as id,seedSalon,seedPost,searchFixture as search} from './fixtures/explore-unified-search-bootstrap.mjs';
const fresh=async run=>{const f=await createUnifiedExploreFixture({seed:false});try{await run(f.db);}finally{await f.close();}};
const local={location:'Milwaukee, WI',scopePolicy:'expandable',locationPriority:true};
async function profile(db,n,fields={}){
 const allowed=['phone','address_line1','address_line2','description','postal_code'];
 for(const [key,value] of Object.entries(fields)){assert(allowed.includes(key));await db.query(`UPDATE explore_salon_documents SET ${key}=$1 WHERE salon_id=$2`,[value,id(n)]);}
}
const address=async(db,text,state=null,limit=8)=>(await db.query('SELECT get_public_explore_address_area($1,$2,$3) AS result',[text,state,limit])).rows[0].result;
async function publishRanks(db,scores={},bookable={}){
 const jobs=(await db.query('SELECT * FROM claim_explore_search_rank_jobs(100)')).rows;
 const rows=jobs.map(j=>({...j,rule_version:'lumi-trust-v2',evidence_as_of:new Date().toISOString(),trust_score:scores[j.salon_id]??0.3,bookable:Boolean(bookable[j.salon_id]),bookable_service_id:bookable[j.salon_id]??null,empty_evidence:true}));
 await db.query('SELECT publish_explore_search_rank_jobs($1::jsonb)',[JSON.stringify(rows)]);
}

test('address priority: city includes unmapped and wrong-pin local salons before every remote name/photo',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Ordinary Nails',city:'Milwaukee',latitude:null,longitude:null});
 await seedSalon(db,2,{name:'King Nails',city:'Elk Grove',state:'CA',latitude:43.04,longitude:-87.9});
 await seedSalon(db,3,{name:'Milwaukee Nails',city:'Milwaukee',latitude:21.3,longitude:-157.8});
 await seedPost(db,101,2,{title:'King Nails',media:true});
 const input={...local,query:'king nails',queryKind:'name',latitude:43.04,longitude:-87.9,limit:20,locationPriority:false};
 const r=await search(db,input);
 assert.equal(r.canonical.locationPriority,true,'selected stored area establishes priority even for direct API callers');
 assert.deepEqual(r.rows.map(x=>x.salon_id),[id(3),id(1),id(2)],'all local category references precede remote exact-name real media');
 assert(r.rows.slice(0,2).every(x=>x.search_scope==='A'&&x.result_group==='reference'));
 assert.equal(r.rows[2].recommendation_reason,'matching_in_other_areas');assert.equal(r.rows[2].is_primary_match,false);
 const browse=await search(db,{...local,query:'',queryKind:'service',latitude:43.04,longitude:-87.9});
 assert.deepEqual(new Set(browse.rows.filter(x=>x.is_primary_match).map(x=>x.salon_id)),new Set([id(1),id(3)]));
 assert.equal(browse.rows.find(x=>x.salon_id===id(1)).distance_miles,null);
 const zip=await search(db,{...local,location:'53218',query:'',queryKind:'service'});assert.equal(zip.primaryCount,0);
 await profile(db,1,{postal_code:'53218'});
 const zipped=await search(db,{...local,location:'53218',query:'',queryKind:'service',latitude:21.3,longitude:-157.8});assert.deepEqual(zipped.rows.filter(x=>x.is_primary_match).map(x=>x.salon_id),[id(1)]);
}));

test('address priority: names, title and body matches remain distinct; local order uses relevance before distance',{timeout:120000},()=>fresh(async db=>{
 for(const n of [1,2,3,4])await seedSalon(db,n,{name:n===1?'Copper Chrome':'Studio '+n,city:'Milwaukee',latitude:43+n/100,longitude:-87.9});
 await seedPost(db,101,2,{title:'Copper Chrome',caption:'Seasonal collection'});
 await seedPost(db,102,3,{title:'Seasonal collection',caption:'Copper Chrome'});
 await seedPost(db,103,4,{type:'update',title:'Collection',caption:'Other words',summary:'Copper Chrome'});
 const r=await search(db,{...local,query:'copper chrome',contentQuery:'copper chrome',queryKind:'name',latitude:43.04,longitude:-87.9});
 assert.deepEqual(r.rows.slice(0,2).map(x=>x.salon_id),[id(1),id(2)]);
 assert(r.rows.findIndex(x=>x.salon_id===id(3))>1,'caption match follows exact name and title');
 assert.equal(r.rows[0].match_source,'salon_name');assert.equal(r.rows[1].match_source,'salon_post');
 assert(r.rows.some(x=>x.salon_id===id(4)&&x.is_primary_match),'summary still searches alongside nonempty caption');
 const facet=await search(db,{...local,query:'copper chrome',queryKind:'style',filters:{shape:'almond'}});
 assert.equal(facet.primaryCount,0,'name or generated image cannot prove a real content facet');
}));

test('address priority: equally relevant real salon photos precede generated images without overriding explicit sorts',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Photo Studio',city:'Milwaukee',latitude:43.08,longitude:-87.9,quality:10,created:'2026-01-01T00:00:00Z'});
 await seedPost(db,101,1,{title:'Our manicure',media:true});
 await seedSalon(db,2,{name:'New Studio',city:'Milwaukee',latitude:43.04,longitude:-87.9,quality:90,created:'2026-02-01T00:00:00Z'});
 const input={...local,query:'',queryKind:'service',latitude:43.04,longitude:-87.9};
 const relevance=await search(db,input);
 assert.deepEqual(relevance.rows.map(x=>x.salon_id),[id(1),id(2)],'real photo wins an equal-relevance tie despite lower completeness and greater distance');
 assert.equal(relevance.rows[0].image_provenance,'salon_post');assert.equal(relevance.rows[1].image_provenance,'suggested');
 const closest=await search(db,{...input,sort:'closest'});assert.equal(closest.appliedSort,'closest');assert.equal(closest.rows[0].salon_id,id(2));
 const newest=await search(db,{...input,sort:'newest'});assert.equal(newest.appliedSort,'newest');assert.equal(newest.rows[0].salon_id,id(2));
 await publishRanks(db,{[id(1)]:0.1,[id(2)]:0.9});
 const trusted=await search(db,{...input,sort:'trusted'});assert.equal(trusted.appliedSort,'trusted');assert.equal(trusted.rows[0].salon_id,id(2));
 const named=await search(db,{...input,query:'new studio',queryKind:'name'});assert.equal(named.rows[0].salon_id,id(2),'stronger name relevance still precedes real media');
}));

test('address priority: business description, phone, street and combined legacy fields survive and revalidate',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Quiet Studio',city:'Milwaukee'});
 await profile(db,1,{description:'Wheelchair accessible sanctuary',phone:'(414) 555-0123',address_line1:'8333 W Appleton Ave',postal_code:'53218'});
 for(const query of ['wheelchair accessible','4145550123','414 555 0123','8333 appleton','quiet sanctuary']){
  const r=await search(db,{...local,query,queryKind:'name',category:''});
  assert.equal(r.rows[0]?.salon_id,id(1),query);assert.equal(r.rows[0]?.match_type,'profile',query);
 }
 const input={...local,query:'wheelchair accessible',queryKind:'name',category:''};const first=await search(db,input);
 await profile(db,1,{description:'Changed public description'});
 assert.deepEqual((await search(db,{...input,locationPriority:first.canonical.locationPriority,cursor:first.sessionCursor,hydrateIds:[id(1)]})).rows,[],'old match cannot survive removed live evidence');
}));

test('address priority: stored address resolution is public, bounded, exact-house and ambiguity safe',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{city:'Milwaukee',latitude:null,longitude:null});await profile(db,1,{address_line1:'8333 West Appleton Avenue',postal_code:'53218'});
 await seedSalon(db,2,{city:'Milwaukee'});await profile(db,2,{address_line1:'8334 W Appleton Ave',postal_code:'53218'});
 await seedSalon(db,3,{city:'Madison'});await profile(db,3,{address_line1:'8333 W Appleton Ave',postal_code:'53703'});
 assert.equal((await address(db,'8333 W Appleton Ave Milwaukee WI 53218')).areaCandidates[0].label,'Milwaukee, WI');
 assert.equal((await address(db,'8333 West Appleton Avenue Milwaukee Wisconsin 53218')).areaCandidates[0].label,'Milwaukee, WI');
 assert.equal((await address(db,'8333 West Appleton Avenue')).areaCandidates.length,2);
 assert.equal((await address(db,'8333 West Appleton Avenue','WI')).areaCandidates.length,2,'preferred state is not proof for ambiguous addresses');
 assert.equal((await address(db,'8333 West Appleton Avenue',null,1)).moreAreaCandidates,true);
 assert.equal((await address(db,'9999 West Appleton Avenue')).areaCandidates.length,0);
 assert.equal((await address(db,'4145550123')).areaCandidates.length,0);
 await seedSalon(db,4,{city:'Sussex'});await profile(db,4,{address_line1:'N64W23180 Main Street',address_line2:'Suite 110',postal_code:'53089'});
 assert.equal((await address(db,'N64W23180 Main St #110 Sussex Wisconsin 53089')).areaCandidates[0].label,'Sussex, WI');
 const grid=await search(db,{query:'',location:'N64W23180 Main St #110 Sussex Wisconsin 53089'});assert.equal(grid.rows[0].salon_id,id(4));assert.equal(grid.rows[0].is_primary_match,true);
 const r=await search(db,{query:'',queryKind:'service',category:'Nails',location:'8333 W Appleton Ave Milwaukee WI 53218',scopePolicy:'fixed',latitude:21.3,longitude:-157.8});
 assert.equal(r.rows[0].salon_id,id(1));assert.equal(r.rows[0].is_primary_match,true);assert.equal(r.rows[1].salon_id,id(2));assert.equal(r.rows[1].recommendation_reason,'related_in_broader_area');
 assert.equal(r.rows[1].recommendation_area_label,'Milwaukee, WI');
 await assert.rejects(search(db,{query:'',location:'8333 W Appleton Ave'}),e=>e.code==='22023');
 await db.query('UPDATE salon_settings SET public_discovery_enabled=false WHERE salon_id=$1',[id(3)]);
 assert.equal((await address(db,'8333 W Appleton Ave')).areaCandidates.length,1);
 await db.query('UPDATE salon_settings SET public_discovery_enabled=false WHERE salon_id=$1',[id(1)]);
 assert.equal((await address(db,'8333 W Appleton Ave')).areaCandidates.length,0);
 await assert.rejects(address(db,'1 '.repeat(90)),e=>e.code==='22023');
 const grants=(await db.query("SELECT has_function_privilege('anon','get_public_explore_address_area(text,text,integer)','execute') allowed,has_function_privilege('anon','explore_unified_profile_match(text,text,text)','execute') helper")).rows[0];assert.equal(grants.allowed,true);assert.equal(grants.helper,false);
}));

test('address priority: stable continuation, local generated references precede remote real, privacy and filters persist',{timeout:120000},()=>fresh(async db=>{
 for(let n=1;n<=68;n++)await seedSalon(db,n,{name:n===68?'Needle Nails':'Studio '+n,city:n===68?'Honolulu':'Milwaukee',state:n===68?'HI':'WI',latitude:null,longitude:null});
 await seedPost(db,101,68,{title:'Needle Nails',media:true});
 const input={...local,query:'needle nails',queryKind:'name',limit:12};const first=await search(db,input);let current=first;const rows=[...first.rows];
 while(current.hasMore){current=await search(db,{...input,cursor:current.nextCursor});rows.push(...current.rows);}
 assert.equal(rows.length,68);assert.equal(new Set(rows.map(x=>x.salon_id)).size,68);assert(rows.slice(0,67).every(x=>x.city==='Milwaukee'));assert.equal(rows[67].salon_id,id(68));
 await db.query("UPDATE locations SET status='inactive' WHERE id=$1",[first.rows[0].salon_id]);
 const hydrated=await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[first.rows[0].salon_id]});assert.deepEqual(hydrated.rows,[]);
 const budget=await search(db,{...input,filters:{maxPrice:1}});assert.deepEqual(budget.rows,[]);
 await assert.rejects(search(db,{...input,cursor:first.sessionCursor,filters:{maxPrice:40}}),/changed or expired/);
 await assert.rejects(search(db,{...input,cursor:{version:3,session:'------------------------------------',after:0}}),e=>e.code==='22023');
}));

test('address priority: canonical trust/bookable sorts restored only with complete fresh evidence',{timeout:120000},()=>fresh(async db=>{
 for(const n of [1,2])await seedSalon(db,n,{city:'Milwaukee'});
 const warming=await search(db,{...local,query:'',sort:'trusted'});assert.equal(warming.appliedSort,'relevance');assert.equal(warming.sortFallbackReason,'ranking_warming');
 await db.query('INSERT INTO booking_settings VALUES($1,true,true,true)',[id(1)]);
 await db.query("INSERT INTO services(id,salon_id,name,is_active,online_booking_enabled) VALUES($1,$2,'Manicure',true,true)",[id(900),id(1)]);
 await publishRanks(db,{[id(1)]:0.1,[id(2)]:0.9},{[id(1)]:id(900)});
 const trusted=await search(db,{...local,query:'',sort:'trusted'});assert.equal(trusted.appliedSort,'trusted');assert.equal(trusted.rows[0].salon_id,id(2));assert(trusted.supportedSorts.includes('bookable'));
 const bookable=await search(db,{...local,query:'',sort:'bookable'});assert.equal(bookable.appliedSort,'bookable');assert.equal(bookable.rows[0].salon_id,id(1));
 const keyword=await search(db,{...local,query:'fixture',sort:'trusted'});assert.equal(keyword.appliedSort,'relevance');assert.equal(keyword.sortFallbackReason,'keyword_ranking_not_supported');
 await db.exec("UPDATE explore_search_rank_history SET refresh_after=now()-interval '1 minute' WHERE valid_to IS NULL");
 const stale=await search(db,{...local,query:'',sort:'trusted'});assert.equal(stale.appliedSort,'relevance');assert.equal(stale.sortFallbackReason,'ranking_stale');
}));

test('address priority: old v3 session continuation retains its frozen ordering',{timeout:120000},async()=>{
 const f=await createUnifiedExploreFixture({addressPriority:false});try{
  const input={query:'king nails',queryKind:'name',latitude:43.07,longitude:-89.4,limit:1};
  const before=await search(f.db,input);assert.equal(before.rows[0].salon_id,id(1));
  await profile(f.db,2,{description:'Historic accessible retreat',phone:'414-555-7890',address_line1:'200 Legacy Avenue'});
  await f.db.exec(readFileSync('supabase/migrations/20261017020000_explore_address_priority.sql','utf8'));
  await f.db.exec(readFileSync('supabase/migrations/20261017030000_explore_anywhere_search.sql','utf8'));
  await f.db.exec(readFileSync('supabase/migrations/20261017040000_explore_unified_query_performance.sql','utf8'));
  const next=await search(f.db,{...input,cursor:before.nextCursor});assert.equal(next.rows[0].salon_id,id(5));assert.equal(next.canonical.locationPriority,false);
  const backfilled=await search(f.db,{query:'historic accessible',queryKind:'name',category:'',location:'Madison, WI'});assert.equal(backfilled.rows[0].salon_id,id(2));assert.equal(backfilled.rows[0].match_type,'profile');
  assert.equal((await address(f.db,'200 Legacy Ave Madison WI')).areaCandidates[0].label,'Madison, WI');
 }finally{await f.close();}
});
