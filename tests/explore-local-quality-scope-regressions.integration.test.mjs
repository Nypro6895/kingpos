import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {createUnifiedExploreFixture,fixtureId as id,seedSalon,seedPost,searchFixture as search} from './fixtures/explore-unified-search-bootstrap.mjs';

const fresh=async run=>{const fixture=await createUnifiedExploreFixture({seed:false,localQuality:true});try{await run(fixture.db);}finally{await fixture.close();}};
const load=(path,dependencies={})=>{const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(path,'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,DOMException,require:name=>dependencies[name]});return module.exports;};
const parser=load('lib/explore-query-intent.ts');
const router=load('lib/explore-query-routing.ts',{'@/lib/explore-query-intent':parser,'@/lib/supabase/server':{createSupabaseServerClient:()=>null}});
const lookup=db=>async(name,args)=>{
 assert.equal(name,'get_public_explore_query_entities');
 const data=(await db.query('SELECT get_public_explore_query_entities($1,$2,$3,$4,$5,$6) AS result',[args.p_query,args.p_city_query,args.p_preferred_state,args.p_state_constraint,args.p_limit,args.p_original_query])).rows[0].result;
 return {data,error:null};
};

test('real category-only routing hands an empty keyword to SQL and preserves explicit business names',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Angel Beauty',city:'Milwaukee',latitude:43.04,longitude:-87.9});
 await seedSalon(db,2,{name:'Copper Studio',city:'Milwaukee',latitude:43.04,longitude:-87.9});
 await seedSalon(db,3,{name:'Island House',city:'Honolulu',state:'HI',latitude:21.3,longitude:-157.8,quality:100});
 await seedSalon(db,4,{name:'Nails',city:'Milwaukee',latitude:43.04,longitude:-87.9,quality:100});
 const rpc=lookup(db);
 for(const query of ['nails','nails near Milwaukee','nails near me']){
  const routed=await router.resolveExploreQueryRouting({query,latitude:43.04,longitude:-87.9,locationSource:'gps'},{rpc});
  assert.equal(routed.lookupFailed,false,query);assert.equal(routed.query,'',query);assert.equal(routed.contentQuery,'',query);assert.equal(routed.category,'Nails',query);assert.equal(routed.queryKind,'service',query);
  for(const sort of ['relevance','closest','newest']){
   const result=await search(db,{...routed,sort});
   assert.equal(result.rankingBasis,'local_quality_indexed_lanes',`${query}: ${sort}`);
   assert.deepEqual(new Set(result.rows.filter(x=>x.is_primary_match).map(x=>x.salon_id)),new Set([id(1),id(2),id(4)]),`${query}: ${sort}`);
  }
 }
 const quoted=await router.resolveExploreQueryRouting({query:'"Nails"',location:'Milwaukee, WI',locationSource:'manual'},{rpc});
 assert.equal(quoted.query,'Nails');assert.equal(quoted.queryKind,'name');assert.equal(quoted.category,'');
 const exact=await search(db,quoted);assert.equal(exact.rows[0].salon_id,id(4));assert.equal(exact.rows[0].match_type,'exact_name');
 const specific=await router.resolveExploreQueryRouting({query:'gel manicure near Milwaukee'},{rpc});
 assert.equal(specific.query,'gel manicure');assert.equal(specific.contentQuery,'gel manicure');assert.equal(specific.queryKind,'service');
}));

test('local-quality state, ZIP and verified street-address scopes stay strict across relevance, Closest and newest',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1,{name:'Appleton Studio',city:'Milwaukee',state:'WI',latitude:null,longitude:null});
 await seedSalon(db,2,{name:'Madison Studio',city:'Madison',state:'WI',latitude:43.07,longitude:-89.4});
 await seedSalon(db,3,{name:'Chicago Studio',city:'Chicago',state:'IL',latitude:41.88,longitude:-87.63});
 await db.query("UPDATE explore_salon_documents SET address_line1='8333 West Appleton Avenue',postal_code='53218' WHERE salon_id=$1",[id(1)]);
 await db.query("UPDATE explore_salon_documents SET address_line1='100 State Street',postal_code='53703' WHERE salon_id=$1",[id(2)]);
 await db.query("UPDATE explore_salon_documents SET address_line1='1 Lake Street',postal_code='60601' WHERE salon_id=$1",[id(3)]);
 const input={query:'gel manicure',contentQuery:'gel manicure',queryKind:'service',category:'Nails',scopePolicy:'fixed',locationPriority:true,latitude:43.04,longitude:-87.9,limit:20};
 for(const sort of ['relevance','closest','newest']) {
  for(const [location,expected] of [['WI',[id(1),id(2)]],['53218-1234',[id(1)]],['8333 W Appleton Ave Milwaukee WI 53218',[id(1)]]]) {
   const result=await search(db,{...input,sort,location});
   assert.equal(result.rankingBasis,'local_quality_indexed_lanes',`${sort}: ${location}`);
   assert.equal(result.appliedSort,sort,`${sort}: ${location}`);
   assert.deepEqual(new Set(result.rows.filter(row=>row.is_primary_match).map(row=>row.salon_id)),new Set(expected),`${sort}: ${location}`);
   assert(result.rows.filter(row=>!expected.includes(row.salon_id)).every(row=>!row.is_primary_match),`${sort}: outside address must remain labelled suggestions`);
   if(sort==='closest') assert.equal(result.rows.find(row=>row.salon_id===id(1))?.distance_miles,null,'unmapped address must never acquire synthetic mileage');
  }
 }
}));

test('actual published unblocked work is required for style facets under every new indexed sort',{timeout:120000},()=>fresh(async db=>{
 for(let n=1;n<=3;n++) await seedSalon(db,n,{name:'Plain Studio '+n,city:'Milwaukee',state:'WI',latitude:43.04,longitude:-87.9});
 const viewer=id(900),author=id(901);
 await db.query('INSERT INTO users(id) VALUES($1),($2)',[viewer,author]);
 await db.query("SELECT set_config('test.viewer',$1,false)",[viewer]);
 await seedPost(db,701,2,{title:'Red almond',caption:'Scheduled future work',published:'2099-01-01T00:00:00Z'});
 await seedPost(db,702,3,{title:'Red almond',caption:'Actual public work',author});
 await db.query('INSERT INTO fixture_user_blocks(actor,subject) VALUES($1,$2)',[viewer,author]);
 const input={query:'red almond',contentQuery:'red almond',queryKind:'style',filters:{shape:'almond'},category:'Nails',scopePolicy:'fixed',location:'Milwaukee, WI',latitude:43.04,longitude:-87.9};
 for(const sort of ['relevance','closest','newest']) {
  const result=await search(db,{...input,sort});
  assert.equal(result.primaryCount,0,sort);
  assert.deepEqual(result.rows,[],`${sort}: service-only, future or blocked work cannot establish a style/facet match`);
 }
 await db.exec('DELETE FROM fixture_user_blocks');
 for(const sort of ['relevance','closest','newest']) {
  const result=await search(db,{...input,sort});
  assert.equal(result.primaryCount,1,sort);
  assert.equal(result.rows[0].salon_id,id(3),sort);
  assert.equal(result.rows[0].match_type,'post',sort);
 }
}));
