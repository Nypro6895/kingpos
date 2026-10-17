import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
function load(file,deps={}){const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(file,'utf8'),{loader:file.endsWith('tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,DOMException,URLSearchParams,require:name=>deps[name],console:{warn(){}}});return module.exports;}
function page(workspace={label:'Milwaukee, WI',source:'activity'}){
 const calls=[];const areas={Chicago:'IL',Milwaukee:'WI'};
 const parser=load('lib/explore-query-intent.ts');
 const client={rpc(name,args){calls.push({name,args});const stateCode=areas[args.p_city_query];return Promise.resolve({data:{version:1,exactSalonName:false,areaCandidates:stateCode?[{kind:'city',city:args.p_city_query,stateCode,label:`${args.p_city_query}, ${stateCode}`}]:[]},error:null});}};
 const router=load('lib/explore-query-routing.ts',{'server-only':{},'@/lib/explore-query-intent':parser,'@/lib/supabase/server':{createSupabaseServerClient:()=>client}});
 const home={error:null,recommendedSalons:[],newSalons:[],popularServices:[],inspiration:{items:[],hasMore:false,nextCursor:null,error:null}};
 const deps={
  'react':{Suspense:'Suspense'},
  '@/components/experience-page':{withExperiencePage:Page=>Page},
  '@/app/explore/explore-startup-shell':{ExploreStartupShell:'ExploreStartupShell'},
  '@/app/explore/explore-progressive-client':{ExploreProgressiveClient:'ExploreProgressiveClient'},
  '@/lib/explore-startup-feed-server':{prepareExploreStartupFeed:async()=>null},
  '@/lib/bounded-get':{runReadWithDeadline:promise=>promise},
  'react/jsx-runtime':{Fragment:'fragment',jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})},
  '@/app/explore/explore-client':{ExploreClient:'ExploreClient'},
  '@/lib/request-business-context':{getRequestBusinessContext:async()=>({user:null})},
  '@/lib/explore-comment-identity':{exploreCommentIdentity:()=>null},
  '@/lib/explore-query-routing':router,
  '@/lib/explore-search':{EXPLORE_PAGE_SIZE:12,getExploreWorkspaceLocation:async()=>workspace,searchExploreSalons:async(input,options)=>{calls.push({name:'search',input,options});return {query:input.query,category:input.category,location:input.location,page:input.page,pageSize:12,results:[],sections:{bestMatches:[],nearby:[],recommended:[]},...options.routing};}},
  '@/lib/explore-feed':{emptyFeedPage:()=>({items:[],hasMore:false,nextCursor:null,error:null})},
  '@/lib/explore-home':{emptyHomeContent:()=>home,getExploreHomeContent:async()=>{calls.push({name:'home'});return home;}},
  '@/lib/explore-showcase-content':{enrichExploreShowcaseContent:value=>value},
  '@/lib/reylumi-trust':{},'@/lib/routes':{},'@/lib/search-normalization':{},'@/lib/customer-bookings':{},'@/lib/app-notifications':{},'@/lib/permissions':{},
  'next/navigation':{redirect:location=>{throw Object.assign(new Error('redirect'),{location});}},
 };
 deps['@/lib/explore-discovery-presentation']=load('lib/explore-discovery-presentation.ts',deps);
 deps['@/lib/explore-page-resource-server']=load('lib/explore-page-resource-server.ts',deps);
 return {render:load('app/(app)/explore/page.tsx',deps).default,calls};
}
const client=async result=>{const content=await result.props.children.type(result.props.children.props);const streamed=content.props.children;return {...streamed,props:streamed.props.initial};};
test('SSR uses the same current-area router once and reuses canonical values for directory execution',async()=>{
 const api=page();const result=await client(await api.render({searchParams:Promise.resolve({q:'nails near Chicago'})}));
 assert.equal(api.calls.filter(call=>call.name==='get_public_explore_query_entities').length,1);
 const search=api.calls.find(call=>call.name==='search');assert.equal(search.input.query,'');assert.equal(search.input.location,'Chicago, IL');assert.equal(search.input.category,'Nails');assert.equal(search.input.scopePolicy,'fixed');
 assert.equal(search.options.routing.displayQuery,'nails near Chicago');assert.equal(result.props.initialLocationSource,'manual');assert.equal(result.props.hasUrlLocation,true);assert.equal(result.props.initialSearchMode,true);
 assert.ok(!api.calls.some(call=>call.name==='home'),'explicit searches avoid unrelated home aggregation');
});
test('SSR manual field wins conflicting phrases; contextual source may be overridden, and explicit scope/target are preserved',async()=>{
 const manual=page();let result=await client(await manual.render({searchParams:Promise.resolve({q:'King Nails near Chicago',location:'Madison, WI',scope:'expandable'})}));
 assert.equal(result.props.initialResponse.location,'Madison, WI');assert.equal(result.props.initialResponse.locationConflict,true);assert.equal(result.props.initialResponse.scopePolicy,'expandable');
 const context=page();result=await client(await context.render({searchParams:Promise.resolve({q:'Chicago',location:'Milwaukee, WI',locationSource:'saved'})}));
 assert.equal(result.props.initialResponse.location,'Chicago, IL');assert.equal(result.props.initialResponse.query,'');assert.equal(result.props.initialResponse.locationOrigin,'query');
 const posts=page();result=await client(await posts.render({searchParams:Promise.resolve({q:'christmas nail design',type:'posts'})}));
 assert.equal(result.props.initialResponse.target,'salons');assert.equal(result.props.initialResponse.contentQuery,'christmas');assert.equal(result.props.initialResponse.category,'Nails');assert.ok(result.key.includes('salons:christmas'));
});
test('legacy numbered URLs restart without dropping query, selected target or contextual source',async()=>{
 const api=page();await assert.rejects(api.render({searchParams:Promise.resolve({q:'nails near Chicago',page:'1000000',type:'posts',locationSource:'activity',scope:'fixed'})}),error=>{
  const url=new URL(error.location,'https://example.test');assert.equal(url.pathname,'/explore');assert.equal(url.searchParams.get('page'),null);assert.equal(url.searchParams.get('q'),'nails near Chicago');assert.equal(url.searchParams.get('type'),'salons');assert.equal(url.searchParams.get('scope'),'fixed');assert.equal(url.searchParams.get('locationSource'),'activity');return true;
 });assert.equal(api.calls.length,0);
});


test('SSR forwards structured style filters to the same salon search for legacy URLs',async()=>{
 const api=page();await client(await api.render({searchParams:Promise.resolve({q:'red nails',type:'posts',shape:'stiletto',color:'red',maxPrice:'65',bookableOnly:'true'})}));
 const call=api.calls.find(call=>call.name==='search');assert.equal(call.input.target,'salons');assert.equal(call.input.filters.shape,'stiletto');assert.equal(call.input.filters.color,'red');assert.equal(call.input.filters.maxPrice,65);assert.equal(call.input.filters.bookableOnly,true);
});

test('SSR Anywhere remains global after reload and still accepts typed ZIP or place',async()=>{
 for(const params of [{q:'red nail',locationSource:'none'},{q:'red nail',location:'',locationSource:'none'}]) {
  const api=page();const result=await client(await api.render({searchParams:Promise.resolve(params)}));
  assert.equal(result.props.initialResponse.location,'');assert.equal(result.props.initialResponse.locationOrigin,'none');
  assert.equal(result.props.initialResponse.requiresGps,false);assert.equal(result.props.initialLocationSource,'none');
 }
 for(const [q,location] of [['53222','53222'],['nails near wa','WA'],['Milwaukee','Milwaukee, WI']]) {
  const api=page();const result=await client(await api.render({searchParams:Promise.resolve({q,location:'',locationSource:'none'})}));
  assert.equal(result.props.initialResponse.location,location);assert.equal(result.props.initialResponse.locationOrigin,'query');assert.equal(result.props.initialResponse.requiresGps,false);
 }
 const api=page();const result=await client(await api.render({searchParams:Promise.resolve({q:'nails near me',locationSource:'none'})}));
 assert.equal(result.props.initialResponse.location,'');assert.equal(result.props.initialResponse.requiresGps,true,'the workspace must not undo an explicit Anywhere selection');
});
