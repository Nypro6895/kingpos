import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(file,deps={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,DOMException,require:name=>name==='server-only'?{}:deps[name]});
 return exports;
}
const parser=load('lib/explore-query-intent.ts');
const router=load('lib/explore-query-routing.ts',{'@/lib/explore-query-intent':parser,'@/lib/supabase/server':{createSupabaseServerClient:()=>null}});
const empty={version:1,exactSalonName:false,exactOriginalSalonName:false,areaCandidates:[],moreAreaCandidates:false};
const city=(name,stateCode)=>({kind:'city',city:name,stateCode,label:`${name}, ${stateCode}`});
function lookup(data=empty) {
 const calls=[];
 return {calls,rpc:async(name,args)=>{calls.push({name,args});return {data,error:null};}};
}

test('specific English services keep their keyword evidence and service category',()=>{
 for(const [query,category,content] of [
  ['dip powder','Nails','dip powder'],['SNS nails','Nails','sns'],['builder gel','Nails','builder gel'],
  ['builder gel manicure','Nails','builder gel manicure'],['BIAB nails','Nails','biab'],['gel-x nails','Nails','gel-x'],
  ['nail repair','Nails','repair'],['polish change','Nails','polish change'],
  ['balayage','Hair','balayage'],['hair color','Hair','color'],['keratin treatment','Hair','keratin treatment'],
  ['brazilian blowout','Hair','brazilian blowout'],['root touch-up','Hair','root touch-up'],
  ['lash lift','Lashes','lift'],['brow lamination','Brows','lamination'],['microblading','Brows','microblading'],
  ['brazilian wax','Waxing','brazilian wax'],['chemical peel','Spa','chemical peel'],
 ]) {
  const result=parser.parseExploreQueryIntent(query);
  assert.equal(result.queryKind,'service',query);
  assert.equal(result.categoryHint,category,query);
  assert.equal(result.contentQuery,content,query);
  assert.equal(result.query,query,query);
  assert.equal(result.cityQuery,'',query);
  assert.equal(result.categoryOnly,false,query);
 }
});

test('service phrases stay intact before verified city or ZIP and do not demand GPS',async()=>{
 for(const query of ['dip powder Chicago','builder gel Chicago','hair color Chicago','keratin treatment Chicago','balayage Chicago']) {
  const api=lookup({...empty,areaCandidates:[city('Chicago','IL')]});
  const result=await router.resolveExploreQueryRouting({query,location:'Milwaukee, WI',locationSource:'gps',latitude:43.04,longitude:-87.9},api);
  assert.equal(result.query,query.slice(0,-8),query);
  assert.equal(result.queryKind,'service',query);
  assert.equal(result.location,'Chicago, IL',query);
  assert.equal(result.locationOrigin,'query',query);
  assert.equal(result.locationPriority,true,query);
  assert.equal(result.latitude,null,query);
  assert.equal(result.longitude,null,query);
  assert.equal(result.scopePolicy,'fixed',query);
  assert.equal(api.calls.length,1,query);
  assert.equal(api.calls[0].args.p_city_query,'Chicago',query);
 }
 const zip=await router.resolveExploreQueryRouting({query:'dip powder 53222'},lookup());
 assert.equal(zip.query,'dip powder');assert.equal(zip.location,'53222');assert.equal(zip.queryKind,'service');
});

test('known service words cannot consume verified or explicitly named salon brands',async()=>{
 for(const query of ['Dip Powder','SNS Nails','Builder Gel Nails','Balayage','Hair Color Studio','Keratin Treatment']) {
  const quoted=await router.resolveExploreQueryRouting({query:`"${query}"`},lookup());
  assert.equal(quoted.queryKind,'name',query);assert.equal(quoted.query,query);assert.equal(quoted.category,'',query);
  const verified=await router.resolveExploreQueryRouting({query},lookup({...empty,exactSalonName:true,exactOriginalSalonName:true}));
  assert.equal(verified.queryKind,'name',query);assert.equal(verified.query,query);assert.equal(verified.category,'',query);
 }
 for(const query of ['Powder Room','Builder Studio','Color Bar','Keratin House','Dip and Sip','Balayage by Amy','SNS by Alice']) {
  const result=parser.parseExploreQueryIntent(query,{ignoreArea:true});
  assert.equal(result.queryKind,'name',query);assert.equal(result.categoryHint,'',query);
 }
 const full=await router.resolveExploreQueryRouting({query:'Balayage Chicago'},lookup({...empty,exactOriginalSalonName:true,areaCandidates:[city('Chicago','IL')]}));
 assert.equal(full.query,'Balayage Chicago');assert.equal(full.queryKind,'name');assert.equal(full.location,'');
});

