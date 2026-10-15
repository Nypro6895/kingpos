import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const salon='10000000-0000-4000-8000-000000000001';
function moduleAt(file,imports) {
 imports={'@/components/experience-page':{withExperiencePage:page=>page},...imports};
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Buffer,URLSearchParams,Response,console,require:name=>{assert.ok(Object.hasOwn(imports,name),`unexpected import ${name}`);return imports[name];}});
 return exports;
}
function helpers(rows=[],error=null) {
 const calls=[];
 const service=moduleAt('lib/explore-reference-favorites.ts',{
  '@/lib/nail-inspiration-catalog':moduleAt('lib/nail-inspiration-catalog.ts',{}),
  'server-only':{},'@/lib/supabase/server':{createSupabaseServerClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:rows,error};}})},
  '@/lib/explore-showcase-content':{getExploreShowcaseLookPage:id=>id==='showcase-look-1'?{id,salonName:'Preview Salon',service:'Manicure'}:null},
 });
 return {service,calls};
}
const fakeJsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
function elements(tree) {return Array.isArray(tree)?tree.flatMap(elements):tree&&typeof tree==='object'?[tree,...[].concat(tree.props?.children??[]).flatMap(elements)]:[];}

test('directory favorites use bounded current DB references and cannot fall back to deleted static names',async()=>{
 const {service,calls}=helpers([{listing_id:'wi-visible',salon_id:salon,salon_name:'Current Salon Name'},{listing_id:'unrequested',salon_id:salon,salon_name:'Unexpected'},{listing_id:'wi-unsafe',salon_id:'https://bad.test',salon_name:'Unsafe'}]);
 const response=await service.resolveReferenceFavorites(['directory:wi-visible','directory:wi-deleted','directory:wi-unsafe','look:showcase-look-1','salon:showcase-1','directory:wi-visible']);
 assert.equal(response.error,null);
 assert.deepEqual(JSON.parse(JSON.stringify(response.items)),[
  {key:'directory:wi-visible',name:'Current Salon Name',href:`/explore/salons/${salon}`},
  {key:'look:showcase-look-1',name:'Manicure · Preview Salon',href:'/explore/looks/showcase-look-1'},
  {key:'salon:showcase-1',name:'Preview Salon',href:'/explore/looks/showcase-look-1'},
 ]);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'get_public_explore_directory_references',args:{p_listing_ids:['wi-visible','wi-deleted','wi-unsafe']}}]);
 assert.equal(await service.referenceFavorite('directory:wi-deleted'),null);
 assert.equal((await service.resolveReferenceFavorites(Array(41).fill('directory:wi-visible'))).items.length,0);
 const unavailable=helpers([], {code:'57014'});
 const failed=await unavailable.service.resolveReferenceFavorites(['directory:wi-visible','look:showcase-look-1']);
 assert.ok(failed.error); assert.equal(failed.items.length,1,'valid showcase previews remain available during a DB failure');
 for(const key of ['directory:../../secret','directory:wi,or(status.eq.active)','https://evil.test','directory:']) assert.equal(service.validReferenceFavoriteKey(key),false);
 const cursor={createdAt:'2026-10-09T15:00:00.123456+00:00',itemKey:'directory:wi-visible'};
 assert.deepEqual(JSON.parse(JSON.stringify(service.referenceFavoriteCursor(service.encodeReferenceFavoriteCursor(cursor)))),cursor,'cursor preserves database timestamp precision');
 assert.equal(service.referenceFavoriteCursor(service.encodeReferenceFavoriteCursor({...cursor,itemKey:'directory:wi),or(user_id.neq.me)'})),null);
 assert.equal(service.referenceFavoriteCursor('broken'),null);
});

test('legacy Wisconsin routes redirect into fixed indexed search, hide removed details, and retire the ungated export',async()=>{
 const redirect=url=>{throw Object.assign(new Error('redirect'),{url});};
 const index=moduleAt('app/(app)/explore/wisconsin/page.tsx',{'next/navigation':{redirect}});
 await assert.rejects(index.default({searchParams:Promise.resolve({})}),error=>error.url==='/explore?location=WI&scope=fixed');
 await assert.rejects(index.default({searchParams:Promise.resolve({q:'King Nails',city:'Madison',category:'Nails',page:'999'})}),error=>{
  const url=new URL(error.url,'https://reylumi.com');
  return url.searchParams.get('location')==='Madison, WI'&&url.searchParams.get('scope')==='fixed'&&url.searchParams.get('q')==='King Nails'&&url.searchParams.get('category')==='Nails'&&!url.searchParams.has('page');
 });
 const {service}=helpers([{listing_id:'wi-visible',salon_id:salon,salon_name:'Visible'}]);
 const detail=moduleAt('app/(app)/explore/wisconsin/[businessId]/page.tsx',{'next/navigation':{redirect,notFound:()=>{throw new Error('not found');}},'@/lib/explore-reference-favorites':service});
 await assert.rejects(detail.default({params:Promise.resolve({businessId:'wi-visible'})}),error=>error.url===`/explore/salons/${salon}`);
 await assert.rejects(detail.default({params:Promise.resolve({businessId:'wi-deleted'})}),/not found/);
 const failed=moduleAt('app/(app)/explore/wisconsin/[businessId]/page.tsx',{'next/navigation':{redirect,notFound:()=>{throw new Error('not found');}},'@/lib/explore-reference-favorites':helpers([],{code:'57014'}).service});
 await assert.rejects(failed.default({params:Promise.resolve({businessId:'wi-visible'})}),/could not be loaded/,'query failure is not presented as a missing salon');
 const route=moduleAt('app/api/explore/wisconsin/export/route.ts',{});
 const response=await route.GET();
 assert.equal(response.status,410);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.equal(body.exploreHref,'/explore?location=WI&scope=fixed');assert.equal(body.businesses,undefined);
});

