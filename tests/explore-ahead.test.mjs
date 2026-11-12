import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
function load(file,deps){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(n=>{assert.ok(n in deps,n);return deps[n]},exports);return exports;}
const ahead=load('lib/explore-ahead-buffer.ts',{});
const priority=load('lib/explore-viewport-priority.ts',{react:{},'@/lib/explore-ahead-buffer':ahead});
test('buffer spans 2.5 following screens on phone and desktop, restricted networks retain fallback',()=>{
 assert.equal(priority.exploreAheadDistance(844,320,true),2110);
 assert.equal(priority.exploreAheadDistance(900,480,true),2250);
 assert.equal(priority.exploreAheadDistance(844,140,false),140);
});
function harness({height=844,top=2000,hidden=false,online=true,key,margin=height*2.5}={}){
 let clean,frames=[],observerOptions,requested=[];const listeners=new Map();
 const target={addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:()=>{}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:online}});
 globalThis.document={...target,visibilityState:hidden?'hidden':'visible',scrollingElement:null};
 globalThis.window={...target,innerHeight:height,scrollY:0};
 globalThis.requestAnimationFrame=fn=>(frames.push(fn),frames.length);globalThis.cancelAnimationFrame=()=>{};
 globalThis.IntersectionObserver=class{constructor(fn,options){observerOptions=options}observe(){}disconnect(){}};
 const node={parentElement:null,getClientRects:()=>[{}],getBoundingClientRect:()=>({top,bottom:top+1})};
 const api=load('app/explore/explore-auto-load.tsx',{react:{useRef:()=>({current:node}),useEffect:fn=>{clean=fn()}},'react/jsx-runtime':{jsx:()=>null},'@/lib/explore-viewport-priority':{useExploreAheadDistance:()=>margin},'@/lib/explore-ahead-buffer':ahead});
 api.ExploreAutoLoad({onLoad:options=>requested.push(options),prepareAheadKey:key});
 const flush=()=>{const pending=frames;frames=[];pending.forEach(fn=>fn())};flush();
 return {requested,observerOptions,flush,listeners,clean};
}
test('idle mount prepares the phone continuation without a scroll event',()=>{const h=harness({key:'phone'});assert.deepEqual(h.requested,[{background:true}]);assert.equal(h.observerOptions.rootMargin,'2110px 0px');h.clean()});
test('desktop sections and local references also open ahead without scroll',()=>{const h=harness({height:900,top:2600});assert.equal(h.requested.length,1);h.clean()});
test('does not drain content beyond the spatial horizon',()=>{const h=harness({top:4000,key:'far'});assert.equal(h.requested.length,0);h.clean()});
test('automatic network pages remain bounded and rearm after forward reading',()=>{for(let i=0;i<3;i++){const h=harness({key:'budget'});assert.equal(h.requested.length,1);h.clean()}const h=harness({key:'budget'});assert.equal(h.requested.length,0);h.clean();ahead.exploreAheadBudget('budget').advance(700,844);const next=harness({key:'budget'});assert.equal(next.requested.length,1);next.clean()});
test('hidden and offline pages do not start automatic loads',()=>{for(const options of [{hidden:true},{online:false}]){const h=harness(options);assert.equal(h.requested.length,0);h.clean()}});
test('observer uses the same horizon as the geometric check and captures nested scrolling',()=>{const h=harness({top:4000});assert.ok(h.listeners.has('scroll'));assert.equal(h.observerOptions.rootMargin,'2110px 0px');h.clean()});
