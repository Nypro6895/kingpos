import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,DOMException,require:name=>name==='server-only'?{}:deps[name]});return exports;}
const parser=load('lib/explore-query-intent.ts');
const router=load('lib/explore-query-routing.ts',{'@/lib/explore-query-intent':parser,'@/lib/supabase/server':{createSupabaseServerClient:()=>null}});
const area=(city,stateCode)=>({kind:'city',city,stateCode,label:`${city}, ${stateCode}`});
const empty={version:1,exactSalonName:false,exactOriginalSalonName:false,areaCandidates:[],moreAreaCandidates:false};
const productionEntities=JSON.parse(readFileSync('tests/fixtures/explore-query-production-entities-20261016.json','utf8'));
function runner(data=empty){const calls=[];return {calls,rpc:async(name,args)=>{calls.push({name,args});return {data,error:null};}};}

test('broad category requests retain category ordering despite generic brand collisions; specific requirements survive',async()=>{
 for(const query of ['nails','Nail place','best nail salons','hair salons']){
  const result=await router.resolveExploreQueryRouting({query},runner());
  assert.equal(result.query,'');assert.equal(result.displayQuery,query);assert.ok(result.category);
  const exact=await router.resolveExploreQueryRouting({query},runner({...empty,exactSalonName:true}));
  assert.equal(exact.query,'');assert.equal(exact.category,result.category);assert.equal(exact.queryKind,'service');
 }
 for(const query of ['gel nails','acrylic nails','French nails','manicure','hair extensions','full set nails']){
  assert.equal((await router.resolveExploreQueryRouting({query},runner())).query,query);
 }
 assert.equal((await router.resolveExploreQueryRouting({query:'nails'},{rpc:async()=>({data:null,error:{code:'57014'}})})).query,'nails');
});
test('city text and names with city phrases route using current public areas rather than workspace guesses',async()=>{
 const api=runner({...empty,areaCandidates:[area('Milwaukee','WI')]});
 const city=await router.resolveExploreQueryRouting({query:'Milwaukee'},api);
 assert.equal(city.query,'');assert.equal(city.location,'Milwaukee, WI');assert.equal(city.locationOrigin,'query');assert.equal(city.scopePolicy,'fixed');
 const brand=await router.resolveExploreQueryRouting({query:'King Nails in Milwaukee'},api);
 assert.equal(brand.query,'King Nails');assert.equal(brand.category,'');assert.equal(brand.location,'Milwaukee, WI');
 assert.equal(api.calls[0].args.p_city_query,'Milwaukee');assert.equal(api.calls[0].args.p_limit,8);
 const ghost=await router.resolveExploreQueryRouting({query:'King Nails in Wonderland'},runner());
 assert.equal(ghost.query,'King Nails in Wonderland');assert.equal(ghost.location,'','unrecognized in-phrases must not truncate a possible business name');
});
test('manual fields win conflicts; query places override GPS, saved and activity fallback and clear frozen GPS filters',async()=>{
 const api=runner({...empty,areaCandidates:[area('Chicago','IL')]});
 for(const locationSource of ['gps','saved','activity']){
  const result=await router.resolveExploreQueryRouting({query:'King Nails near Chicago',location:'Milwaukee, WI',locationSource,latitude:43,longitude:-87},api);
  assert.equal(result.location,'Chicago, IL');assert.equal(result.locationOrigin,'query');assert.equal(result.locationSource,'manual');assert.equal(result.latitude,null);assert.equal(result.longitude,null);
 }
 const manual=await router.resolveExploreQueryRouting({query:'King Nails near Chicago',location:'Madison, WI',latitude:43,longitude:-87},api);
 assert.equal(manual.location,'Madison, WI');assert.equal(manual.locationOrigin,'manual');assert.equal(manual.locationConflict,true);assert.equal(manual.latitude,null);
 const widened=await router.resolveExploreQueryRouting({query:'Chicago',scopePolicy:'expandable'},api);assert.equal(widened.scopePolicy,'expandable');
});
test('near-me uses actual GPS context and asks for location when coordinates are absent',async()=>{
 const gps=await router.resolveExploreQueryRouting({query:'nails near me',location:'Milwaukee, WI',locationSource:'gps',latitude:43,longitude:-87},runner());
 assert.equal(gps.query,'');assert.equal(gps.category,'Nails');assert.equal(gps.locationOrigin,'context');assert.equal(gps.latitude,43);assert.equal(gps.longitude,-87);assert.equal(gps.requiresGps,false);assert.equal(gps.scopePolicy,'expandable');
 const none=await router.resolveExploreQueryRouting({query:'nails near me'},runner());
 assert.equal(none.location,'');assert.equal(none.requiresGps,true);assert.equal(none.locationSource,'none');
 const raw=await router.resolveExploreQueryRouting({query:'nails near me',latitude:0,longitude:0},runner());assert.equal(raw.locationOrigin,'context');assert.equal(raw.latitude,0);
});
test('ambiguous city suggests states without choosing the first shop, and uses only positive matching context',async()=>{
 const api=runner({...empty,areaCandidates:[area('Springfield','IL'),area('Springfield','MA')]});
 const unknown=await router.resolveExploreQueryRouting({query:'Springfield'},api);
 assert.equal(unknown.location,'Springfield');assert.equal(unknown.areaAmbiguous,true);assert.equal(unknown.areaCandidates.length,2);
 const context=await router.resolveExploreQueryRouting({query:'Springfield',location:'Boston, MA',locationSource:'gps'},api);
 assert.equal(context.location,'Springfield, MA');assert.equal(api.calls.at(-1).args.p_preferred_state,'MA');
 const wrong=await router.resolveExploreQueryRouting({query:'Springfield',contextState:'CA'},api);assert.equal(wrong.location,'Springfield');
});
test('content themes retain style semantics in one salon search and legacy Ideas cannot bypass exact names',async()=>{
 const posts=await router.resolveExploreQueryRouting({query:'christmas nail design'},runner());
 assert.equal(posts.target,'salons');assert.equal(posts.contentQuery,'christmas');assert.equal(posts.category,'Nails');assert.equal(posts.displayQuery,'christmas nail design');
 const exact=runner({...empty,exactSalonName:true,exactOriginalSalonName:true});
 const brand=await router.resolveExploreQueryRouting({query:'Design Nails'},exact);assert.equal(brand.target,'salons');assert.equal(brand.query,'Design Nails');assert.equal(brand.category,'');
 assert.equal((await router.resolveExploreQueryRouting({query:'Design Nails',target:'posts'},exact)).target,'salons');
 const city=await router.resolveExploreQueryRouting({query:'Milwaukee'},runner({...empty,exactSalonName:true,exactOriginalSalonName:true,areaCandidates:[area('Milwaukee','WI')]}));
 assert.equal(city.query,'');assert.equal(city.location,'Milwaukee, WI','a clear bare city wins an identical business name without a salon cue');
 const quoted=await router.resolveExploreQueryRouting({query:'"Milwaukee"'},exact);assert.equal(quoted.query,'Milwaukee');assert.equal(quoted.location,'');
 const nearName=await router.resolveExploreQueryRouting({query:'Nails Near Me'},runner({...empty,exactOriginalSalonName:true}));assert.equal(nearName.query,'');assert.equal(nearName.category,'Nails');assert.equal(nearName.requiresGps,true);assert.equal(nearName.nearMe,true);
 const inName=await router.resolveExploreQueryRouting({query:'Designs in Motion'},runner({...empty,exactOriginalSalonName:true}));assert.equal(inName.target,'salons');assert.equal(inName.query,'Designs in Motion');
});
test('entity failures are explicit and cancellation reaches the resolver rather than returning a false empty match',async()=>{
 const failed=await router.resolveExploreQueryRouting({query:'Milwaukee'},{rpc:async()=>({data:null,error:{code:'57014'}})});
 assert.equal(failed.lookupFailed,true);
 assert.equal((await router.resolveExploreQueryRouting({query:'Milwaukee'},runner({}))).lookupFailed,true);
 const controller=new AbortController();controller.abort();
 await assert.rejects(router.resolveExploreQueryRouting({query:'Milwaukee'},{signal:controller.signal,rpc:runner().rpc}),e=>e.name==='AbortError');
});
test('near-by aliases require location even when an unquoted phrase is also a full business name',async()=>{
 for(const query of ['nails near by','nails near by me','nails near my location','nails near current location']){
  const gps=await router.resolveExploreQueryRouting({query,location:'Milwaukee, WI',locationSource:'gps',latitude:43,longitude:-87},runner());
  assert.equal(gps.nearMe,true);assert.equal(gps.requiresGps,false);assert.equal(gps.locationOrigin,'context');assert.equal(gps.latitude,43);assert.equal(gps.query,'');
  const unresolved=await router.resolveExploreQueryRouting({query},runner());assert.equal(unresolved.requiresGps,true);assert.equal(unresolved.location,'');
 }
 const explicit=await router.resolveExploreQueryRouting({query:'King Nails near by Milwaukee',location:'Chicago, IL',locationSource:'gps',latitude:41,longitude:-87},runner({...empty,areaCandidates:[area('Milwaukee','WI')]}));
 assert.equal(explicit.location,'Milwaukee, WI');assert.equal(explicit.locationOrigin,'query');assert.equal(explicit.query,'King Nails');assert.equal(explicit.latitude,null);assert.equal(explicit.scopePolicy,'fixed');
 const brand=await router.resolveExploreQueryRouting({query:'KingNails near by'},runner({...empty,exactOriginalSalonName:true}));
 assert.equal(brand.query,'KingNails');assert.equal(brand.nearMe,true);assert.equal(brand.requiresGps,true);assert.equal(brand.target,'salons');
});