test('favorite actions await visibility before saving but allow removing a stale deleted reference',async()=>{
 let visible=false,resolved=0,writes=0,removed=0;const savedActors=[];
 const resultQuery={eq(){return this;},maybeSingle:async()=>({data:{item_key:'directory:wi-visible'},error:null})};
 const client={from:()=>({select:()=>resultQuery,upsert:async row=>{writes++;savedActors.push(row.user_id);return{error:null};},delete:()=>({eq(){removed++;return this;},then:resolve=>resolve({error:null})})})};
 const actions=moduleAt('app/explore/account-actions.ts',{
  '@/lib/supabase/server':{getSupabaseAuthUser:async()=>({id:'different-auth-uuid'}),createAuthenticatedSupabaseServerClient:async()=>({rpc:async()=>({data:salon,error:null})})},'next/cache':{revalidatePath:()=>{}},
  '@/lib/explore-advertising':{advertisingClient:()=>client},'@/lib/explore-reference-favorites':{validReferenceFavoriteKey:helpers().service.validReferenceFavoriteKey,resolveReferenceFavorites:async()=>{resolved++;await Promise.resolve();return{items:visible?[{key:'directory:wi-visible'}]:[],error:null};}},
 });
 assert.match((await actions.referenceLoveAction('directory:wi-visible',true)).error,/unavailable/);assert.equal(writes,0);
 visible=true;assert.equal((await actions.referenceLoveAction('directory:wi-visible',true)).error,null);assert.equal(writes,1);
 assert.deepEqual(savedActors,[salon],'writes use the mapped public user rather than the different auth UUID');
 visible=false;const before=resolved;
 assert.equal((await actions.referenceLoveAction('directory:wi-visible',false)).error,null);assert.equal(resolved,before);assert.ok(removed>0);
 assert.match((await actions.referenceLoveAction('directory:../../secret',true)).error,/unavailable/);assert.equal(writes,1);
});

test('favorites fetch one indexed page and batch only the displayed keys, retaining a cursor past removed entries',async()=>{
 const rows=Array.from({length:21},(_,n)=>({item_key:`directory:wi-${n}`,created_at:'2026-10-09T15:00:00.123456+00:00'}));
 const {service,calls}=helpers([{listing_id:'wi-1',salon_id:salon,salon_name:'Current Visible'}]);
 const queryCalls=[];
 const page=moduleAt('app/(app)/explore/favorites/page.tsx',{
  '@/lib/nail-inspiration-catalog':moduleAt('lib/nail-inspiration-catalog.ts',{}),'@/app/explore/nail-inspiration':{NailInspirationCard:'NailCard'},
  'react/jsx-runtime':fakeJsx,'next/link':{default:'Link'},'next/navigation':{redirect:()=>{}},'@/components/explore-account-actions':{ExploreReferenceLove:'Love'},
  '@/lib/supabase/server':{getSupabaseAuthUser:async()=>({id:'different-auth-uuid'}),createAuthenticatedSupabaseServerClient:async()=>({rpc:async(name,args)=>{queryCalls.push({name,args});return{data:rows,error:null};}})},'@/lib/explore-reference-favorites':service,
 });
 const tree=await page.default({searchParams:Promise.resolve({})});
 assert.equal(queryCalls[0].name,'get_my_explore_reference_favorites');assert.equal(queryCalls[0].args.p_limit,20);
 assert.equal(queryCalls[0].args.p_before_item_key,null,'no caller-controlled user identity is passed');
 assert.equal(calls[0].args.p_listing_ids.length,20);assert.ok(!calls[0].args.p_listing_ids.includes('wi-20'));
 const nodes=elements(tree), articles=nodes.filter(node=>node.type==='article');
 assert.equal(articles.length,1,'removed or unlinked records are omitted rather than restored from static JSON');
 const next=nodes.find(node=>node.props?.href?.startsWith('/explore/favorites?after='));assert.ok(next);
 const cursor=service.referenceFavoriteCursor(next.props.href.split('after=')[1]);assert.equal(cursor.itemKey,'directory:wi-19');
 queryCalls.length=0;await page.default({searchParams:Promise.resolve({after:service.encodeReferenceFavoriteCursor(cursor)})});
 assert.equal(queryCalls[0].args.p_before_item_key,'directory:wi-19');assert.equal(queryCalls[0].args.p_before_created_at,cursor.createdAt);
});
