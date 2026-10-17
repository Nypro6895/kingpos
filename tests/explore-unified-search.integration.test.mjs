import assert from 'node:assert/strict';
import test from 'node:test';
import {createUnifiedExploreFixture,fixtureId as id,seedSalon,seedPost,searchFixture as search} from './fixtures/explore-unified-search-bootstrap.mjs';
const fresh=async fn=>{const f=await createUnifiedExploreFixture();try{await fn(f.db);}finally{await f.close();}};

test('unified SQL: global name/content ordering and automatic priority for an available area',{timeout:120000},()=>fresh(async db=>{
 await seedPost(db,201,3,{title:'King Nails',caption:'King Nails match',type:'update'});
 const input={query:'king nails',queryKind:'name',latitude:43.07,longitude:-89.4,limit:20};
 const r=await search(db,{...input,latitude:null,longitude:null});
 assert.deepEqual(r.rows.slice(0,3).map(x=>x.salon_id),[id(1),id(5),id(3)],'far exact name precedes nearby caption match');
 assert.equal(new Set(r.rows.map(x=>x.salon_id)).size,r.rows.length);
 assert.equal(r.rows[0].image_provenance,'salon_post','name search can represent the salon with its own real photo');
 const local=await search(db,{...input,locationPriority:true});
 assert(local.rows.findIndex(x=>x.salon_id===id(3))<local.rows.findIndex(x=>x.salon_id===id(5)),'explicit GPS puts local content ahead of far exact name');
 const fixed=await search(db,{...input,location:'Madison, WI',scopePolicy:'fixed',locationPriority:true,latitude:null,longitude:null});
 assert(!fixed.rows.some(x=>x.salon_id===id(5)&&x.is_primary_match));assert(fixed.rows.every(x=>x.distance_miles===null),'manual city never invents distances');
 assert.equal(fixed.rows.find(x=>x.salon_id===id(5)).recommendation_reason,'matching_in_other_areas');
 const typo=await search(db,{query:'kng nails',queryKind:'name'});
 assert.equal(typo.rows[0].match_type,'fuzzy_name');assert.equal(typo.rows[0].salon_id,id(1));
 assert.equal((await search(db,{query:'totallyunrelatedword',queryKind:'name',category:''})).rows.length,0);
}));

test('unified SQL: canonical booking, budget, newness and strict actual-content filters',{timeout:120000},()=>fresh(async db=>{
 await db.query('INSERT INTO booking_settings(salon_id,booking_enabled,online_booking_visible,guest_booking_enabled) VALUES($1,true,true,true)',[id(1)]);
 await db.query("INSERT INTO services(id,salon_id,name,is_active,online_booking_enabled) VALUES($1,$2,'Manicure',true,true)",[id(801),id(1)]);
 const input={query:'',queryKind:'service',filters:{bookableOnly:true,maxPrice:40}};
 const first=await search(db,input);assert.deepEqual(first.rows.map(x=>x.salon_id),[id(1)]);
 await db.query('UPDATE services SET online_booking_enabled=false WHERE id=$1',[id(801)]);
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(1)]})).rows.length,0);
 assert.equal((await search(db,{query:'',filters:{newOnly:true}})).rows.length,0);
 assert.equal((await search(db,{query:'',filters:{maxPrice:1}})).rows.length,0);
 const sort=await search(db,{sort:'trusted'});assert.equal(sort.appliedSort,'relevance');assert.equal(sort.sortFallbackReason,'ranking_warming');
 const noGps=await search(db,{sort:'closest'});assert.equal(noGps.sortFallbackReason,'location_required');
 const empty=await search(db,{query:'noneexists',queryKind:'name',category:''});assert(empty.sessionCursor);assert.equal(empty.rows.length,0);
 assert.deepEqual((await search(db,{query:'noneexists',queryKind:'name',category:'',cursor:empty.sessionCursor,hydrateIds:[]})).rows,[]);
}));