test('combined service/state/ZIP/city uses one bounded entity proof and avoids the former nails-city interpretation',async()=>{
 for(const [query,location] of [['nails WI','WI'],['nails Wisconsin','WI'],['nails 53202','53202'],['nails 53202-1234','53202-1234']]) {
  const api=runner(),result=await router.resolveExploreQueryRouting({query},api);
  assert.equal(result.query,'');assert.equal(result.category,'Nails');assert.equal(result.location,location);assert.equal(result.locationOrigin,'query');assert.equal(result.scopePolicy,'fixed');
  assert.equal(api.calls.length,1);assert.equal(api.calls[0].args.p_query,'nails');assert.equal(api.calls[0].args.p_original_query,query);assert.equal(api.calls[0].args.p_city_query,null);assert.equal(api.calls[0].args.p_limit,8);
 }
 const api=runner({...empty,areaCandidates:[area('Milwaukee','WI')]}),city=await router.resolveExploreQueryRouting({query:'nail place Milwaukee WI'},api);
 assert.equal(city.location,'Milwaukee, WI');assert.equal(city.query,'');assert.equal(city.category,'Nails');assert.equal(api.calls.length,1);
 assert.equal(api.calls[0].args.p_query,'nail place');assert.equal(api.calls[0].args.p_city_query,'Milwaukee');assert.equal(api.calls[0].args.p_state_constraint,'WI');
 const plain=await router.resolveExploreQueryRouting({query:'nails Milwaukee'},runner({...empty,areaCandidates:[area('Milwaukee','WI')]}));assert.equal(plain.location,'Milwaukee, WI');assert.equal(plain.category,'Nails');assert.equal(plain.query,'');
});

