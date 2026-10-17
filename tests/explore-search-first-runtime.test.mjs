import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(path, 'utf8');
function module(path, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { fileName:path, compilerOptions: { jsx:ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, URL, URLSearchParams, ...globals });
  return exports;
}
function timers() {
  let id = 0; const jobs = new Map();
  return { setTimeout(fn, delay) { const key = ++id; jobs.set(key, {fn,delay}); return key; }, clearTimeout(id) { jobs.delete(id); }, flush() { const pending = [...jobs.values()]; jobs.clear(); pending.forEach(job => job.fn()); }, jobs };
}
test('typing waits 450ms, runs only the latest query, and cancel prevents submit/composition duplicates', () => {
  const clock = timers(); const api = module('lib/explore-live-search.ts', clock); const scheduler = api.createExploreLiveSearchScheduler(); const calls = [];
  scheduler.schedule('n', value => calls.push(value)); scheduler.schedule(' nails ', value => calls.push(value));
  assert.equal(clock.jobs.size, 1); assert.equal([...clock.jobs.values()][0].delay, 450); assert.deepEqual(calls, []);
  clock.flush(); assert.deepEqual(calls, ['nails']);
  scheduler.schedule('hair', value => calls.push(value)); scheduler.cancel(); clock.flush(); assert.deepEqual(calls, ['nails']);
  scheduler.schedule('', value => calls.push(value)); clock.flush(); assert.deepEqual(calls, ['nails','']);
});
test('actual input prevents Enter during IME, cancels debounce on submit, and continues live search after Done/blur', () => {
  const clock=timers(),effects=[],calls=[],listeners=new Map();
  const scheduler=module('lib/explore-live-search.ts',clock);
  const react={useCallback:fn=>fn,useId:()=>"list",useRef:current=>({current}),useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>effects.push(fn)};
  const jsx=(type,props)=>({type,props});
  const api=module('app/explore/explore-search-input.tsx', { ...clock,AbortController,
    require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name.includes('explore-live-search')?scheduler:{WorkspaceText:()=>null} });
  const wrapped=api.ExploreSearchInput({defaultValue:'',onLiveSearch:value=>calls.push(value),onDraftChange(){}});
  const tree=wrapped.type(wrapped.props);const input=tree.props.children[0].props;
  input.ref.current={form:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener(){}},blur(){}};
  effects.forEach(fn=>fn());
  input.onChange({target:{value:'nails'}});assert.equal(clock.jobs.size,1);
  input.onCompositionStart();assert.equal(clock.jobs.size,0);
  let prevented=false;input.onKeyDown({key:'Enter',nativeEvent:{},preventDefault(){prevented=true;}});assert.equal(prevented,true);
  input.onChange({target:{value:'tóc'}});assert.equal(clock.jobs.size,0);
  input.onCompositionEnd({currentTarget:{value:'tóc'}});assert.equal(clock.jobs.size,1);
  listeners.get('submit')({});clock.flush();assert.deepEqual(calls,[]);
  input.onChange({target:{value:'hair'}});input.onBlur();clock.flush();assert.deepEqual(calls,['hair']);
  assert.equal(input.enterKeyHint,'search');
});
test('reset URL retains the selected area and removes query, category, order, scope and pagination', () => {
  const api = module('lib/explore-entry-navigation.ts');
  for (const source of ['manual','saved','workspace','gps','activity']) {
    const url = new URL(api.exploreHomeUrl(' Milwaukee, WI ', source), 'https://reylumi.com');
    assert.equal(url.searchParams.get('location'), 'Milwaukee, WI'); assert.equal(url.searchParams.get('locationSource'),source);
    assert.equal(url.searchParams.get('browse'), '1'); assert.equal(url.searchParams.size,3);
  }
  assert.equal(new URL(api.exploreHomeUrl('', 'none'), 'https://reylumi.com').searchParams.get('location'), '');
});
test('only a real reload of Explore resets, once per document; navigate/back/other routes do not', () => {
  for (const [type,path,expected] of [['reload','/explore',true],['navigate','/explore',false],['back_forward','/explore',false],['reload','/bookings',false]]) {
    const api = module('lib/explore-entry-navigation.ts', {performance:{getEntriesByType:()=>[{type,name:'https://reylumi.com'+path}]}});
    assert.equal(api.consumeExploreDocumentReload(),expected); assert.equal(api.consumeExploreDocumentReload(),false);
  }
});

