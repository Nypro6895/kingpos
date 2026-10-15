import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.createSourceFile('explore-client.tsx',readFileSync('app/explore/explore-client.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(name){let found;const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);};visit(source);assert.ok(found,`actual ${name} exists`);return found.getText(source);}
const names=['findGpsArea','hasResolvedGpsArea','recoverUnresolvedGps','prepareSearchTransition','runGpsSearch','runHomeNearYou'];
const code=ts.transpileModule(names.map(declaration).join('\n')+'\nglobalThis.actions={'+names.join(',')+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const coordinates={latitude:43.0389,longitude:-87.9065},area={label:'Milwaukee, WI',city:'Milwaukee',state:'WI',source:'gps'};
function harness({sessionLocation='Madison, WI',source='activity',providerFails=true,searchFails=true,typedError=false,committedScope,initialScope='expandable'}={}){
 const calls=[],state={GpsCoordinates:coordinates,GpsResponse:{nextCursor:{session:'former-gps'}},NearYouSalons:[{id:'former',city:'Chicago',state:'IL'}],Location:'Chicago, IL',LocationSource:'gps'};
 const frozen={query:'nail',displayQuery:'nail',location:sessionLocation,locationSource:source==='gps'?'none':source,nextCursor:{session:'frozen-original',after:12}};
 const activeResponse={...frozen,...(committedScope?{scope:{policy:committedScope}}:{})};
 const context={AbortController,URLSearchParams,commentViewer:{userId:null},Date:{now:()=>1_000_000},gpsArea:{current:null},gpsRequestVersion:{current:4},gpsRequest:{current:null},query:'nail',normalizedCategory:'Nails',searchOrderMode:'relevance',searchTarget:'auto',initialResponse:{pageSize:12,scope:{policy:initialScope}},activeResponse,sessionResponse:frozen,initialLocationSource:source,pathname:'/explore',
  searchParams:new URLSearchParams('q=nail&location=Milwaukee%2C+WI&locationSource=gps&page=2&type=salons'),
  fetchExploreGpsArea:async(point,signal)=>{calls.push({kind:'area',point,signal});if(providerFails)throw new Error('Area provider unavailable');return area;},
  fetchExploreSearchPage:async(input,signal)=>{calls.push({kind:'search',input,signal});if(searchFails)throw new TypeError('Failed to fetch');return {error:typedError?'Search took too long':null,location:area.label,locationSource:'gps',locationOrigin:'context',category:'Nails',results:[]};},
  rememberSearchUrl:(...args)=>calls.push({kind:'history',args}),startTransition:fn=>fn(),router:{push:(url,options)=>calls.push({kind:'navigate',url,options})},
 };
 for(const name of ['GpsCoordinates','GpsResponse','NearYouSalons','Location','LocationSource','GpsMessage','GpsStatus','ActiveDiscoveryResult','Category','ExplicitSearchMode','CommittedGpsContext','SearchOrderMode'])context[`set${name}`]=value=>{state[name]=value;};
 vm.runInNewContext(code,context);
 return {actions:context.actions,state,calls,frozen,activeResponse,cache:context.gpsArea};
}
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,DOMException,require:name=>name==='server-only'?{}:deps[name]});return exports;}
test('an unresolved GPS area clears transient coordinates/results and restores the frozen original regional session',async()=>{
 const api=harness();await api.actions.runGpsSearch(coordinates);
 assert.equal(api.state.GpsCoordinates,null);assert.equal(api.state.GpsResponse,null);assert.equal(api.state.NearYouSalons.length,0);assert.equal(api.state.Location,api.frozen.location);assert.equal(api.state.LocationSource,'activity');
 assert.equal(api.state.GpsMessage,"We couldn't find your area. Choose a location or try again.");assert.equal(api.state.GpsStatus,'idle');assert.equal(api.frozen.nextCursor.session,'frozen-original');
 assert.equal(api.calls.filter(call=>call.kind==='search').length,0,'failed area provider never launches a location-bound salon query');assert.equal(api.calls.filter(call=>call.kind==='navigate').length,0,'recovery alone does not replace the original cursor through navigation');
 const gpsSource=harness({source:'gps'});await gpsSource.actions.runHomeNearYou(coordinates);assert.equal(gpsSource.state.LocationSource,'none');assert.equal(gpsSource.state.GpsCoordinates,null);assert.equal(gpsSource.state.Location,gpsSource.frozen.location);
});
test('newly typed Chicago leaves failed GPS through ordinary SSR navigation and reaches the real current-area resolver',async()=>{
 const api=harness();await api.actions.runGpsSearch(coordinates,1,'Chicago');
 const navigation=api.calls.find(call=>call.kind==='navigate');assert.ok(navigation);const url=new URL(navigation.url,'https://example.test');
 assert.equal(url.searchParams.get('q'),'Chicago');assert.equal(url.searchParams.get('location'),'Madison, WI');assert.equal(url.searchParams.get('locationSource'),'activity');assert.equal(url.searchParams.get('page'),null);
 assert.equal(api.state.GpsCoordinates,null);assert.equal(api.state.GpsResponse,null);
 const parser=load('lib/explore-query-intent.ts'),lookup=[];
 const router=load('lib/explore-query-routing.ts',{'@/lib/explore-query-intent':parser,'@/lib/supabase/server':{createSupabaseServerClient:()=>null}});
 const result=await router.resolveExploreQueryRouting({query:url.searchParams.get('q'),location:url.searchParams.get('location'),locationSource:url.searchParams.get('locationSource')},{rpc:async(name,args)=>{lookup.push({name,args});return {data:{version:1,exactSalonName:false,areaCandidates:[{kind:'city',city:'Chicago',stateCode:'IL',label:'Chicago, IL'}]},error:null};}});
 assert.equal(result.location,'Chicago, IL');assert.equal(result.locationOrigin,'query');assert.equal(result.query,'');assert.equal(result.latitude,null);assert.equal(result.requiresGps,false);assert.equal(result.lookupFailed,false);assert.equal(lookup[0].args.p_city_query,'Chicago');
});
test('a valid resolved area remains usable when only the following search fails, with no recovery navigation',async()=>{
 const api=harness({providerFails:false});await api.actions.runGpsSearch(coordinates,1,'Chicago');
 assert.equal(api.cache.current.area,area);assert.equal(api.state.GpsCoordinates,coordinates);assert.equal(api.state.GpsResponse.nextCursor.session,'former-gps');assert.equal(api.state.LocationSource,'gps');assert.equal(api.state.GpsMessage,"We couldn't load nearby salons. Please try again.");assert.equal(api.state.GpsStatus,'idle');assert.equal(api.calls.filter(call=>call.kind==='navigate').length,0);
 assert.equal(api.state.NearYouSalons.length,0,'a new search cannot retain nearby cards from the previous GPS area');
 assert.equal(api.calls.find(call=>call.kind==='search').input.location,'Milwaukee, WI');assert.equal(api.calls.find(call=>call.kind==='search').input.latitude,coordinates.latitude);
 const typed=harness({providerFails:false,searchFails:false,typedError:true});await typed.actions.runGpsSearch(coordinates);
 assert.equal(typed.state.GpsCoordinates,coordinates);assert.equal(typed.state.Location,'Milwaukee, WI');assert.equal(typed.state.GpsResponse.error,'Search took too long');assert.equal(typed.state.LocationSource,'gps');assert.equal(typed.calls.filter(call=>call.kind==='navigate').length,0);
 const home=harness({providerFails:false});assert.equal(home.state.NearYouSalons[0].city,'Chicago');await home.actions.runHomeNearYou(coordinates);
 assert.equal(home.state.Location,'Milwaukee, WI');assert.equal(home.cache.current.area,area);assert.equal(home.state.GpsCoordinates,coordinates);assert.equal(home.state.NearYouSalons.length,0,'home cannot display prior-city cards under a newly resolved location after a network failure');
 assert.equal(home.state.GpsMessage,"We couldn't load nearby salons. Please try again.");assert.equal(home.state.GpsStatus,'idle');assert.equal(home.calls.filter(call=>call.kind==='navigate').length,0);
});
test('the resolved-area guard accepts only fresh coordinates from the same GPS point',()=>{
 const api=harness();api.cache.current={coordinates,area,timestamp:999_000};assert.equal(api.actions.hasResolvedGpsArea(coordinates),true);
 assert.equal(api.actions.hasResolvedGpsArea({...coordinates,latitude:44}),false);api.cache.current.timestamp=400_000;assert.equal(api.actions.hasResolvedGpsArea(coordinates),false);
});

