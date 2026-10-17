import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createUnifiedExploreFixture,fixtureId as id,seedSalon,seedPost,searchFixture as search} from './fixtures/explore-unified-search-bootstrap.mjs';

const migration=()=>readFileSync('supabase/migrations/20261017030000_explore_anywhere_search.sql','utf8')+'\n'+readFileSync('supabase/migrations/20261017040000_explore_unified_query_performance.sql','utf8');
const comparable=row=>({id:row.salon_id,match:row.match_type,source:row.match_source,primary:row.is_primary_match,group:row.result_group,reason:row.recommendation_reason,area:row.recommendation_area_label,image:row.image_provenance,distance:row.distance_miles,ordinal:row.pagination_cursor.after});
async function collect(db,input){
 let page=await search(db,{...input,limit:7});const rows=[...page.rows];
 const metadata={appliedSort:page.appliedSort,supportedSorts:page.supportedSorts,sortFallbackReason:page.sortFallbackReason,canonical:page.canonical,scope:page.scope};
 for(let n=0;page.hasMore;n++){
  assert(n<40,'bounded test pagination');page=await search(db,{...input,limit:7,cursor:page.nextCursor});rows.push(...page.rows);
 }
 return{metadata,rows:rows.map(comparable)};
}

test('Anywhere SQL optimization preserves full IDs, order, evidence, scope and old cursor continuation',{timeout:120000},async()=>{
 const fixture=await createUnifiedExploreFixture({seed:false,anywhereSearch:false});const db=fixture.db;
 try{
  const names=['Red Nails','Red Nails and Spa','Reed Nails','Rednails Palace','Blue Nails','Nails Red','Copper Chrome','Quiet Studio'];
  for(let n=1;n<=75;n++){
   await seedSalon(db,n,{name:n<=names.length?names[n-1]:'Nails Studio '+n,city:n%3===0?'Madison':'Milwaukee',latitude:n%4===0?null:43.04+n/1000,longitude:n%4===0?null:-87.9,quality:n%100,created:n%2===0?'2026-02-01T00:00:00Z':'2026-01-01T00:00:00Z'});
  }
  await seedPost(db,101,5,{title:'Red nails',caption:'Autumn collection',media:true});
  await seedPost(db,102,6,{title:'Collection',caption:'Red nails'});
  await db.query("UPDATE explore_salon_documents SET description=$1,phone='(414) 555-0123',address_line1='8333 W Appleton Ave',postal_code='53222' WHERE salon_id=$2",['Wheelchair accessible copper sanctuary '+('ordinary public details '.repeat(300)),id(8)]);
  const cases=[
   {query:'red nails',queryKind:'name',category:''},
   {query:'reed nails',queryKind:'name',category:''},
   {query:'red nails',contentQuery:'red',queryKind:'style',category:'Nails'},
   {query:'red nails',contentQuery:'red',queryKind:'style',category:'Nails',location:'Milwaukee, WI'},
   {query:'wheelchair accessible',queryKind:'name',category:''},
   {query:'414 555 0123',queryKind:'name',category:''},
   {query:'8333 appleton',queryKind:'name',category:''},
   {query:'gel nails',queryKind:'service',category:''},
   {query:'',queryKind:'service',category:'',location:'53222'},
   {query:'',queryKind:'service',category:'',location:'Milwaukee, WI'},
   {query:'',queryKind:'service',category:'',sort:'newest'},
   {query:'',queryKind:'service',category:'Nails',latitude:43.04,longitude:-87.9,sort:'closest'},
  ];
  const expected=[];for(const input of cases)expected.push(await collect(db,input));
  const cursorInput={query:'',queryKind:'service',category:'Nails',location:'Milwaukee, WI',limit:7};
  const cursorBefore=await search(db,cursorInput);
  const nextBefore=await search(db,{...cursorInput,cursor:cursorBefore.nextCursor});
  await db.exec(migration());
  for(let n=0;n<cases.length;n++)assert.deepEqual(await collect(db,cases[n]),expected[n],JSON.stringify(cases[n]));
  const nextAfter=await search(db,{...cursorInput,cursor:cursorBefore.nextCursor});
  assert.deepEqual(nextAfter.rows.map(comparable),nextBefore.rows.map(comparable));
  assert(expected[0].rows.some(row=>row.id===id(3)&&row.match==='fuzzy_name'),'typo eligibility is exercised, not just exact names');
  assert(expected[4].rows.some(row=>row.id===id(8)&&row.match==='profile'),'long profile text remains searchable');
 }finally{await fixture.close();}
});