test('unified SQL: title/body/summary, text-only and truthful reference/facet evidence',{timeout:120000},()=>fresh(async db=>{
 await seedPost(db,202,8,{type:'update',title:'Autumn collection',caption:'Copper chrome',summary:'Amber long almond',media:false});
 await seedPost(db,203,9,{type:'update',title:'Amber long almond',caption:'Reference description',reference:true,media:true});
 await seedPost(db,204,10,{title:'Amber long',caption:'Different post'});
 await seedPost(db,205,10,{title:'Almond',caption:'Cannot combine words across posts'});
 const r=await search(db,{query:'copper',contentQuery:'amber long almond',queryKind:'style',filters:{shape:'almond',length:'long'}});
 assert.equal(r.rows[0].salon_id,id(8));assert.equal(r.rows[0].match_source,'salon_post');assert.equal(r.rows[0].image_provenance,'suggested');
 for(const n of [9,10]){const row=r.rows.find(x=>x.salon_id===id(n));assert(row);assert.equal(row.match_type,'suggested');assert.equal(row.result_group,'reference');assert.equal(row.is_reference_match,true);assert.equal(row.selected_media_path,null);}
 const ref=await search(db,{query:'reference description',queryKind:'style'});
 assert.equal(ref.rows.find(x=>x.salon_id===id(9)).match_type,'reference_post');
 assert.equal(ref.rows.find(x=>x.salon_id===id(9)).image_provenance,'suggested','reference upload is not owner work');
 const summary=await search(db,{query:'amber long almond',queryKind:'service'});
 assert(summary.rows.some(x=>x.salon_id===id(8)&&x.match_type==='post'));
}));

test('unified SQL: media refresh is independent from frozen rank, claim and cursor',{timeout:120000},()=>fresh(async db=>{
 const input={query:'milky matcha',queryKind:'style',limit:4};
 const first=await search(db,input);const row=first.rows.find(x=>x.salon_id===id(2));assert(row);assert.equal(row.image_provenance,'suggested');
 const ordinal=row.pagination_cursor.after;
 await seedPost(db,206,2,{media:true,published:new Date().toISOString()});
 const hydrated=await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(2)]});
 assert.equal(hydrated.rows[0].image_provenance,'salon_post');assert.equal(hydrated.rows[0].pagination_cursor.after,ordinal);assert.notEqual(hydrated.rows[0].media_revision,row.media_revision);assert.deepEqual(hydrated.sessionCursor,first.sessionCursor);
 await db.query("UPDATE salon_profile_media_assets SET bucket='other' WHERE id=$1",[id(1000206)]);
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(2)]})).rows[0].image_provenance,'suggested');
 await db.query("UPDATE salon_profile_media_assets SET bucket='salon-profile-media',salon_id=$1 WHERE id=$2",[id(1),id(1000206)]);
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(2)]})).rows[0].image_provenance,'suggested');
 await db.query('UPDATE salon_profile_media_assets SET salon_id=$1 WHERE id=$2',[id(2),id(1000206)]);
 await db.query('UPDATE salon_profile_looks SET safety_hold=true WHERE id=$1',[id(206)]);
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(2)]})).rows[0].image_provenance,'suggested');
 const cover=`${id(2)}/profile/cover/fixture.webp`;
 await db.query('UPDATE explore_salon_documents SET cover_image_path=$1,profile_completeness=100 WHERE salon_id=$2',[cover,id(2)]);
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(2)]})).rows[0].image_provenance,'suggested','stale unchecked cover cannot authorize pixels');
 await db.query("INSERT INTO salon_profile_media_assets(id,salon_id,object_path,status,purpose) VALUES($1,$2,$3,'active','cover')",[id(999),id(2),cover]);
 const covered=(await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(2)]})).rows[0];
 assert.equal(covered.image_provenance,'salon_cover');assert.equal(covered.pagination_cursor.after,ordinal);
 await assert.rejects(search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(15)]}),/membership/,'undelivered candidate cannot be hydrated');
 await assert.rejects(search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(2)],filters:{color:'green'}}),/changed or expired/);
}));