test('complete brand proof wins combined-area heuristics while unknown cities and lookup failures never silently truncate names',async()=>{
 for(const query of ['King Nails Milwaukee','King Nails WI','Design Nails Milwaukee']) {
  const api=runner({...empty,exactOriginalSalonName:true,areaCandidates:query.endsWith('Milwaukee')?[area('Milwaukee','WI')]:[]}),result=await router.resolveExploreQueryRouting({query},api);
  assert.equal(result.query,query);assert.equal(result.displayQuery,query);assert.equal(result.location,'');assert.equal(result.category,'');assert.equal(result.target,'salons');assert.equal(result.areaCandidates.length,0);assert.equal(api.calls.length,1);
 }
 const brandedCity=await router.resolveExploreQueryRouting({query:'King Nails Milwaukee'},runner({...empty,exactSalonName:true,areaCandidates:[area('Milwaukee','WI')]}));
 assert.equal(brandedCity.query,'King Nails');assert.equal(brandedCity.location,'Milwaukee, WI');assert.equal(brandedCity.category,'');
 const compactBrand=await router.resolveExploreQueryRouting({query:'KingNails WI'},runner({...empty,exactOriginalSalonName:true}));assert.equal(compactBrand.query,'KingNails WI');assert.equal(compactBrand.location,'','an exact brand with an unverified qualified city cannot become an empty area search');
 const bareCity=await router.resolveExploreQueryRouting({query:'Milwaukee WI'},runner({...empty,exactOriginalSalonName:true,areaCandidates:[area('Milwaukee','WI')]}));assert.equal(bareCity.query,'');assert.equal(bareCity.location,'Milwaukee, WI','a verified bare qualified city retains its geographic meaning');
 const unknown=await router.resolveExploreQueryRouting({query:'nails Wonderland'},runner());assert.equal(unknown.query,'nails Wonderland');assert.equal(unknown.location,'');assert.equal(unknown.lookupFailed,false);
 const failed=await router.resolveExploreQueryRouting({query:'nails Milwaukee'},{rpc:async()=>({data:null,error:{code:'57014'}})});assert.equal(failed.lookupFailed,true,'an unavailable entity lookup must remain a system failure');
});