test('Anywhere all-token probes retain phone fallback, short tokens and live profile/name removals',{timeout:120000},async()=>{
 const fixture=await createUnifiedExploreFixture({seed:false});const db=fixture.db;
 try{
  await seedSalon(db,1,{name:'Red Nails',city:'Milwaukee'});
  await db.query("UPDATE explore_salon_documents SET phone='4145550123',description='Red accessible care',address_line1='8333 W Appleton Ave' WHERE salon_id=$1",[id(1)]);
  for(const query of ['red accessible','414 555 0123','8333 w appleton']){
   const input={query,queryKind:'name',category:'',location:'Milwaukee, WI'};
   const first=await search(db,input);assert.equal(first.rows[0].salon_id,id(1));assert.equal(first.rows[0].match_type,'profile');
  }
  const input={query:'red accessible',queryKind:'name',category:'',location:'Milwaukee, WI'};
  const first=await search(db,input);
  await db.query("UPDATE explore_salon_documents SET description='Changed description' WHERE salon_id=$1",[id(1)]);
  assert.deepEqual((await search(db,{...input,cursor:first.sessionCursor,hydrateIds:[id(1)]})).rows,[]);
  const nameInput={query:'red nails',queryKind:'name',category:'',location:'Milwaukee, WI'};
  const named=await search(db,nameInput);assert.equal(named.rows[0].match_type,'exact_name');
  await db.query("UPDATE explore_salon_documents SET salon_name='Blue Studio',salon_name_search='blue studio' WHERE salon_id=$1",[id(1)]);
  assert.deepEqual((await search(db,{...nameInput,cursor:named.sessionCursor,hydrateIds:[id(1)]})).rows,[]);
  const access=(await db.query("SELECT has_function_privilege('anon','explore_unified_selective_token(text)','execute') allowed")).rows[0];assert.equal(access.allowed,false);
 }finally{await fixture.close();}
});

test('Anywhere exact category prepass preserves public proof and renamed live rows at a historical revision',{timeout:120000},async()=>{
 const fixture=await createUnifiedExploreFixture({seed:false,anywhereSearch:false});const db=fixture.db;
 try{
  await seedSalon(db,1,{name:'King Nails',category:'nails'});
  await seedSalon(db,2,{name:'King Nails',category:'hair'});
  await seedSalon(db,3,{name:'King Nail Studio',category:'massage'});
  await seedSalon(db,4,{name:'King Nails',category:'lashes'});
  const frozen=(await db.query('SELECT revision FROM explore_unified_search_clock')).rows[0].revision;
  await db.query("UPDATE explore_salon_documents SET salon_name='King Nail',salon_name_search='king nail' WHERE salon_id=$1",[id(1)]);
  await db.query("UPDATE explore_salon_documents SET salon_name='Unrelated Hair',salon_name_search='unrelated hair' WHERE salon_id=$1",[id(2)]);
  await db.query('UPDATE salon_settings SET public_discovery_enabled=false WHERE salon_id=$1',[id(4)]);
  // Simulate a session revision captured just before these live name changes.
  // Only this disposable fixture clock is rewound; canonical rows stay current.
  await db.query('UPDATE explore_unified_search_clock SET revision=$1',[frozen]);
  const input={query:'king nails',queryKind:'name',category:''};
  const before=await collect(db,input);
  const categoryBefore=(await db.query('SELECT unified_reference_category FROM explore_search_sessions ORDER BY created_at DESC LIMIT 1')).rows[0].unified_reference_category;
  assert.equal(categoryBefore,'nails','historic exact row must still prove its renamed live fuzzy match');
  await db.exec(migration());
  assert.deepEqual(await collect(db,input),before);
  assert.equal((await db.query('SELECT unified_reference_category FROM explore_search_sessions ORDER BY created_at DESC LIMIT 1')).rows[0].unified_reference_category,categoryBefore);
  // Remove the only eligible historic exact-name row: inference must execute
  // its complete original fallback, skipping both unrelated and hidden names.
  await db.query('UPDATE salon_settings SET public_discovery_enabled=false WHERE salon_id=$1',[id(1)]);
  const after=await collect(db,input);assert(!after.rows.some(r=>[id(1),id(4)].includes(r.id)));
  assert(!after.rows.some(r=>r.id===id(2)&&r.source==='salon_name'),'unrelated renamed salon cannot retain name evidence');
  assert.equal((await db.query('SELECT unified_reference_category FROM explore_search_sessions ORDER BY created_at DESC LIMIT 1')).rows[0].unified_reference_category,'massage');
 }finally{await fixture.close();}
});

test('Anywhere keyed incarnation proof excludes a recreated salon beyond the first lazy batch',{timeout:120000},async()=>{
 const fixture=await createUnifiedExploreFixture({seed:false});const db=fixture.db;
 try{
  for(let n=1;n<=75;n++)await seedSalon(db,n,{name:'Local Nails '+n,latitude:null,longitude:null});
  const input={query:'',queryKind:'service',category:'Nails',limit:1};
  let page=await search(db,input);const rows=[...page.rows];
  assert.equal((await db.query('SELECT count(*)::int n FROM explore_search_session_candidates WHERE session_id=$1 AND salon_id=$2',[page.sessionCursor.session,id(75)])).rows[0].n,0);
  const original=(await db.query('SELECT * FROM explore_salon_documents WHERE salon_id=$1',[id(75)])).rows[0];
  await db.query('DELETE FROM explore_salon_documents WHERE salon_id=$1',[id(75)]);
  await db.query('INSERT INTO explore_salon_documents SELECT * FROM jsonb_populate_record(NULL::explore_salon_documents,$1::jsonb)',[JSON.stringify(original)]);
  while(page.hasMore){page=await search(db,{...input,limit:20,cursor:page.nextCursor});rows.push(...page.rows);}
  assert.equal(rows.length,74);assert(!rows.some(r=>r.salon_id===id(75)),'same UUID with a new incarnation cannot enter an old frozen session');
  const fresh=await collect(db,input);assert(fresh.rows.some(r=>r.id===id(75)),'a new session can see the current recreated public salon');
 }finally{await fixture.close();}
});