const source = ts.createSourceFile('client.tsx',read('app/explore/explore-client.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(name) {
  let found; function visit(node) { if(ts.isFunctionDeclaration(node)&&node.name?.text===name) found=node; ts.forEachChild(node,visit); } visit(source);
  assert.ok(found,name); return found.getText(source);
}
const actions = ts.transpileModule(['submitUnifiedSearch','cancelTypedSearch'].map(declaration).join('\n')+'\nglobalThis.actions={submitUnifiedSearch,cancelTypedSearch};', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function harness(gps = false) {
  const state={}, requests=[],urls=[],gpsCalls=[];
  const context={AbortController,typedRequest:{current:null},gpsRequestVersion:{current:0},gpsRequest:{current:null},query:'nails',searchTarget:'salons',gpsCoordinates:gps?{latitude:43,longitude:-87}:null,
    activeResponse:{locationOrigin:'manual',scope:{policy:'fixed'}},location:'Milwaukee, WI',locationSource:'manual',initialResponse:{pageSize:12},
    prepareSearchTransition(){},rememberSearchUrl(...args){urls.push(args);},runGpsSearch(...args){gpsCalls.push(args);return Promise.resolve();},
    fetchExploreSearchPage(input,signal){return new Promise((resolve,reject)=>requests.push({input,signal,resolve,reject}));}
  };
  for(const name of ['Query','Category','GpsStatus','GpsMessage','ActiveDiscoveryResult','SessionResponse','GpsResponse','CommittedGpsContext','NearYouSalons','ExplicitSearchMode','SearchOrderMode','Location','LocationSource']) context['set'+name]=value=>{state[name]=value;};
  vm.runInNewContext(actions,context); return {...context.actions,state,requests,urls,gpsCalls};
}
const result = term => ({query:term,category:term==='hair'?'Hair':'Nails',location:'Milwaukee, WI',locationSource:'manual',sort:'relevance'});
test('live/Enter search uses the existing API, keeps the chosen area and clears an old hidden category',async()=>{
  const h=harness();const run=h.submitUnifiedSearch(' hair ');assert.equal(h.requests.length,1);
  const request=h.requests[0];assert.equal(request.input.query,'hair');assert.equal(request.input.category,'');assert.equal(request.input.target,'salons');
  assert.equal(request.input.location,'Milwaukee, WI');assert.equal(request.input.locationSource,'manual');assert.equal(request.input.scopePolicy,'fixed');
  assert.equal(request.input.sort,'relevance');assert.equal(request.input.page,1);
  request.resolve(result('hair'));await run;assert.equal(h.state.SessionResponse.query,'hair');assert.equal(h.urls.length,1);assert.equal(h.state.GpsStatus,'idle');
});
test('Enter while the same live query is in flight does not launch a duplicate request',async()=>{
  const h=harness();const first=h.submitUnifiedSearch('hair');await h.submitUnifiedSearch('hair');assert.equal(h.requests.length,1);
  h.requests[0].resolve(result('hair'));await first;
});
test('new typing aborts in-flight search and a late result cannot replace the new query',async()=>{
  const h=harness();const old=h.submitUnifiedSearch('hair');h.cancelTypedSearch();assert.equal(h.requests[0].signal.aborted,true);
  const current=h.submitUnifiedSearch('nail art');h.requests[1].resolve(result('nail art'));await current;
  h.requests[0].resolve(result('hair'));await old;assert.equal(h.state.SessionResponse.query,'nail art');assert.equal(h.urls.length,1);
});
test('network failure is visible and the same term remains retryable',async()=>{
  const h=harness();const failed=h.submitUnifiedSearch('hair');h.requests[0].reject(new Error('offline'));await failed;
  assert.match(h.state.GpsMessage,/try again/);assert.equal(h.state.GpsStatus,'idle');
  const retry=h.submitUnifiedSearch('hair');assert.equal(h.requests.length,2);h.requests[1].resolve(result('hair'));await retry;
});
test('GPS search retains its established location resolver and discards only the hidden category',async()=>{
  const h=harness(true);await h.submitUnifiedSearch('hair');assert.equal(h.requests.length,0);assert.equal(h.gpsCalls.length,1);
  assert.equal(h.gpsCalls[0][2],'hair');assert.equal(h.gpsCalls[0][4],'');assert.equal(h.gpsCalls[0][5],'salons');
});