test('combined cities keep manual/GPS precedence, ambiguous choices and mandatory content styles',async()=>{
 const data={...empty,areaCandidates:[area('Chicago','IL')]};
 for(const source of ['gps','saved','activity']) {
  const result=await router.resolveExploreQueryRouting({query:'nails Chicago',location:'Milwaukee, WI',locationSource:source,latitude:43,longitude:-87},runner(data));
  assert.equal(result.location,'Chicago, IL');assert.equal(result.locationOrigin,'query');assert.equal(result.latitude,null);assert.equal(result.longitude,null);
 }
 const manual=await router.resolveExploreQueryRouting({query:'nails Chicago',location:'Madison, WI',latitude:43,longitude:-87},runner(data));assert.equal(manual.location,'Madison, WI');assert.equal(manual.locationConflict,true);assert.equal(manual.queryLocationHint,'Chicago, IL');
 const ambiguous=await router.resolveExploreQueryRouting({query:'nails Springfield'},runner({...empty,areaCandidates:[area('Springfield','IL'),area('Springfield','MA')]}));assert.equal(ambiguous.location,'Springfield');assert.equal(ambiguous.areaAmbiguous,true);assert.equal(ambiguous.areaCandidates.length,2);assert.equal(ambiguous.category,'Nails');
 const posts=await router.resolveExploreQueryRouting({query:'French gel nail designs Chicago'},runner(data));assert.equal(posts.target,'salons');assert.equal(posts.contentQuery,'french gel');assert.equal(posts.category,'Nails');assert.equal(posts.location,'Chicago, IL');
 const specific=await router.resolveExploreQueryRouting({query:'gel nails Chicago'},runner(data));assert.equal(specific.query,'gel nails');assert.equal(specific.category,'Nails');assert.equal(specific.location,'Chicago, IL');
 const style=await router.resolveExploreQueryRouting({query:'nail designs red ombre'},runner());assert.equal(style.contentQuery,'red ombre');assert.equal(style.location,'','unrecognized trailing style words must return to mandatory content terms');
});

