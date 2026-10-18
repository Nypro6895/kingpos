import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(file,deps={},globals={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URLSearchParams,AbortController,setTimeout,clearTimeout,require:name=>deps[name],...globals});return exports;}
const parser=load('lib/explore-query-intent.ts');
const helpers=load('lib/explore-search-suggestions.ts',{'@/lib/explore-query-intent':parser});
test('suggestions retain meaningful styles, obey explicit category, cap metadata and do not invent business rows',()=>{
 const french=helpers.mergeExploreSearchSuggestions([],helpers.normalizeExploreSuggestionRequest({query:'Fre',category:'Nails'}));
 assert.equal(french[0].kind,'idea');assert.equal(french[0].query,'French nail design');assert.equal(french[0].target,'salons');
 assert.equal(helpers.mergeExploreSearchSuggestions([], {query:'French',category:'Hair'}).length,0);
 assert.equal(helpers.mergeExploreSearchSuggestions([], {query:'anything absent',category:''}).length,0);
 const many=Array.from({length:99},(_,i)=>({id:'salon-'+i,kind:'salon',label:'Nail Salon '+i,detail:'Milwaukee, WI',secret:'ignored'}));
 const rows=helpers.mergeExploreSearchSuggestions(many,{query:'nail',category:'Nails'});
 assert.ok(rows.length<=8);assert.ok(rows.every(row=>!('secret'in row)));
 const normalized=helpers.normalizeExploreSuggestionRequest({query:'a'.repeat(200),location:'Milwaukee, WI',category:'All'});
 assert.equal(normalized.query.length,80);assert.equal(normalized.city,'Milwaukee');assert.equal(normalized.state,'WI');assert.equal(normalized.category,'');
});

function api(client){const calls=[];const module=load('app/api/explore/suggestions/route.ts',{'next/server':{NextResponse:class extends Response {static json(body,init){return {body,...init};}}},'@/lib/explore-search-suggestions':helpers,'@/lib/supabase/server':{createSupabaseServerClient:()=>client?.(calls)}});return{...module,calls};}
function request(q,signal=new AbortController().signal){return {nextUrl:new URL('https://reylumi.com/api/explore/suggestions?'+new URLSearchParams(q)),signal};}
test('typing reads at most one metadata RPC, never a search/feed session or public profile',async()=>{
 const run=api(calls=>({rpc(name,args){calls.push({name,args});return{abortSignal:async()=>({data:[{kind:'salon',id:'salon-a',label:'King Nails',detail:'Milwaukee, WI'}],error:null})};}}));
 const one=await run.GET(request({q:'K'}));assert.equal(one.body.suggestions.length,0);assert.equal(run.calls.length,0);
 const response=await run.GET(request({q:'King',location:'Milwaukee, WI',category:'Nails'}));
 assert.equal(run.calls.length,1);assert.equal(run.calls[0].name,'get_public_explore_search_suggestions');assert.equal(run.calls[0].args.p_limit,8);assert.equal(run.calls[0].args.p_city,'Milwaukee');
 assert.equal(response.body.suggestions[0].query,'King Nails');assert.equal(response.headers['Cache-Control'],'private, no-store');
});
test('suggestion failure preserves useful static styles and aborted requests return no false suggestions',async()=>{
 const failed=api(()=>({rpc(){return{abortSignal:async()=>({data:null,error:{code:'57014'}})};}}));
 assert.equal((await failed.GET(request({q:'French'}))).body.suggestions[0].kind,'idea');
 const controller=new AbortController();controller.abort();
 const response=await failed.GET(request({q:'French'},controller.signal));assert.equal(response.status,499);
});