test('unified SQL: live privacy/moderation/block/withdrawal and incarnation protections',{timeout:120000},()=>fresh(async db=>{
 await db.query('INSERT INTO users(id) VALUES($1),($2)',[id(900),id(901)]);
 await db.query("SELECT set_config('test.viewer',$1,false)",[id(900)]);
 await seedPost(db,207,8,{title:'Rare cobalt',caption:'Organic title',author:id(901),media:true});
 const input={query:'rare cobalt',queryKind:'service'};const first=await search(db,input);assert.equal(first.primaryCount,1);
 await db.query('INSERT INTO fixture_user_blocks VALUES($1,$2)',[id(900),id(901)]);
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(8)]})).rows.length,0);
 await db.exec('DELETE FROM fixture_user_blocks');
 await db.query('DELETE FROM salon_profile_looks WHERE id=$1',[id(207)]);
 await seedPost(db,207,8,{title:'Rare cobalt',caption:'Reused ID',author:id(901)});
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(8)]})).rows.length,0,'deleted/recreated content does not revive old rank');
 const renewed=await search(db,input);assert.equal(renewed.primaryCount,1);
 await db.query('UPDATE explore_salon_documents SET has_public_profile=false WHERE salon_id=$1',[id(8)]);
 assert.equal((await search(db,{...input,cursor:renewed.sessionCursor,hydrateIds:[id(8)]})).rows.length,0);
 await db.query('UPDATE explore_salon_documents SET has_public_profile=true WHERE salon_id=$1',[id(8)]);
 await db.query('UPDATE salon_settings SET public_discovery_enabled=false WHERE salon_id=$1',[id(8)]);
 assert.equal((await search(db,{...input,cursor:renewed.sessionCursor,hydrateIds:[id(8)]})).rows.length,0,'current canonical public gate wins even over a stale document');
 await db.query("SELECT set_config('test.viewer',$1,false)",[id(901)]);
 await assert.rejects(search(db,{...input,cursor:renewed.sessionCursor}),/changed or expired/);
}));

test('unified SQL: public attributed customer text and media retain their true author/provenance',{timeout:120000},()=>fresh(async db=>{
 await db.query('INSERT INTO users(id) VALUES($1)',[id(902)]);
 await db.query("INSERT INTO beauty_profiles(id,user_id,visibility) VALUES($1,$2,'public')",[id(903),id(902)]);
 await db.query("INSERT INTO beauty_posts(id,profile_id,author_user_id,caption,visibility,moderation_status,created_at) VALUES($1,$2,$3,'Rare galaxy chrome','public','visible','2026-01-03')",[id(904),id(903),id(902)]);
 await db.query('INSERT INTO beauty_post_attributions(post_id,salon_id) VALUES($1,$2)',[id(904),id(7)]);
 const input={query:'rare galaxy chrome',queryKind:'service'};let r=await search(db,input);
 assert.equal(r.primaryCount,1);assert.equal(r.rows[0].match_source,'customer_post');assert.equal(r.rows[0].image_provenance,'suggested');
 const path=`${id(902)}/beauty/image/${id(905)}.webp`;
 await db.query("INSERT INTO beauty_post_media(id,post_id,object_path,bucket,role,display_order) VALUES($1,$2,$3,'beauty-profile-media','image',0)",[id(905),id(904),path]);
 let refreshed=(await search(db,{...input,cursor:r.sessionCursor,hydrateIds:[id(7)]})).rows[0];
 assert.equal(refreshed.image_provenance,'customer_post');assert.equal(refreshed.selected_media_author_user_id,id(902));assert.equal(refreshed.selected_media_salon_id,id(7));
 await db.query('UPDATE beauty_post_media SET object_path=$1 WHERE id=$2',[`${id(901)}/beauty/image/${id(905)}.webp`,id(905)]);
 assert.equal((await search(db,{...input,cursor:r.sessionCursor,hydrateIds:[id(7)]})).rows[0].image_provenance,'suggested','wrong author path cannot be borrowed');
 await db.query("UPDATE beauty_profiles SET visibility='private' WHERE id=$1",[id(903)]);
 assert.equal((await search(db,{...input,cursor:r.sessionCursor,hydrateIds:[id(7)]})).rows.length,0);
 await db.query("UPDATE beauty_profiles SET visibility='public' WHERE id=$1",[id(903)]);
 await db.query("UPDATE users SET status='deleted' WHERE id=$1",[id(902)]);
 assert.equal((await search(db,input)).primaryCount,0);
}));