test('selected, saved and GPS areas all prioritize their salon address region',async()=>{
 const manual=await router.resolveExploreQueryRouting({query:'red nails near me',target:'posts',location:'Chicago, IL',locationSource:'manual',latitude:43,longitude:-87},runner());
 assert.equal(manual.target,'salons');assert.equal(manual.queryKind,'style');assert.equal(manual.location,'Chicago, IL');assert.equal(manual.latitude,null);assert.equal(manual.requiresGps,false);assert.equal(manual.locationPriority,true);
 const gps=await router.resolveExploreQueryRouting({query:'nails near me',latitude:43,longitude:-87},runner());assert.equal(gps.locationPriority,true);assert.equal(gps.requiresGps,false);
 const context=await router.resolveExploreQueryRouting({query:'red nails',location:'Milwaukee, WI',locationSource:'saved'},runner());assert.equal(context.locationPriority,true);assert.equal(context.contentQuery,'red');
 const city=await router.resolveExploreQueryRouting({query:'red nails in Chicago, IL'},runner());assert.equal(city.locationPriority,true);assert.equal(city.location,'Chicago, IL');
});

test('nearby aliases use a known address area without demanding coordinates or becoming a generic brand',async()=>{
 for(const query of ['nails near me','nails nearly me','nails nearly','nails near by','nails nearby']) {
  for(const locationSource of ['manual','saved','gps','activity','workspace']) {
   const actual=await router.resolveExploreQueryRouting({query,location:'Milwaukee, WI',locationSource},runner({...empty,exactOriginalSalonName:true,exactSalonName:true}));
   assert.equal(actual.query,'',`${query} ${locationSource}`);assert.equal(actual.queryKind,'service');assert.equal(actual.category,'Nails');assert.equal(actual.location,'Milwaukee, WI');assert.equal(actual.locationPriority,true);assert.equal(actual.requiresGps,false);assert.equal(actual.nearMe,true);
  }
  assert.equal((await router.resolveExploreQueryRouting({query},runner())).requiresGps,true);
 }
 const gps=await router.resolveExploreQueryRouting({query:'red nails',latitude:43.04,longitude:-87.9},runner());assert.equal(gps.locationPriority,true);
 const ordinary=await router.resolveExploreQueryRouting({query:'red nails'},runner());assert.equal(ordinary.locationPriority,false);
 const named=await router.resolveExploreQueryRouting({query:'salon named Nails nearly me',location:'Milwaukee, WI',locationSource:'saved'},runner({...empty,exactSalonName:true}));assert.equal(named.query,'Nails nearly me');assert.equal(named.queryKind,'name');assert.equal(named.nearMe,false);
});

function addressRunner(candidates=[area('Milwaukee','WI')],options={}) {
 const calls=[];
 return {calls,rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='get_public_explore_address_area') return options.error ? {data:null,error:options.error} : {data:{version:1,areaCandidates:candidates,moreAreaCandidates:options.more===true},error:null};
  return {data:options.entities??empty,error:null};
 }};
}

test('validated public street addresses remain the search region and retain salon/style terms',async()=>{
 const address='8333 W Appleton Ave Milwaukee WI 53218';
 for(const [query,kind,content,category] of [[address,'service','',''],['nails at '+address,'service','','Nails'],['red nail designs near '+address,'style','red','Nails'],['King Nails at address '+address,'name','King Nails','']]) {
  const api=addressRunner(),result=await router.resolveExploreQueryRouting({query,location:'Chicago, IL',locationSource:'saved',latitude:41.88,longitude:-87.63},api);
  assert.equal(result.location,address);assert.equal(result.addressQuery,address);assert.equal(result.addressStatus,'resolved');assert.equal(result.locationOrigin,'query');assert.equal(result.scopePolicy,'fixed');assert.equal(result.locationPriority,true);assert.equal(result.latitude,null);assert.equal(result.longitude,null);
  assert.equal(result.queryKind,kind);assert.equal(result.contentQuery,content);assert.equal(result.category,category);assert.equal(result.lookupFailed,false);assert.equal(result.areaAmbiguous,false);
  assert.equal(api.calls.filter(c=>c.name==='get_public_explore_address_area').length,1);assert.equal(api.calls.at(-1).args.p_address,address);assert.equal(api.calls.at(-1).args.p_limit,8);
  if(query===address) assert.equal(api.calls.length,1,'a bare address needs no salon-name lookup');
 }
 const generic=await router.resolveExploreQueryRouting({query:'nails near '+address},addressRunner(undefined,{entities:{...empty,exactSalonName:true}}));assert.equal(generic.queryKind,'service');assert.equal(generic.query,'');assert.equal(generic.category,'Nails');
 const manual=await router.resolveExploreQueryRouting({query:'red nails',location:address,locationSource:'manual',latitude:41.88,longitude:-87.63},addressRunner());assert.equal(manual.locationOrigin,'manual');assert.equal(manual.location,address);assert.equal(manual.addressStatus,'resolved');assert.equal(manual.latitude,null);
 const saved=await router.resolveExploreQueryRouting({query:'nails near me',location:address,locationSource:'saved'},addressRunner());assert.equal(saved.location,address);assert.equal(saved.addressStatus,'resolved');assert.equal(saved.requiresGps,false);
});

