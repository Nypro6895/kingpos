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
function runner(data=empty){const calls=[];return {calls,rpc:async(name,args)=>{calls.push({name,args});return {data,error:null};}};}

test('broad category requests use indexed category ordering only after exact brand verification; specific requirements survive',async()=>{
 for(const query of ['nails','Nail place','best nail salons','hair salons']){
  const result=await router.resolveExploreQueryRouting({query},runner());
  assert.equal(result.query,'');assert.equal(result.displayQuery,query);assert.ok(result.category);
  const exact=await router.resolveExploreQueryRouting({query},runner({...empty,exactSalonName:true}));
  assert.equal(exact.query,query);assert.equal(exact.category,'');
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
test('content themes route to posts, brand exact matches win heuristics, and explicit Ideas can override',async()=>{
 const posts=await router.resolveExploreQueryRouting({query:'christmas nail design'},runner());
 assert.equal(posts.target,'posts');assert.equal(posts.contentQuery,'christmas');assert.equal(posts.category,'Nails');assert.equal(posts.displayQuery,'christmas nail design');
 const exact=runner({...empty,exactSalonName:true,exactOriginalSalonName:true});
 const brand=await router.resolveExploreQueryRouting({query:'Design Nails'},exact);assert.equal(brand.target,'salons');assert.equal(brand.query,'Design Nails');assert.equal(brand.category,'');
 assert.equal((await router.resolveExploreQueryRouting({query:'Design Nails',target:'posts'},exact)).target,'posts');
 const city=await router.resolveExploreQueryRouting({query:'Milwaukee'},runner({...empty,exactSalonName:true,exactOriginalSalonName:true,areaCandidates:[area('Milwaukee','WI')]}));
 assert.equal(city.query,'');assert.equal(city.location,'Milwaukee, WI','a clear bare city wins an identical business name without a salon cue');
 const quoted=await router.resolveExploreQueryRouting({query:'"Milwaukee"'},exact);assert.equal(quoted.query,'Milwaukee');assert.equal(quoted.location,'');
 const nearName=await router.resolveExploreQueryRouting({query:'Nails Near Me'},runner({...empty,exactOriginalSalonName:true}));assert.equal(nearName.query,'Nails Near Me');assert.equal(nearName.requiresGps,false);assert.equal(nearName.nearMe,false);
 const inName=await router.resolveExploreQueryRouting({query:'Designs in Motion'},runner({...empty,exactOriginalSalonName:true}));assert.equal(inName.target,'salons');assert.equal(inName.query,'Designs in Motion');
});
test('entity failures are explicit and cancellation reaches the resolver rather than returning a false empty match',async()=>{
 const failed=await router.resolveExploreQueryRouting({query:'Milwaukee'},{rpc:async()=>({data:null,error:{code:'57014'}})});
 assert.equal(failed.lookupFailed,true);
 assert.equal((await router.resolveExploreQueryRouting({query:'Milwaukee'},runner({}))).lookupFailed,true);
 const controller=new AbortController();controller.abort();
 await assert.rejects(router.resolveExploreQueryRouting({query:'Milwaukee'},{signal:controller.signal,rpc:runner().rpc}),e=>e.name==='AbortError');
});
test('near-by aliases request actual GPS and exact full business names retain priority over routing phrases',async()=>{
 for(const query of ['nails near by','nails near by me','nails near my location','nails near current location']){
  const gps=await router.resolveExploreQueryRouting({query,location:'Milwaukee, WI',locationSource:'gps',latitude:43,longitude:-87},runner());
  assert.equal(gps.nearMe,true);assert.equal(gps.requiresGps,false);assert.equal(gps.locationOrigin,'context');assert.equal(gps.latitude,43);assert.equal(gps.query,'');
  const unresolved=await router.resolveExploreQueryRouting({query},runner());assert.equal(unresolved.requiresGps,true);assert.equal(unresolved.location,'');
 }
 const explicit=await router.resolveExploreQueryRouting({query:'King Nails near by Milwaukee',location:'Chicago, IL',locationSource:'gps',latitude:41,longitude:-87},runner({...empty,areaCandidates:[area('Milwaukee','WI')]}));
 assert.equal(explicit.location,'Milwaukee, WI');assert.equal(explicit.locationOrigin,'query');assert.equal(explicit.query,'King Nails');assert.equal(explicit.latitude,null);assert.equal(explicit.scopePolicy,'fixed');
 const brand=await router.resolveExploreQueryRouting({query:'KingNails near by'},runner({...empty,exactOriginalSalonName:true}));
 assert.equal(brand.query,'KingNails near by');assert.equal(brand.nearMe,false);assert.equal(brand.requiresGps,false);assert.equal(brand.target,'salons');
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
 for(const query of ['Nails WI','Nails 53202','King Nails Milwaukee','King Nails WI','Design Nails Milwaukee']) {
  const api=runner({...empty,exactOriginalSalonName:true,areaCandidates:[area('Milwaukee','WI')]}),result=await router.resolveExploreQueryRouting({query},api);
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
 const posts=await router.resolveExploreQueryRouting({query:'French gel nail designs Chicago'},runner(data));assert.equal(posts.target,'posts');assert.equal(posts.contentQuery,'french gel');assert.equal(posts.category,'Nails');assert.equal(posts.location,'Chicago, IL');
 const specific=await router.resolveExploreQueryRouting({query:'gel nails Chicago'},runner(data));assert.equal(specific.query,'gel nails');assert.equal(specific.category,'Nails');assert.equal(specific.location,'Chicago, IL');
 const style=await router.resolveExploreQueryRouting({query:'nail designs red ombre'},runner());assert.equal(style.contentQuery,'red ombre');assert.equal(style.location,'','unrecognized trailing style words must return to mandatory content terms');
});