test('GPS auto, header and sort searches preserve the committed fixed scope when no override is supplied',async()=>{
 const invocations=[[],[1,'pedicure'],[1,'nail','closest'],[1,'nail','relevance','Nails','auto',undefined]];
 for(const args of invocations){
  const api=harness({providerFails:false,searchFails:false,committedScope:'fixed',initialScope:'expandable'});
  await api.actions.runGpsSearch(coordinates,...args);
  const request=api.calls.find(call=>call.kind==='search');assert.ok(request);
  assert.equal(request.input.scopePolicy,'fixed','current committed response wins over the older initial response');
  assert.equal(request.input.locationSource,'gps');assert.equal(request.input.latitude,coordinates.latitude);
  assert.equal(api.calls.find(call=>call.kind==='history').args[3],'fixed','refresh URL keeps the same committed scope');
 }
});

test('GPS defaults remain expandable when committed scope is expandable or absent',async()=>{
 for(const committedScope of ['expandable',undefined]){
  const api=harness({providerFails:false,searchFails:false,committedScope,initialScope:'fixed'});
  await api.actions.runGpsSearch(coordinates);
  assert.equal(api.calls.find(call=>call.kind==='search').input.scopePolicy,'expandable');
  assert.equal(api.calls.find(call=>call.kind==='history').args[3],'expandable');
 }
 const changing=harness({providerFails:false,searchFails:false,committedScope:'expandable'});
 await changing.actions.runGpsSearch(coordinates);
 changing.activeResponse.scope.policy='fixed';
 await changing.actions.runGpsSearch(coordinates);
 assert.equal(changing.calls.filter(call=>call.kind==='search').at(-1).input.scopePolicy,'fixed','next invocation reads the newly committed scope');
});