test('unmatched or ambiguous addresses retain their request instead of falling back to GPS or a global area',async()=>{
 const address='8333 W Appleton Ave';
 for(const candidates of [[],[area('Milwaukee','WI'),area('Chicago','IL')]]) {
  const api=addressRunner(candidates),result=await router.resolveExploreQueryRouting({query:'nails at '+address,location:'Milwaukee, WI',locationSource:'saved',latitude:43.04,longitude:-87.9},api);
  assert.equal(result.addressStatus,candidates.length?'ambiguous':'unmatched');assert.equal(result.location,address);assert.equal(result.locationOrigin,'query');assert.equal(result.latitude,null);assert.equal(result.scopePolicy,'fixed');assert.equal(result.locationPriority,true);assert.equal(result.lookupFailed,false);assert.equal(result.areaCandidates.length,candidates.length);
 }
 const partial=await router.resolveExploreQueryRouting({query:address},addressRunner([area('Milwaukee','WI')],{more:true}));assert.equal(partial.addressStatus,'ambiguous','bounded output must not manufacture uniqueness');
 const manualApi=addressRunner([]),manual=await router.resolveExploreQueryRouting({query:'nails at '+address,location:'Chicago, IL',locationSource:'manual'},manualApi);
 assert.equal(manual.location,'Chicago, IL');assert.equal(manual.addressStatus,undefined);assert.equal(manual.addressQuery,undefined);assert.equal(manual.locationConflict,true);assert.equal(manualApi.calls.some(c=>c.name==='get_public_explore_address_area'),false,'an unused query address cannot block an explicit manual area');
 const quoted=await router.resolveExploreQueryRouting({query:'"8333 W Appleton Ave"'},runner({...empty,exactSalonName:true}));assert.equal(quoted.addressStatus,undefined);assert.equal(quoted.query,'8333 W Appleton Ave');assert.equal(quoted.queryKind,'name');
});

test('address lookup failures and cancellation retain system-error semantics',async()=>{
 const address='8333 W Appleton Ave';
 const failed=await router.resolveExploreQueryRouting({query:address},addressRunner([],{error:{code:'57014'}}));assert.equal(failed.lookupFailed,true);assert.equal(failed.location,address);
 const malformed=await router.resolveExploreQueryRouting({query:address},{rpc:async()=>({data:{version:1},error:null})});assert.equal(malformed.lookupFailed,true);
 const controller=new AbortController();
 await assert.rejects(router.resolveExploreQueryRouting({query:address},{signal:controller.signal,rpc:async()=>{controller.abort();return {data:{version:1,areaCandidates:[]},error:null};}}),e=>e.name==='AbortError');
});