test('unified SQL: page stability, no-op write revisions, expiry, legacy v2 and private ACLs',{timeout:120000},()=>fresh(async db=>{
 for(let n=16;n<=80;n++)await seedSalon(db,n,{name:`Fixture ${n}`});
 const input={query:'',queryKind:'service',limit:20};const first=await search(db,input);
 assert.equal(first.rows.length,20);const ids=first.rows.map(x=>x.salon_id);let cursor=first.nextCursor;
 await db.query('UPDATE explore_salon_documents SET profile_completeness=100 WHERE salon_id=$1',[id(80)]);
 await seedSalon(db,81,{name:'New entrant',quality:100});
 while(cursor){const page=await search(db,{...input,cursor});ids.push(...page.rows.map(x=>x.salon_id));cursor=page.nextCursor;}
 assert.equal(ids.length,80);assert.equal(new Set(ids).size,80);assert.equal(ids.at(-1),id(80));assert(!ids.includes(id(81)));
 const before=(await db.query('SELECT revision FROM explore_unified_search_clock')).rows[0].revision;
 await db.exec('UPDATE explore_salon_documents SET updated_at=now()');
 assert.equal((await db.query('SELECT revision FROM explore_unified_search_clock')).rows[0].revision,before);
 const legacy=(await db.query("SELECT search_public_explore_session('','Nails','Madison, WI',NULL,NULL,'relevance',2,NULL,'fixed','search') result")).rows[0].result;
 assert.equal(legacy.nextCursor.version,2);assert(legacy.rows.length>0);
 assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc WHERE proname='search_public_explore_session'")).rows[0].n,1);
 assert.equal((await db.query("SELECT has_function_privilege('anon','hydrate_explore_unified_search(uuid,uuid[])','execute') allowed")).rows[0].allowed,false);
 await db.query("UPDATE explore_search_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[first.sessionCursor.session]);
 await assert.rejects(search(db,{...input,cursor:first.sessionCursor}),/changed or expired/);
}));

test('unified continuity: fixed-area misses append relevant labelled references without rewriting the primary scope',{timeout:120000},()=>fresh(async db=>{
 await db.query('DELETE FROM salon_profile_media_assets WHERE salon_id=ANY($1::uuid[])',[[id(1),id(5)]]);
 await seedSalon(db,16,{name:'Hair Studio',category:'hair',city:'Milwaukee'});
 await seedPost(db,301,16,{title:'Haircut',caption:'Hair styling',media:true});
 const input={query:'king nails',queryKind:'name',category:'',location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true,limit:4};
 const first=await search(db,input);assert.equal(first.primaryCount,0);assert.equal(first.referenceCount,4);assert.equal(first.recommendationCategory,'nails');
 assert.equal(first.canonical.category,'');assert.equal(first.canonical.location,'Milwaukee, WI');assert.deepEqual(first.scope,{policy:'fixed',stage:'A',label:'Milwaukee, WI',expanded:false});
 assert.equal(first.rows[0].salon_id,id(4));assert.equal(first.rows[0].recommendation_reason,'related_in_area');assert.equal(first.rows[0].image_provenance,'salon_post','explicit area keeps local references ahead of other-area names');
 assert.equal(first.rows[1].salon_id,id(1));assert.equal(first.rows[1].match_type,'exact_name');assert.equal(first.rows[1].image_provenance,'suggested');
 assert.equal(first.rows[1].recommendation_reason,'matching_in_broader_area');assert.equal(first.rows[1].recommendation_area_label,'WI');
 const rows=[...first.rows];let cursor=first.nextCursor;
 while(cursor){const page=await search(db,{...input,cursor});assert.deepEqual(page.canonical,first.canonical);assert.deepEqual(page.scope,first.scope);rows.push(...page.rows);cursor=page.nextCursor;}
 assert.equal(rows.length,15);assert.equal(new Set(rows.map(x=>x.salon_id)).size,15);assert(rows.every(x=>!x.is_primary_match&&x.is_reference_match&&x.result_group==='reference'&&x.recommendation_area_label));assert(!rows.some(x=>x.salon_id===id(16)));
 assert(rows.findIndex(x=>x.salon_id===id(1))<rows.findIndex(x=>x.salon_id===id(6)),'within WI, exact name with suggested image still beats generic actual-photo reference');
 assert.equal(rows.at(-1).salon_id,id(5),'other-state exact name follows all selected and broader-state references');
 const noLocationPriority=await search(db,{...input,locationPriority:false});assert.deepEqual(noLocationPriority.rows.slice(0,2).map(x=>x.salon_id),[id(4),id(1)],'stored selected area establishes priority even without the older explicit flag');
 for(const [query,queryKind] of [['unavailable pedicure','service'],['unavailable velvet galaxy','style']]){
  const result=await search(db,{query,queryKind,category:'Nails',location:'Boise, ID',scopePolicy:'fixed',locationPriority:true});
  assert.equal(result.primaryCount,0);assert(result.referenceCount>0);assert(result.rows.every(x=>x.recommendation_reason==='related_in_other_areas'));assert.equal(result.scope.expanded,false);
 }
 const unknown=await search(db,{query:'unrelatedunknown',queryKind:'name',category:'',location:'Boise, ID',scopePolicy:'fixed'});assert.equal(unknown.rows.length,0);assert.equal(unknown.recommendationCategory,null);
 const none=await search(db,{query:'king nails',queryKind:'name',category:'Nails',filters:{maxPrice:1},location:'Milwaukee, WI',scopePolicy:'fixed'});assert.deepEqual(none.rows,[]);assert(none.sessionCursor);assert.equal(none.hasMore,false);
}));

test('unified real-data regression: fuzzy name retains distinctive tokens and tolerates a bounded typo',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,16,{name:'NAILS',city:'Milwaukee'});
 await seedSalon(db,17,{name:'King Nails Spa LLC',city:'Milwaukee'});
 const exact=await search(db,{query:'king nails',queryKind:'name',category:'',location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true,limit:20});
 assert.deepEqual(exact.rows.filter(x=>x.is_primary_match).map(x=>x.salon_id),[id(17)]);
 const generic=exact.rows.find(x=>x.salon_id===id(16));assert(generic);assert.equal(generic.match_type,'suggested');assert.equal(generic.is_primary_match,false);
 for(const query of ['kng nails','kign nails','kimg nails','kinng nails','kingnails']){
  const result=await search(db,{query,queryKind:'name',category:''});
  assert(result.rows.some(x=>x.salon_id===id(1)&&x.match_type==='fuzzy_name'),query+' should retain King Nails');
  assert(result.rows.some(x=>x.salon_id===id(17)&&x.match_type==='fuzzy_name'),query+' should also retain King Nails Spa LLC');
  assert(!result.rows.some(x=>x.salon_id===id(16)&&x.match_type==='fuzzy_name'),query+' must not reduce to the generic service name');
 }
 const short=await db.query("SELECT explore_unified_name_token_near('ab','ac') AS unsafe,explore_unified_name_token_near('king','kign') AS transposed");assert.equal(short.rows[0].unsafe,false);assert.equal(short.rows[0].transposed,true);
 const tokenEdges=(await db.query("SELECT a,b,expected,explore_unified_name_token_near(a,b) actual FROM (VALUES('king','king',true),('king','kng',true),('king','kin',true),('king','kings',true),('king','aking',true),('king','kign',true),('king','kimg',true),('abcd','bcda',false),('king','nails',false),('king','kig',true),('king','kgn',false),('ab','ac',false),('a','a',true)) edges(a,b,expected)")).rows;
 for(const edge of tokenEdges)assert.equal(edge.actual,edge.expected,`${edge.a}/${edge.b} bounded-token edit semantics`);
}));

