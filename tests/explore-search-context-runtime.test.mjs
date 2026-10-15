import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function load(file,deps={}){
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name]});
 return exports;
}
const discovery=load('lib/explore-feed-discovery.ts');
const {buildExploreCommittedSearchContext:build,getExploreCommittedSearchCoordinates:coordinates,getExploreSearchSortState:ordering}=load('lib/explore-search-context.ts',{'@/lib/explore-feed-discovery':discovery});
const response=()=>({target:'posts',query:'christmas nail design',displayQuery:'Christmas nail design near Milwaukee',contentQuery:'christmas',category:'Nails',location:'Milwaukee, WI',locationSource:'gps',locationOrigin:'context',scope:{policy:'fixed'},sort:'relevance',appliedSort:'relevance',error:null,results:[],sections:{bestMatches:[],nearby:[],recommended:[]}});
const point={latitude:43.0389,longitude:-87.9065};
test('GPS binds to the completed response, never a different response or a new raw point while search is pending',()=>{
 const committed=response(),context={response:committed,coordinates:point};
 assert.equal(coordinates(committed,context).latitude,point.latitude);
 const pending=response();assert.equal(coordinates(pending,context),null);
 assert.equal(build(pending,{gpsContext:context}).discovery.latitude,null);
 for(const patch of [{locationOrigin:'manual'},{locationOrigin:'query'},{locationSource:'saved'},{locationSource:'activity'},{locationSource:'workspace'}]){
  const current={...committed,...patch};assert.equal(coordinates(current,{response:current,coordinates:point}),null);
 }
 const zero=response();assert.equal(coordinates(zero,{response:zero,coordinates:{latitude:0,longitude:0}}).latitude,0);
 for(const invalid of [{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:NaN,longitude:0}])assert.equal(coordinates(committed,{response:committed,coordinates:invalid}),null);
});
test('every committed query, scope, actor, routing and filter change creates a distinct Ideas session, without depending on cursor',()=>{
 const initial=response(),options={viewerId:'viewer-a',gpsContext:{response:initial,coordinates:point}};
 const baseline=build(initial,options);
 assert.equal(baseline.discovery.query,'christmas');assert.equal(baseline.discovery.category,'Nails');assert.equal(baseline.discovery.location,'Milwaukee, WI');assert.equal(baseline.discovery.strictLocation,true);
 for(const patch of [{scope:{policy:'expandable'}},{query:'red nail design'},{contentQuery:'red'},{displayQuery:'Christmas nails'},{category:'Hair'},{location:'Chicago, IL'},{locationSource:'manual'},{locationOrigin:'query'},{target:'salons'},{sort:'trusted'},{appliedSort:'trusted'}]){
  const next={...initial,...patch};assert.notEqual(build(next,{...options,gpsContext:{response:next,coordinates:point}}).sessionKey,baseline.sessionKey,JSON.stringify(patch));
 }
 assert.notEqual(build(initial,{...options,viewerId:'viewer-b'}).sessionKey,baseline.sessionKey);
 assert.notEqual(build(initial,{...options,intent:'latest'}).sessionKey,baseline.sessionKey);
 for(const filters of [{maxPrice:60},{bookableOnly:true},{newOnly:true},{trendingOnly:true}])assert.notEqual(build(initial,{...options,filters}).sessionKey,baseline.sessionKey);
 const withCursor={...initial,nextCursor:{session:'another',after:24},page:3};
 assert.equal(build(withCursor,{...options,gpsContext:{response:withCursor,coordinates:point}}).sessionKey,baseline.sessionKey);
});
test('manual and typed-query areas retain their canonical filter and never reuse GPS from an earlier search',()=>{
 for(const locationOrigin of ['manual','query']){
  const selected={...response(),locationOrigin,locationSource:'manual',location:'Chicago, IL'};
  const result=build(selected,{gpsContext:{response:selected,coordinates:point},filters:{query:'irrelevant',category:'Hair',location:'Milwaukee',bookableOnly:true}});
  assert.equal(result.discovery.latitude,null);assert.equal(result.discovery.longitude,null);assert.equal(result.discovery.location,'Chicago, IL');assert.equal(result.discovery.query,'christmas');assert.equal(result.discovery.category,'Nails');assert.equal(result.discovery.bookableOnly,true);
 }
 const legacy={...response(),locationOrigin:undefined,locationSource:undefined,scope:undefined};assert.equal(build(legacy).discovery.strictLocation,true);
});
test('order selection reports the server-applied choice and truthful legacy or unsupported-sort fallback',()=>{
 assert.equal(ordering({...response(),sort:'trusted',appliedSort:'trusted'}).appliedSort,'trusted');
 assert.equal(ordering({...response(),sort:'trusted',appliedSort:'trusted'}).fallbackMessage,null);
 const fallback=ordering({...response(),sort:'trusted',appliedSort:'relevance'});assert.equal(fallback.requestedSort,'trusted');assert.equal(fallback.appliedSort,'relevance');assert.ok(fallback.fallbackMessage);
 assert.equal(ordering({...response(),sort:'trusted',appliedSort:undefined}).appliedSort,'relevance');
 assert.equal(ordering({...response(),sort:'closest',appliedSort:'relevance'}).fallbackMessage,'Showing best matches for this search.');
 assert.equal(ordering({...response(),sort:'trusted',appliedSort:'relevance',error:'Unavailable'}).fallbackMessage,null);
});
