import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>deps[name]});return exports;}
const discoveryModule=load('lib/explore-feed-discovery.ts');
const {shouldShowExploreSearchRecommendations:gate,buildExploreSearchRecommendations:build}=load('lib/explore-search-recommendations.ts',{'@/lib/explore-feed-discovery':discoveryModule});
const empty=()=>({target:'salons',query:'Ghost Salon',displayQuery:'Ghost Salon near Milwaukee',category:'Nails',location:'Milwaukee, WI',locationSource:'manual',locationOrigin:'query',scope:{policy:'fixed',stage:'A',label:'Milwaukee, WI',expanded:false},sort:'relevance',error:null,errorKind:null,lookupFailed:false,requiresGps:false,page:1,hasMore:false,nextCursor:null,results:[],sections:{bestMatches:[],nearby:[],recommended:[]},totalCount:0});
const complete={searchMode:true,isSearching:false};
test('suggestions gate only a completed genuine-empty first salon search, with no pending/error/location or continuation ambiguity',()=>{
 assert.equal(gate(empty(),complete),true);
 for(const patch of [{target:'posts'},{page:2},{error:'Search unavailable'},{errorKind:'query'},{errorKind:'timeout'},{errorKind:'network'},{errorKind:'cursor'},{lookupFailed:true},{requiresGps:true},{hasMore:true},{nextCursor:{session:'matching-search'}},{totalCount:12},{results:[{id:'visible'}]},{sections:{bestMatches:[{id:'visible'}],nearby:[],recommended:[]}},{sections:{bestMatches:[],nearby:[{id:'visible'}],recommended:[]}},{sections:{bestMatches:[],nearby:[],recommended:[{id:'visible'}]}},{results:undefined},{sections:{}}])assert.equal(gate({...empty(),...patch},complete),false,JSON.stringify(patch));
 assert.equal(gate(empty(),{searchMode:false,isSearching:false}),false);assert.equal(gate(empty(),{searchMode:true,isSearching:true}),false);
});
test('recommendations preserve the query for staged related ideas and canonical area/category/fixed scope, and ignore stale GPS or injected filter fields',()=>{
 const original=empty(),snapshot=JSON.stringify(original);
 const result=build(original,{coordinates:{latitude:43,longitude:-87},filters:{maxPrice:55,bookableOnly:true,newOnly:true,trendingOnly:true,query:'Christmas',category:'Hair',location:'Chicago, IL'}});
 assert.equal(result.discovery.query,'Ghost Salon');assert.equal(result.discovery.category,'Nails');assert.equal(result.discovery.location,'Milwaukee, WI');assert.equal(result.discovery.strictLocation,true);
 assert.equal(result.discovery.latitude,null);assert.equal(result.discovery.longitude,null);assert.equal(result.discovery.maxPrice,55);assert.equal(result.discovery.bookableOnly,true);assert.equal(result.discovery.newOnly,true);assert.equal(result.discovery.trendingOnly,true);
 assert.equal(JSON.stringify(original),snapshot,'recommendations never change original matching rows, query, counts or cursor');
 for(const locationOrigin of ['manual','query'])assert.equal(build({...original,locationSource:'gps',locationOrigin},{coordinates:{latitude:43,longitude:-87}}).discovery.latitude,null);
});
test('valid context GPS and explicit expansion remain available while invalid pairs and unlocated guests stay safe',()=>{
 const contextual={...empty(),locationSource:'gps',locationOrigin:'context',scope:{policy:'expandable'}};
 const gps=build(contextual,{coordinates:{latitude:0,longitude:0}});assert.equal(gps.discovery.latitude,0);assert.equal(gps.discovery.longitude,0);assert.equal(gps.discovery.strictLocation,false);
 for(const locationSource of ['activity','saved','workspace']){
  const staleGps=build({...contextual,locationSource},{coordinates:{latitude:43,longitude:-87}});
  assert.equal(staleGps.discovery.latitude,null,'a new GPS point must not attach to an older contextual area');assert.equal(staleGps.discovery.longitude,null);
 }
 for(const coordinates of [{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:NaN,longitude:-87},{latitude:43,longitude:undefined}]){
  const result=build(contextual,{coordinates});assert.equal(result.discovery.latitude,null);assert.equal(result.discovery.longitude,null);
 }
 const widenedManual=build({...empty(),scope:{policy:'expandable'}});assert.equal(widenedManual.discovery.strictLocation,false,'explicit user expansion is preserved even with a manual field');
 const legacyManual=build({...empty(),scope:undefined,locationOrigin:undefined,locationSource:undefined});assert.equal(legacyManual.discovery.strictLocation,true,'a legacy selected area is not silently widened');
 const global=build({...empty(),location:'',locationOrigin:'none',locationSource:'none',scope:{policy:'expandable'}},{coordinates:{latitude:43,longitude:-87}});
 assert.equal(global.discovery.location,'');assert.equal(global.discovery.latitude,null);assert.equal(global.discovery.strictLocation,false);assert.equal(global.discovery.intent,'discover');
 const invalidFilter=build(empty(),{filters:{maxPrice:-1,bookableOnly:'true'}});assert.equal(invalidFilter.discovery.maxPrice,null);assert.equal(invalidFilter.discovery.bookableOnly,false);
});
test('a recommendation key binds raw and canonical search, all supported filters, area, consented GPS and viewer, without reusing the search cursor',()=>{
 const original=empty(),baseline=build(original,{viewerId:'user-a'});
 for(const patch of [{query:'Other Salon'},{displayQuery:'Ghost Salon in Milwaukee'},{category:'Hair'},{location:'Chicago, IL'},{locationSource:'saved',locationOrigin:'context'},{scope:{policy:'expandable'}},{sort:'closest'}])assert.notEqual(build({...original,...patch},{viewerId:'user-a'}).sessionKey,baseline.sessionKey);
 assert.notEqual(build(original,{viewerId:'user-b'}).sessionKey,baseline.sessionKey);
 assert.notEqual(build(original,{viewerId:'user-a',filters:{bookableOnly:true}}).sessionKey,baseline.sessionKey);
 const context={...original,locationSource:'gps',locationOrigin:'context'};assert.notEqual(build(context,{coordinates:{latitude:43,longitude:-87}}).sessionKey,build(context,{coordinates:{latitude:44,longitude:-87}}).sessionKey);
 const withCursor=build({...original,nextCursor:{session:'never-reuse-search-cursor',after:12}},{viewerId:'user-a'});
 assert.equal(withCursor.sessionKey,baseline.sessionKey);assert.ok(!withCursor.sessionKey.includes('never-reuse-search-cursor'));assert.equal(withCursor.cursor,undefined);
 assert.equal(JSON.parse(baseline.sessionKey.slice(baseline.sessionKey.indexOf(':')+1)).displayQuery,original.displayQuery);
});