test('unified real-data regression: resolved GPS city keeps unmapped salons and labels expansion after its 58-salon boundary',{timeout:120000},()=>fresh(async db=>{
 await db.query('UPDATE explore_salon_documents SET latitude=NULL,longitude=NULL WHERE salon_id=$1',[id(4)]);
 for(let n=16;n<=72;n++)await seedSalon(db,n,{name:`Milwaukee Nails ${n}`,city:'Milwaukee',latitude:null,longitude:null});
 const input={query:'',queryKind:'service',category:'Nails',location:'Milwaukee, WI',latitude:43.0389,longitude:-87.9065,scopePolicy:'expandable',locationPriority:true,limit:20};
 const first=await search(db,input);const rows=[...first.rows];let cursor=first.nextCursor;
 while(cursor){const page=await search(db,{...input,cursor});assert.deepEqual(page.canonical,first.canonical);assert.deepEqual(page.scope,first.scope);rows.push(...page.rows);cursor=page.nextCursor;}
 assert.equal(rows.length,72);assert.equal(new Set(rows.map(x=>x.salon_id)).size,72);
 assert.equal(rows.filter(x=>x.is_primary_match).length,58);
 assert(rows.slice(0,58).every(x=>x.is_primary_match&&x.city==='Milwaukee'&&x.distance_miles===null));
 assert(rows.slice(58).every(x=>!x.is_primary_match&&x.recommendation_reason&&x.recommendation_area_label));
 assert.equal(rows[58].recommendation_reason,'related_in_broader_area');assert.equal(first.scope.label,'Milwaukee, WI');assert.equal(first.scope.expanded,false,'the primary scope stays fixed while references carry their own broader-area labels');
 await db.query("UPDATE explore_salon_documents SET city='Madison',city_search='madison' WHERE salon_id=$1",[id(4)]);
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(4)]})).rows.length,0,'a primary salon moving outside the resolved city cannot retain its old primary label');
 const global=await search(db,{query:'',queryKind:'service',category:'Nails',scopePolicy:'expandable',locationPriority:false,limit:20});assert.equal(global.primaryCount,20);assert.equal(global.referenceCount,0,'unscoped discovery retains global primary results');
}));