test('captured public salon named Nails cannot turn a generic near-me request into a brand search',async()=>{
 for(const query of ['nails near me','nail salon near me','nails nearby']){
  const input={query,location:'milwaukee, WI',locationSource:'manual',latitude:21.3,longitude:-157.8};
  const actual=await router.resolveExploreQueryRouting(input,runner(productionEntities.nailsNearMe));
  assert.equal(actual.queryKind,'service');assert.equal(actual.query,'');assert.equal(actual.contentQuery,'');assert.equal(actual.category,'Nails');assert.equal(actual.displayQuery,query);
  assert.equal(actual.location,'milwaukee, WI');assert.equal(actual.locationSource,'manual');assert.equal(actual.locationPriority,true);assert.equal(actual.scopePolicy,'fixed');assert.equal(actual.requiresGps,false);assert.equal(actual.latitude,null);assert.equal(actual.longitude,null);
 }
 const noGps=await router.resolveExploreQueryRouting({query:'nails near me'},runner(productionEntities.nailsNearMe));
 assert.equal(noGps.category,'Nails');assert.equal(noGps.queryKind,'service');assert.equal(noGps.requiresGps,true);
 const gps=await router.resolveExploreQueryRouting({query:'nails near me',latitude:43.04,longitude:-87.9},runner(productionEntities.nailsNearMe));
 assert.equal(gps.queryKind,'service');assert.equal(gps.category,'Nails');assert.equal(gps.requiresGps,false);assert.equal(gps.latitude,43.04);
 const king=await router.resolveExploreQueryRouting({query:'king nails',location:'milwaukee, WI',locationSource:'manual'},runner(productionEntities.kingNails));
 assert.equal(king.queryKind,'name');assert.equal(king.query,'king nails');assert.equal(king.contentQuery,'king nails');assert.equal(king.category,'');
 const named=await router.resolveExploreQueryRouting({query:'salon named Nails'},runner(productionEntities.nailsNearMe));
 assert.equal(named.queryKind,'name');assert.equal(named.query,'Nails');assert.equal(named.category,'');
});

test('captured generic brand collision preserves category semantics for explicit location phrases',async()=>{
 for(const query of ['nails near Milwaukee','nails Milwaukee']){
  const actual=await router.resolveExploreQueryRouting({query},runner(productionEntities.nailsMilwaukee));
  assert.equal(actual.queryKind,'service');assert.equal(actual.query,'');assert.equal(actual.contentQuery,'');assert.equal(actual.category,'Nails');assert.equal(actual.displayQuery,query);
  assert.equal(actual.location,'Milwaukee, WI');assert.equal(actual.locationOrigin,'query');assert.equal(actual.locationPriority,true);assert.equal(actual.scopePolicy,'fixed');assert.equal(actual.requiresGps,false);
 }
 const manual=await router.resolveExploreQueryRouting({query:'nails near Milwaukee',location:'Chicago, IL',locationSource:'manual'},runner(productionEntities.nailsMilwaukee));
 assert.equal(manual.category,'Nails');assert.equal(manual.query,'');assert.equal(manual.location,'Chicago, IL');assert.equal(manual.locationConflict,true);
 const quoted=await router.resolveExploreQueryRouting({query:'"Nails near Milwaukee"'},runner({...empty,exactSalonName:true}));
 assert.equal(quoted.queryKind,'name');assert.equal(quoted.query,'Nails near Milwaukee');assert.equal(quoted.category,'');assert.equal(quoted.location,'');
 const fullBrand=await router.resolveExploreQueryRouting({query:'Nails Milwaukee'},runner({...productionEntities.nailsMilwaukee,exactOriginalSalonName:true}));
 assert.equal(fullBrand.queryKind,'service');assert.equal(fullBrand.query,'');assert.equal(fullBrand.category,'Nails');assert.equal(fullBrand.location,'Milwaukee, WI');
});

