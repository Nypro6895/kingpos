import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(path,deps={},globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
 {exports,require:name=>deps[name],AbortController,...globals});return exports;
}
const helpers=load('lib/explore-search-refresh.ts');
const row=(id,extra={})=>({id,name:'Same name',resultGroup:'best_match',relevanceScore:100,matchTier:1,matchType:'content',imageProvenance:'suggested',coverImageUrl:'suggested',...extra});
const response=()=>({searchVersion:3,target:'salons',query:'French nails',contentQuery:'french',displayQuery:'French nails near me',queryKind:'style',category:'Nails',location:'Milwaukee, WI',locationOrigin:'context',locationSource:'gps',locationPriority:true,filters:{color:'red'},scope:{policy:'fixed'},sort:'relevance',pageSize:12,sessionCursor:{session:'s',after:0},results:[]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('fresh real media replaces suggestions by salon ID without changing rank, combining names or inserting an unseen salon',()=>{
 const before=[row('a'),row('b',{resultGroup:'reference',isReferenceMatch:true,isPrimaryMatch:false,recommendationReason:'matching_in_other_areas',recommendationAreaLabel:'Other areas'})];
 const after=helpers.mergeExploreSearchMedia(before,[row('b',{imageProvenance:'salon_cover',coverImageUrl:'b-real',resultGroup:'best_match',isReferenceMatch:false,isPrimaryMatch:true,recommendationReason:'related_in_area',recommendationAreaLabel:'Changed area'}),row('a',{imageProvenance:'salon_post',coverImageUrl:'a-real',relevanceScore:999}),row('other')]);
 assert.deepEqual(Array.from(after,r=>r.id),['a','b']);
 assert.equal(after[0].coverImageUrl,'a-real');assert.equal(after[0].relevanceScore,100);
 assert.equal(after[1].coverImageUrl,'b-real');assert.equal(after[1].resultGroup,'reference');assert.equal(after[1].isReferenceMatch,true);
 assert.equal(after[1].isPrimaryMatch,false);assert.equal(after[1].recommendationReason,'matching_in_other_areas');assert.equal(after[1].recommendationAreaLabel,'Other areas');
 assert.equal(helpers.mergeExploreSearchMedia(before,[]).length,0,'no longer public members are removed');
});

test('hydration uses complete committed query/location/filter/session metadata, even after the final page',()=>{
 const r=response(),input=helpers.exploreSearchRefreshInput(r,['a'],{latitude:0,longitude:0});
 for(const key of ['query','displayQuery','contentQuery','queryKind','category','location','locationSource','locationOrigin','locationPriority','filters','sort','pageSize'])assert.equal(input[key],r[key],key);
 assert.equal(input.cursor,r.sessionCursor);assert.equal(input.scopePolicy,'fixed');assert.equal(input.latitude,0);assert.equal(input.longitude,0);
});

function harness({pending=false,results=[row('a')],initial=response(),failed=false}={}) {
 const effects=[],changes=[],events=new Map(),docEvents=new Map(),timers=new Map(),requests=[];let timer=0,visible='visible';
 const react={useState:()=>[null,value=>changes.push(value)],useEffect:fn=>effects.push(fn)};
 const add=(map,name,fn)=>map.set(name,fn),remove=(map,name)=>map.delete(name);
 const api=load('lib/use-explore-search-media.ts',{
  react,'@/lib/experience-cache-events':{EXPERIENCE_RESET_EVENT:'reset'},
  '@/lib/explore-search-context':{buildExploreCommittedSearchContext:r=>({sessionKey:JSON.stringify([r.query,r.location,r.filters])})},
  '@/lib/explore-search-refresh':helpers,
  '@/lib/explore-search-client':{fetchExploreSearchPage:(input,signal)=>{
   const entry={input,signal};requests.push(entry);
   if(failed)return Promise.reject(new Error('offline'));
   if(pending)return new Promise(resolve=>entry.resolve=resolve);
   return Promise.resolve({results:input.hydrateIds.map(id=>row(id,{coverImageUrl:'real'}))});
  }},
 },{window:{setInterval:fn=>{timers.set(++timer,fn);return timer;},clearInterval:id=>timers.delete(id),addEventListener:(...args)=>add(events,...args),removeEventListener:(...args)=>remove(events,...args)},
 document:{get visibilityState(){return visible;},addEventListener:(...args)=>add(docEvents,...args),removeEventListener:(...args)=>remove(docEvents,...args)}});
 api.useExploreSearchMedia({results,response:initial,coordinates:{latitude:43,longitude:-87},viewerId:'a'});
 const cleanup=effects[0]();
 return {requests,changes,events,docEvents,timers,cleanup,visibility:state=>{visible=state;docEvents.get('visibilitychange')?.();}};
}

test('focus/restore rechecks media, batches long lists, and suppresses hidden-tab refresh',async()=>{
 const h=harness({results:Array.from({length:205},(_,i)=>row(String(i)))});await flush();
 assert.deepEqual(h.requests.map(r=>r.input.hydrateIds.length),[100,100,5]);assert.equal(h.changes[0].rows.length,205);
 h.visibility('hidden');h.events.get('focus')();await flush();assert.equal(h.requests.length,3);
 h.visibility('visible');await flush();assert.equal(h.requests.length,6);
 h.events.get('pageshow')();await flush();assert.equal(h.requests.length,9);
 h.cleanup();assert.equal(h.timers.size,0);assert.equal(h.events.size,0);assert.equal(h.docEvents.size,0);
});

test('late media from a previous query cannot replace a new page; account reset clears and suspends the old session',async()=>{
 for(const reset of [false,true]) {
  const h=harness({pending:true});assert.equal(h.requests.length,1);
  if(reset)h.events.get('reset')();else h.cleanup();
  assert.equal(h.requests[0].signal.aborted,true);
  h.requests[0].resolve({results:[row('a',{coverImageUrl:'old-query'})]});await flush();
  assert.equal(h.changes.length,reset?1:0);if(reset){assert.equal(h.changes[0].rows.length,0);h.events.get('focus')();await flush();assert.equal(h.requests.length,1);h.cleanup();}
 }
});

test('legacy/error pages never reuse media sessions and failed validation keeps current data',async()=>{
 for(const initial of [{...response(),searchVersion:undefined},{...response(),error:'unavailable'},{...response(),sessionCursor:null}]) {
  const h=harness({initial});await flush();assert.equal(h.requests.length,0);
 }
 const h=harness({failed:true});await flush();assert.equal(h.changes.length,0);h.events.get('online')();await flush();assert.equal(h.requests.length,2);h.cleanup();
});