test('unified real-data regression: unfamiliar nail phrase receives only truthful category references without guessing mixed industries',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,16,{name:'Local Nails',city:'Milwaukee'});
 await seedSalon(db,17,{name:'Local Hair Studio',city:'Milwaukee',category:'hair'});
 await seedPost(db,401,17,{title:'Fresh haircut',caption:'Public hair work',media:true});
 const input={query:'holographic turquoise stiletto nails',queryKind:'name',category:'',location:'Milwaukee, WI',scopePolicy:'fixed',locationPriority:true,limit:20};
 const result=await search(db,input);assert.equal(result.primaryCount,0);assert(result.referenceCount>0);assert.equal(result.recommendationCategory,'nails');
 assert.equal(result.canonical.category,'');assert.equal(result.canonical.queryKind,'name');assert.equal(result.canonical.query,input.query);
 assert(result.rows.every(row=>!row.is_primary_match&&row.is_reference_match&&row.match_type==='suggested'&&row.match_source==='suggested'));
 assert.equal(result.rows[0].salon_id,id(4));assert.equal(result.rows[0].image_provenance,'salon_post','an actual public representative photo precedes suggested imagery in the same area without proving the requested style');
 assert.equal(result.rows[1].salon_id,id(16));assert.equal(result.rows[1].image_provenance,'suggested');assert(result.rows.slice(0,2).every(row=>row.recommendation_reason==='related_in_area'));assert(!result.rows.some(row=>row.salon_id===id(17)),'Nails references must not include unrelated Hair');
 const contentCue=await search(db,{...input,query:'mysterious finish',contentQuery:'holographic turquoise nail'});assert.equal(contentCue.recommendationCategory,'nails');assert.equal(contentCue.primaryCount,0);
 assert.equal((await search(db,{...input,query:'unknown nails manicure'})).recommendationCategory,'nails');
 for(const query of ['holographic turquoise stiletto','unknown nailhead finish','unknown fingernails','unknown nails hair','unknown nails haircut','unknown nails eyelashes','unknown nails eyebrows','unknown nails spas']){
  const empty=await search(db,{...input,query});assert.equal(empty.recommendationCategory,null,query);assert.equal(empty.rows.length,0,query);
 }
 const explicit=await search(db,{...input,category:'Hair'});assert.equal(explicit.recommendationCategory,'hair');assert(explicit.rows.some(row=>row.salon_id===id(17)));assert(!explicit.rows.some(row=>row.salon_id===id(4)));
 await seedSalon(db,18,{name:'Holographic Nails',city:'Milwaukee',category:'hair'});
 const proven=await search(db,{...input,query:'holographic nails'});assert.equal(proven.recommendationCategory,'hair','public matched-name category wins over the generic service noun');assert.equal(proven.rows[0].salon_id,id(18));assert.equal(proven.rows[0].is_primary_match,true);assert(!proven.rows.some(row=>row.salon_id===id(4)));
}));