test('local service requests use only complete finite coordinate pairs or explicit area',async()=>{
 for(const point of [
  {latitude:43.04}, {longitude:-87.9}, {latitude:91,longitude:-87.9},
  {latitude:43.04,longitude:-181}, {latitude:NaN,longitude:-87.9},
  {latitude:43.04,longitude:Infinity}, {latitude:'43.04',longitude:-87.9},
 ]) {
  const result=await router.resolveExploreQueryRouting({query:'dip powder near me',...point},lookup());
  assert.equal(result.requiresGps,true,JSON.stringify(point));
  assert.equal(result.latitude,null);assert.equal(result.longitude,null);
  assert.equal(result.locationOrigin,'none');
 }
 const gps=await router.resolveExploreQueryRouting({query:'dip powder near me',latitude:43.04,longitude:-87.9},lookup());
 assert.equal(gps.latitude,43.04);assert.equal(gps.longitude,-87.9);assert.equal(gps.category,'Nails');assert.equal(gps.requiresGps,false);
 const manual=await router.resolveExploreQueryRouting({query:'builder gel Chicago',location:'Madison, WI',locationSource:'manual',latitude:43.04,longitude:-87.9},lookup({...empty,areaCandidates:[city('Chicago','IL')]}));
 assert.equal(manual.location,'Madison, WI');assert.equal(manual.locationConflict,true);assert.equal(manual.latitude,null);assert.equal(manual.longitude,null);
 const anywhere=await router.resolveExploreQueryRouting({query:'balayage',locationSource:'none',latitude:43.04,longitude:-87.9},lookup());
 assert.equal(anywhere.latitude,null);assert.equal(anywhere.longitude,null);assert.equal(anywhere.location,'');assert.equal(anywhere.locationPriority,false);
});

test('leading-area proposals require a complete service suffix and preserve existing style and name parsing',()=>{
 for(const [query,service,area] of [
  ['Milwaukee nails','nails','Milwaukee'],['Chicago dip powder','dip powder','Chicago'],
  ['Los Angeles hair color','hair color','Los Angeles'],['Green Bay nails','nails','Green Bay'],
  ['WI nails','nails','WI'],['53202 builder gel','builder gel','53202'],
 ]){
  const proposal=parser.exploreQueryLeadingServiceArea(query);
  assert.equal(proposal.query,service,query);assert.equal(proposal.locationHint,area,query);
 }
 for(const query of ['dip powder','hair color','gel nails','best nail salons','red nails','French gel nails','nails Milwaukee','8333 Main St nails']){
  assert.equal(parser.exploreQueryLeadingServiceArea(query),null,query);
 }
 assert.equal(parser.parseExploreQueryIntent('King Nails').query,'King Nails','the client parser does not guess an unverified city');
});

test('region-first US searches verify their area in the existing single bounded lookup',async()=>{
 for(const [query,service,content,category,name,state] of [
  ['Milwaukee nails','nails','','Nails','Milwaukee','WI'],
  ['Chicago dip powder','dip powder','dip powder','Nails','Chicago','IL'],
  ['Los Angeles hair color','hair color','color','Hair','Los Angeles','CA'],
  ['Green Bay nails','nails','','Nails','Green Bay','WI'],
  ['Milwaukee WI builder gel','builder gel','builder gel','Nails','Milwaukee','WI'],
 ]){
  const api=lookup({...empty,areaCandidates:[city(name,state)]});
  const result=await router.resolveExploreQueryRouting({query,latitude:21.3,longitude:-157.8,locationSource:'gps'},api);
  assert.equal(result.query,content?service:'',query);assert.equal(result.contentQuery,content,query);assert.equal(result.queryKind,'service',query);assert.equal(result.category,category,query);
  assert.equal(result.location,`${name}, ${state}`,query);assert.equal(result.locationOrigin,'query');assert.equal(result.latitude,null);assert.equal(result.longitude,null);assert.equal(result.scopePolicy,'fixed');
  assert.equal(api.calls.length,1,query);assert.equal(api.calls[0].args.p_query,service);assert.equal(api.calls[0].args.p_city_query,name);assert.equal(api.calls[0].args.p_original_query,query);assert.equal(api.calls[0].args.p_limit,8);
 }
 for(const [query,area] of [['WI nails','WI'],['53202 dip powder','53202']]){
  const api=lookup(),result=await router.resolveExploreQueryRouting({query},api);
  assert.equal(result.location,area,query);assert.equal(result.queryKind,'service');assert.equal(api.calls.length,1);
 }
});