test('verified explicit areas and generic service-city combinations cannot be consumed by exact full names',async()=>{
 const entities={...empty,exactOriginalSalonName:true,areaCandidates:[area('Milwaukee','WI')]};
 for(const query of ['nails near Milwaukee','nails in Milwaukee','nails at Milwaukee','nails Milwaukee']) {
  const result=await router.resolveExploreQueryRouting({query},runner(entities));assert.equal(result.location,'Milwaukee, WI');assert.equal(result.category,'Nails');assert.equal(result.query,'');assert.equal(result.locationPriority,true);
 }
 const distinctive=await router.resolveExploreQueryRouting({query:'King Nails Milwaukee'},runner(entities));assert.equal(distinctive.query,'King Nails Milwaukee');assert.equal(distinctive.location,'');assert.equal(distinctive.queryKind,'name');
 const explicit=await router.resolveExploreQueryRouting({query:'King Nails in Milwaukee'},runner({...entities,exactSalonName:true}));assert.equal(explicit.query,'King Nails');assert.equal(explicit.location,'Milwaukee, WI');assert.equal(explicit.queryKind,'name');
 const quoted=await router.resolveExploreQueryRouting({query:'"Nails Milwaukee"'},runner({...empty,exactSalonName:true}));assert.equal(quoted.query,'Nails Milwaukee');assert.equal(quoted.location,'');assert.equal(quoted.queryKind,'name');
 const named=await router.resolveExploreQueryRouting({query:'salon named Nails Milwaukee'},runner({...empty,exactSalonName:true}));assert.equal(named.query,'Nails Milwaukee');assert.equal(named.location,'');
 const unknown=await router.resolveExploreQueryRouting({query:'Designs in Motion'},runner({...empty,exactOriginalSalonName:true}));assert.equal(unknown.query,'Designs in Motion');assert.equal(unknown.queryKind,'name');assert.equal(unknown.location,'');
});

test('Anywhere searches keywords and typed ZIP/state/place without requiring device location',async()=>{
 const inherited={fallbackLocation:'Chicago, IL',fallbackSource:'workspace'};
 for(const [query,location,kind,content] of [['red nail','','style','red'],['red nails','','style','red'],['53222','53222','service',''],['nails near wa','WA','service',''],['Nails WI','WI','service',''],['Nails 53202','53202','service','']]) {
  const result=await router.resolveExploreQueryRouting({query,locationSource:'none',latitude:43,longitude:-87,contextState:'IL'},{...inherited,...runner({...empty,exactSalonName:true,exactOriginalSalonName:true})});
  assert.equal(result.location,location,query);assert.equal(result.queryKind,kind,query);assert.equal(result.contentQuery,content,query);assert.equal(result.requiresGps,false,query);
  assert.equal(result.latitude,null);assert.equal(result.longitude,null);assert.equal(result.locationPriority,Boolean(location));
 }
 const city=await router.resolveExploreQueryRouting({query:'Milwaukee',locationSource:'none'},{...inherited,...runner({...empty,areaCandidates:[area('Milwaukee','WI')]})});
 assert.equal(city.location,'Milwaukee, WI');assert.equal(city.requiresGps,false);
 const near=await router.resolveExploreQueryRouting({query:'nails near me',locationSource:'none',location:'Chicago, IL',latitude:43,longitude:-87},{...inherited,...runner()});
 assert.equal(near.location,'');assert.equal(near.requiresGps,true);assert.equal(near.latitude,null);
 const ambiguous=await router.resolveExploreQueryRouting({query:'Springfield',locationSource:'none',contextState:'IL'},{...inherited,...runner({...empty,areaCandidates:[area('Springfield','IL'),area('Springfield','MA')]})});
 assert.equal(ambiguous.location,'Springfield');assert.equal(ambiguous.areaAmbiguous,true,'Anywhere must not silently reuse an old state to disambiguate a typed place');
});

test('a matching salon name cannot consume literal style terms; explicit names remain available',async()=>{
 const api=runner({...empty,exactSalonName:true,exactOriginalSalonName:true});
 for(const query of ['red nail','Red Nails','Christmas Nails','French nail designs']) {
  const result=await router.resolveExploreQueryRouting({query},api);
  assert.equal(result.queryKind,'style',query);assert.equal(result.category,'Nails');assert.ok(result.contentQuery);assert.equal(result.requiresGps,false);
 }
 for(const query of ['"Red Nails"','salon named Red Nails','Design Nails','King Nails']) {
  const result=await router.resolveExploreQueryRouting({query},api);
  assert.equal(result.queryKind,'name',query);assert.equal(result.category,'');assert.equal(result.location,'');assert.equal(result.requiresGps,false);
 }
 const located=await router.resolveExploreQueryRouting({query:'red nails near WA'},api);
 assert.equal(located.queryKind,'style');assert.equal(located.contentQuery,'red');assert.equal(located.category,'Nails');assert.equal(located.location,'WA');
});