test('unified continuity: partial real post terms precede generic category photos without claiming an exact style',{timeout:120000},()=>fresh(async db=>{
 await seedPost(db,302,8,{title:'Red French tips',caption:'Short square manicure',media:true});
 await seedPost(db,304,7,{title:'Neutral manicure',caption:'Natural glossy finish',media:true});
 await db.query('INSERT INTO users(id) VALUES($1)',[id(910)]);
 await db.query("INSERT INTO beauty_profiles(id,user_id,visibility) VALUES($1,$2,'public')",[id(911),id(910)]);
 await db.query("INSERT INTO beauty_posts(id,profile_id,author_user_id,caption,visibility,moderation_status,created_at) VALUES($1,$2,$3,'Red French square','public','visible','2026-01-03')",[id(912),id(911),id(910)]);
 await db.query('INSERT INTO beauty_post_attributions(post_id,salon_id) VALUES($1,$2)',[id(912),id(9)]);
 await db.query("INSERT INTO beauty_post_media(id,post_id,object_path,bucket,role,display_order) VALUES($1,$2,$3,'beauty-profile-media','image',0)",[id(913),id(912),`${id(910)}/beauty/image/${id(913)}.webp`]);
 const input={query:'red almond French',queryKind:'style',location:'Milwaukee, WI',scopePolicy:'fixed',limit:20};const result=await search(db,input);
 assert.equal(result.primaryCount,0);const owner=result.rows.find(x=>x.salon_id===id(8)),customer=result.rows.find(x=>x.salon_id===id(9));
 for(const row of [owner,customer]){assert.equal(row.match_type,'related_post');assert.equal(row.is_primary_match,false);assert.equal(row.result_group,'reference');assert.equal(row.recommendation_reason,'related_in_broader_area');assert(result.rows.indexOf(row)<result.rows.findIndex(x=>x.salon_id===id(7)));}
 assert.equal(owner.image_provenance,'salon_post');assert.equal(customer.image_provenance,'customer_post');assert.equal(customer.selected_media_author_user_id,id(910));
 assert.equal((await db.query('SELECT (unified_payload->>\'snapshotRealMedia\')::boolean available FROM explore_search_session_candidates WHERE session_id=$1 AND salon_id=$2',[result.sessionCursor.session,id(9)])).rows[0].available,true);
 const faceted=await search(db,{...input,filters:{shape:'almond'}});assert.notEqual(faceted.rows.find(x=>x.salon_id===id(9)).match_type,'related_post');assert.equal(faceted.rows.find(x=>x.salon_id===id(9)).image_provenance,'suggested','customer photo cannot supply missing explicit facet evidence');
 const nameBrowse=await search(db,{query:'missing salon',queryKind:'name',location:'Milwaukee, WI',scopePolicy:'fixed',limit:20});
 assert.equal(nameBrowse.rows.find(x=>x.salon_id===id(9)).image_provenance,'customer_post');
 assert.equal((await db.query('SELECT (unified_payload->>\'snapshotRealMedia\')::boolean available FROM explore_search_session_candidates WHERE session_id=$1 AND salon_id=$2',[nameBrowse.sessionCursor.session,id(9)])).rows[0].available,true);
 await db.query("UPDATE beauty_posts SET caption='Unrelated lavender glitter' WHERE id=$1",[id(912)]);
 assert.equal((await search(db,{...input,cursor:result.sessionCursor,hydrateIds:[id(9)]})).rows.length,0,'removed related evidence cannot revive a saved reference');
}));