test('an explicit GPS scope selection overrides either committed policy without changing search inputs',async()=>{
 for(const [committedScope,chosenScope] of [['fixed','expandable'],['expandable','fixed']]){
  const api=harness({providerFails:false,searchFails:false,committedScope});
  await api.actions.runGpsSearch(coordinates,1,'gold ideas','closest','Hair','posts',chosenScope);
  const request=api.calls.find(call=>call.kind==='search').input;
  assert.equal(request.scopePolicy,chosenScope);assert.equal(request.query,'gold ideas');assert.equal(request.category,'Hair');
  assert.equal(request.target,'posts');assert.equal(request.sort,'closest');assert.equal(request.location,area.label);
  assert.equal(request.latitude,coordinates.latitude);assert.equal(request.longitude,coordinates.longitude);
  assert.equal(api.calls.find(call=>call.kind==='history').args[3],chosenScope);
 }
});

test('a completed GPS response commits its own coordinates for Ideas and clears eligibility on a typed search error',async()=>{
 const api=harness({providerFails:false,searchFails:false});await api.actions.runGpsSearch(coordinates,1,'Christmas nail design','relevance','Nails','posts','fixed');
 assert.equal(api.state.CommittedGpsContext.response,api.state.GpsResponse);
 assert.equal(api.state.CommittedGpsContext.coordinates.latitude,coordinates.latitude);
 assert.equal(api.state.CommittedGpsContext.coordinates.longitude,coordinates.longitude);
 const failed=harness({providerFails:false,searchFails:false,typedError:true});await failed.actions.runGpsSearch(coordinates);
 assert.equal(failed.state.CommittedGpsContext,null,'an error response cannot bind a new feed to this GPS point');
});