test('region-first proposals preserve complete brands and explicit names and never invent unverified cities',async()=>{
 for(const query of ['Milwaukee Nails','Chicago Dip Powder','Los Angeles Hair Color','Milwaukee WI Nails']){
  const api=lookup({...empty,exactOriginalSalonName:true,areaCandidates:[city(query.startsWith('Chicago')?'Chicago':query.startsWith('Los')?'Los Angeles':'Milwaukee',query.startsWith('Chicago')?'IL':query.startsWith('Los')?'CA':'WI')]});
  const result=await router.resolveExploreQueryRouting({query,latitude:43.04,longitude:-87.9,locationSource:'gps'},api);
  assert.equal(result.query,query);assert.equal(result.queryKind,'name');assert.equal(result.category,'');assert.equal(result.location,'');assert.equal(result.areaCandidates.length,0);assert.equal(result.latitude,43.04);assert.equal(api.calls.length,1);
 }
 for(const query of ['"Milwaukee Nails"','salon named Chicago Dip Powder']){
  const api=lookup({...empty,exactSalonName:true,exactOriginalSalonName:true});
  const result=await router.resolveExploreQueryRouting({query},api);
  assert.equal(result.query,query.startsWith('"')?'Milwaukee Nails':'Chicago Dip Powder');assert.equal(result.queryKind,'name');assert.equal(result.location,'');assert.equal(api.calls[0].args.p_city_query,null);assert.equal(api.calls.length,1);
 }
 for(const query of ['Wonderland nails','Wonderland WI nails','Unknown dip powder']){
  const api=lookup(),result=await router.resolveExploreQueryRouting({query,latitude:43.04,longitude:-87.9,locationSource:'gps'},api);
  assert.equal(result.query,query);assert.equal(result.queryKind,'name');assert.equal(result.category,'');assert.equal(result.location,'');assert.equal(result.latitude,43.04);assert.equal(api.calls.length,1);
 }
 const failed=await router.resolveExploreQueryRouting({query:'Milwaukee nails'},{rpc:async()=>({data:null,error:{code:'57014'}})});
 assert.equal(failed.lookupFailed,true,'an unavailable entity proof remains an explicit service error');
});

test('region-first verified areas retain manual priority and replace GPS, saved and activity context',async()=>{
 for(const source of ['gps','saved','activity']){
  const result=await router.resolveExploreQueryRouting({query:'Chicago dip powder',location:'Milwaukee, WI',locationSource:source,latitude:43.04,longitude:-87.9},lookup({...empty,areaCandidates:[city('Chicago','IL')]}));
  assert.equal(result.location,'Chicago, IL');assert.equal(result.locationOrigin,'query');assert.equal(result.latitude,null);assert.equal(result.longitude,null);assert.equal(result.contentQuery,'dip powder');
 }
 const api=lookup({...empty,areaCandidates:[city('Chicago','IL')]}),manual=await router.resolveExploreQueryRouting({query:'Chicago dip powder',location:'Madison, WI',locationSource:'manual',latitude:43.04,longitude:-87.9},api);
 assert.equal(manual.location,'Madison, WI');assert.equal(manual.locationOrigin,'manual');assert.equal(manual.locationConflict,true);assert.equal(manual.queryLocationHint,'Chicago, IL');assert.equal(manual.latitude,null);assert.equal(manual.longitude,null);assert.equal(manual.query,'dip powder');assert.equal(api.calls.length,1);
});