test('unified continuity: real-media preference is snapshotted across lazy pagination, fresh media hydrates without moving ordinals',{timeout:120000},()=>fresh(async db=>{
 for(let n=16;n<=80;n++)await seedSalon(db,n,{name:`Fixture Nails ${n}`});
 const input={query:'unavailable style',queryKind:'style',location:'Milwaukee, WI',scopePolicy:'fixed',limit:2};const first=await search(db,input);
 assert.equal(first.primaryCount,0);assert(first.rows.every(x=>x.image_provenance!=='suggested'));
 await seedPost(db,303,80,{title:'Current real photo',caption:'Own manicure work',media:true,published:new Date().toISOString()});
 const rows=[...first.rows];let cursor=first.nextCursor;
 while(cursor){const page=await search(db,{...input,cursor});rows.push(...page.rows);cursor=page.nextCursor;}
 assert.equal(rows.length,80);assert.equal(new Set(rows.map(x=>x.salon_id)).size,80);const late=rows.find(x=>x.salon_id===id(80));assert.equal(rows.filter(x=>x.state_code==='WI').at(-1).salon_id,id(80));assert.equal(late.image_provenance,'salon_post');assert.equal(rows.at(-1).state_code,'HI','all same-state references stay ahead of distant real photos');
 const hydrated=(await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(80)]})).rows[0];assert.equal(hydrated.pagination_cursor.after,late.pagination_cursor.after);assert.equal(hydrated.image_provenance,'salon_post');
 const current=await search(db,{...input,limit:20});assert(current.rows.findIndex(x=>x.salon_id===id(80))<current.rows.findIndex(x=>x.image_provenance==='suggested'),'fresh search adopts new real-media availability');
 const before=(await db.query('SELECT revision FROM explore_unified_search_clock')).rows[0].revision;
 await db.exec("UPDATE salon_profile_media_assets SET status='active' WHERE status='active'");
 await db.exec('UPDATE salon_profile_looks SET title=title');
 assert.equal((await db.query('SELECT revision FROM explore_unified_search_clock')).rows[0].revision,before,'same availability/content writes do not lock or increment revision');
 await db.query("UPDATE salon_profile_media_assets SET status='deleted' WHERE id=$1",[id(1000303)]);
 assert.equal((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(80)]})).rows[0].image_provenance,'suggested');
}));

test('unified continuity: primary exhaustion leads into references in the same stable session',{timeout:120000},()=>fresh(async db=>{
 const input={query:'king nails',queryKind:'name',location:'Madison, WI',scopePolicy:'fixed',limit:1};const first=await search(db,input);
 assert.equal(first.primaryCount,1);assert.equal(first.rows[0].salon_id,id(1));assert.equal(first.rows[0].is_primary_match,true);
 const second=await search(db,{...input,cursor:first.nextCursor});assert.equal(second.primaryCount,0);assert.equal(second.referenceCount,1);assert.equal(second.sessionCursor.session,first.sessionCursor.session);assert.equal(second.rows[0].city,'Madison','local references precede distant exact names');assert.equal(second.scope.label,'Madison, WI');assert.equal(second.scope.expanded,false);
 await db.query('UPDATE salon_settings SET public_discovery_enabled=false WHERE salon_id=$1',[second.rows[0].salon_id]);
 assert.equal((await search(db,{...input,cursor:second.sessionCursor,hydrateIds:[second.rows[0].salon_id]})).rows.length,0,'references retain current public gate');
 for(let n=16;n<=80;n++)await seedSalon(db,n,{name:`Fixture Nails ${n}`});
 const gpsInput={query:'',queryKind:'service',latitude:43.07,longitude:-89.4,scopePolicy:'fixed',locationPriority:true,limit:1};
 const gpsFirst=await search(db,gpsInput);assert.equal(gpsFirst.rows[0].salon_id,id(1),'default relevance prefers an equally relevant real salon photo before nearer generated imagery');
 assert.equal((await db.query('SELECT count(*)::int n FROM explore_search_session_candidates WHERE session_id=$1 AND salon_id=$2',[gpsFirst.sessionCursor.session,id(80)])).rows[0].n,0,'moved salon begins beyond the lazy candidate batch');
 await db.query('UPDATE explore_salon_documents SET latitude=44.07 WHERE salon_id=$1',[id(80)]);
 const gpsRows=[...gpsFirst.rows];let cursor=gpsFirst.nextCursor;
 while(cursor){const page=await search(db,{...gpsInput,limit:20,cursor});gpsRows.push(...page.rows);cursor=page.nextCursor;}
 const moved=gpsRows.find(x=>x.salon_id===id(80));assert(moved);assert.equal(moved.is_primary_match,false);assert.equal(moved.recommendation_reason,'related_in_other_areas');assert(moved.distance_miles>50,'live moved coordinates cannot reuse the frozen local radius');
 assert(gpsRows.filter(x=>x.is_primary_match).every(x=>x.distance_miles<=10));
}));
