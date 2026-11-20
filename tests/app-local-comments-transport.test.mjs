import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function load(path, modules={}, globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>modules[name]??{},URL,URLSearchParams,Request,Response,Headers,DOMException,AbortController,setTimeout,clearTimeout,...globals});return exports;
}
const sourceId='5fae8903-19f6-4da4-978c-8fa849312114';
const query=`sourceType=salon_profile_look&sourceId=${sourceId}&offset=0&pageSize=10`;
function harness({native=true,scope='account',resultScope='account',status=200}={}) {
 let originals=0,reads=0,commands=0;
 const host={isNative:native,read:async(name,args,options)=>{reads++;assert.equal(name,'http.explore.post-comments');assert.equal(args.sourceId,sourceId);assert.equal(options.scope,'account');return {scope:resultScope,data:{status,headers:{'content-type':'application/json'},body:JSON.stringify(status===200?{items:[],error:null}:{error:'Unavailable'})}}},command:()=>{commands++;throw Error('Unexpected mutation')}};
 const api=load('lib/app-local-explore-http-client.ts',{}, {location:{href:'reylumi-app://bundle/explore'}});
 const fetch=api.createAppLocalExploreHttpFetch({scope:()=>scope,host:()=>host,fetch:async()=>{originals++;throw new TypeError('Unsupported local API URL')}});
 return {fetch,counts:()=>({originals,reads,commands})};
}
test('installed iOS comment reader crosses native bridge instead of fetching the bundle scheme',async()=>{
 const h=harness();const reader=load('lib/post-comments-client.ts',{}, {fetch:h.fetch});
 const page=await reader.fetchPostCommentsPage({target:{sourceType:'salon_profile_look',sourceId},offset:0,pageSize:10});
 assert.equal(page.error,null);assert.equal(page.items.length,0);assert.deepEqual(h.counts(),{originals:0,reads:1,commands:0});
});
test('native comment requests preserve HTTP errors and reject changed scopes',async()=>{
 const h=harness({status:503});assert.equal((await h.fetch('/api/post-comments?'+query)).status,503);
 await assert.rejects(harness({resultScope:'other'}).fetch('/api/post-comments?'+query),/account has changed/);
 await assert.rejects(harness({scope:''}).fetch('/api/post-comments?'+query));
});
test('native comment bridge validates query, cancellation and exact destination',async()=>{
 const h=harness();
 await assert.rejects(h.fetch('/api/post-comments?'+query+'&sourceId=duplicate'),/Unsupported/);
 await assert.rejects(h.fetch('/api/post-comments?'+query+'&extra=1'),/Unsupported/);
 const controller=new AbortController();controller.abort();await assert.rejects(h.fetch('/api/post-comments?'+query,{signal:controller.signal}));
 await assert.rejects(h.fetch('https://example.com/api/post-comments?'+query),/Unsupported local/);
 await assert.rejects(h.fetch('/api/post-comments?'+query,{method:'POST'}),/Unsupported local/);
 assert.deepEqual(h.counts(),{originals:2,reads:0,commands:0});
});
test('browser comment requests retain ordinary fetch',async()=>{
 const h=harness({native:false});await assert.rejects(h.fetch('/api/post-comments?'+query),/Unsupported local/);assert.deepEqual(h.counts(),{originals:1,reads:0,commands:0});
});
test('server bridge invokes original comment route only after scope check',async()=>{
 let calls=0;const api=load('lib/app-local-explore-server.ts',{
 'node:crypto':{createHash},'next/server':{NextRequest:Request},'next/headers':{headers:async()=>new Headers()},
 './request-business-context':{getRequestBusinessContext:async()=>({})},'./experience-context':{getExperienceContext:()=>({scope:'account'})},
 '@/app/api/post-comments/route':{GET:async request=>{calls++;assert.equal(new URL(request.url).searchParams.get('sourceId'),sourceId);return Response.json({items:[],error:null},{headers:{'Cache-Control':'private, no-store'}})}}
 });
 const args=Object.fromEntries(new URLSearchParams(query));const result=await api.readAppLocalExploreResource('http.explore.post-comments',args,{scope:'account'});
 assert.equal(result.data.status,200);assert.equal(result.data.headers['cache-control'],'private, no-store');
 await assert.rejects(api.readAppLocalExploreResource('http.explore.post-comments',args,{scope:'other'}),/account has changed/);
 await assert.rejects(api.readAppLocalExploreResource('http.explore.post-comments',{...args,extra:'1'},{scope:'account'}),/Unsupported/);
 assert.equal(calls,1);
});
test('comment read is declared transient in the native manifest policy',()=>{
 const meta=load('lib/app-local-explore-metadata.ts');assert.equal(meta.APP_LOCAL_EXPLORE_READS.find(row=>row.name==='http.explore.post-comments').retain,false);
});
