import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.createSourceFile('explore-client.tsx',readFileSync('app/explore/explore-client.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(name){let found;const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);};visit(source);assert.ok(found,`the actual ${name} declaration exists`);return found.getText(source);}
const code=ts.transpileModule(['cleanCategory','buildUrl','prepareSearchTransition','changeSearchOrder','applySearchShortcut','selectSearchSuggestion','handleHeaderGpsSearch'].map(declaration).join('\n')+'\nglobalThis.actions={changeSearchOrder,applySearchShortcut,selectSearchSuggestion,handleHeaderGpsSearch};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function harness({source='saved',gps=false}={}){
 const events=[],state={};const version={current:4};let staleApplied=false;
 const context={URLSearchParams,commentViewer:{isAuthenticated:false},activeResponse:{locationOrigin:'context'},locationSource:source,selectedCategory:'Nails',normalizedCategory:'Nails',searchTarget:'auto',searchOrderMode:'relevance',query:'King Nails near Chicago',location:'Milwaukee, WI',pathname:'/explore',gpsActive:gps,gpsCoordinates:gps?{latitude:43,longitude:-87}:null,
  searchParams:new URLSearchParams(`q=King+Nails+near+Chicago&location=Milwaukee%2C+WI&locationSource=${source}&page=2&type=salons`),gpsRequestVersion:version,
  gpsRequest:{current:{abort(){events.push(['abort',version.current]);Promise.resolve().then(()=>{if(version.current===4)staleApplied=true;});}}},
  startTransition:fn=>{events.push(['transition']);fn();},router:{push:(url,options)=>events.push(['push',url,options])},
  runGpsSearch:(...args)=>{events.push(['gps',...args]);return Promise.resolve();},rememberExplorePreferenceAction:input=>{events.push(['remember',input]);return Promise.resolve();},
 };
 for(const name of ['SearchOrderMode','GpsStatus','Query','Location','LocationSource','GpsCoordinates','Category','GpsResponse','NearYouSalons','ActiveDiscoveryResult','ExplicitSearchMode']){
  context[`set${name}`]=value=>{state[name]=value;events.push([`set${name}`,value]);};
 }
 vm.runInNewContext(code,context);
 return {actions:context.actions,state,events,version,staleApplied:()=>staleApplied};
}
test('non-GPS sort invalidates old request generation before abort and prevents its delayed catch from applying state',async()=>{
 const api=harness();api.actions.changeSearchOrder('trusted');await Promise.resolve();
 assert.equal(api.version.current,5);assert.deepEqual(api.events.find(event=>event[0]==='abort'),['abort',5]);assert.equal(api.staleApplied(),false);
 assert.equal(api.state.SearchOrderMode,'trusted');assert.ok(!api.events.some(event=>event[0]==='gps'));
 const url=new URL(api.events.find(event=>event[0]==='push')[1],'https://example.test');assert.equal(url.searchParams.get('sort'),'trusted');assert.equal(url.searchParams.get('page'),null);assert.equal(url.searchParams.get('q'),'King Nails near Chicago');
});
test('explicit shortcut area becomes manual and clears GPS even when its URL still carries a contextual source',async()=>{
 for(const source of ['gps','saved','activity','workspace']){
  const api=harness({source,gps:true});api.actions.applySearchShortcut({location:'Madison, WI'});await Promise.resolve();
  assert.equal(api.state.LocationSource,'manual');assert.equal(api.state.GpsCoordinates,null);assert.equal(api.state.Location,'Madison, WI');assert.equal(api.version.current,5);assert.equal(api.staleApplied(),false);
  assert.ok(!api.events.some(event=>event[0]==='gps'),'explicit area cannot rerun the former GPS context');
  const url=new URL(api.events.find(event=>event[0]==='push')[1],'https://example.test');assert.equal(url.searchParams.get('locationSource'),'manual');assert.equal(url.searchParams.get('location'),'Madison, WI');assert.equal(url.searchParams.get('q'),'King Nails near Chicago');assert.equal(url.searchParams.get('page'),null);
 }
});
test('clearing a shortcut area removes its contextual source, while service-only shortcuts retain active GPS',()=>{
 const clear=harness({source:'activity',gps:true});clear.actions.applySearchShortcut({location:''});assert.equal(clear.state.LocationSource,'none');assert.equal(clear.state.GpsCoordinates,null);
 assert.equal(new URL(clear.events.find(event=>event[0]==='push')[1],'https://example.test').searchParams.get('locationSource'),null);
 const contextual=harness({source:'gps',gps:true});contextual.actions.applySearchShortcut({category:'Hair',query:'haircuts'});
 assert.equal(contextual.state.LocationSource,undefined);assert.equal(contextual.state.GpsCoordinates,undefined);assert.ok(!contextual.events.some(event=>event[0]==='push'));
 assert.equal(contextual.events.find(event=>event[0]==='gps')[3],'haircuts');assert.equal(contextual.events.find(event=>event[0]==='gps')[5],'Hair');
});
test('area autocomplete is a deliberate manual fixed-area choice and cannot retain the former GPS context',()=>{
 const api=harness({source:'gps',gps:true});api.actions.selectSearchSuggestion({kind:'area',query:'Chicago, IL',location:'Chicago, IL',target:'salons'},'expandable','Milwaukee, WI');
 assert.equal(api.state.GpsCoordinates,null);assert.equal(api.state.LocationSource,'manual');assert.equal(api.state.Location,'Chicago, IL');assert.equal(api.state.Category,'Nails');assert.equal(api.state.Query,'');assert.ok(!api.events.some(row=>row[0]==='gps'));
 const url=new URL(api.events.find(row=>row[0]==='push')[1],'https://example.test');assert.equal(url.searchParams.get('location'),'Chicago, IL');assert.equal(url.searchParams.get('locationSource'),'manual');assert.equal(url.searchParams.get('scope'),'fixed');assert.equal(url.searchParams.get('type'),'salons');assert.equal(url.searchParams.get('category'),'Nails');
});
test('salon and Ideas autocomplete retain the selected category, while an explicit service choice can select its category',()=>{
 for(const kind of ['salon','idea']){
  const api=harness({source:'gps',gps:true});api.actions.selectSearchSuggestion({kind,query:'French nail design',category:'Hair',target:kind==='idea'?'posts':'salons'},'fixed','Milwaukee, WI');
  assert.equal(api.state.Category,'Nails');const request=api.events.find(row=>row[0]==='gps');assert.equal(request[5],'Nails');assert.equal(request[6],kind==='idea'?'posts':'salons');assert.equal(request[7],'fixed');
 }
 const service=harness({source:'gps',gps:true});service.actions.selectSearchSuggestion({kind:'service',query:'hair extensions',category:'Hair',target:'salons'},'fixed','Milwaukee, WI');assert.equal(service.state.Category,'Hair');assert.equal(service.events.find(row=>row[0]==='gps')[5],'Hair');
});
test('a location field edited before choosing autocomplete wins over active GPS for the new search',()=>{
 const api=harness({source:'gps',gps:true});api.actions.selectSearchSuggestion({kind:'idea',query:'French nail design',category:'Hair',target:'posts'},'fixed','Madison, WI');
 assert.equal(api.state.GpsCoordinates,null);assert.ok(!api.events.some(row=>row[0]==='gps'));const url=new URL(api.events.find(row=>row[0]==='push')[1],'https://example.test');assert.equal(url.searchParams.get('location'),'Madison, WI');assert.equal(url.searchParams.get('locationSource'),'manual');assert.equal(url.searchParams.get('type'),'posts');assert.equal(url.searchParams.get('category'),'Nails');
});
test('header GPS events honor chosen target and explicit category without overwriting an omitted category',()=>{
 const ideas=harness({source:'gps',gps:true});ideas.actions.handleHeaderGpsSearch({detail:{query:'French nail design',target:'posts'}});assert.equal(ideas.state.Category,undefined);const request=ideas.events.find(row=>row[0]==='gps');assert.equal(request[5],'Nails');assert.equal(request[6],'posts');
 const service=harness({source:'gps',gps:true});service.actions.handleHeaderGpsSearch({detail:{query:'hair extensions',category:'Hair',target:'salons'}});assert.equal(service.state.Category,'Hair');assert.equal(service.events.find(row=>row[0]==='gps')[5],'Hair');assert.equal(service.events.find(row=>row[0]==='gps')[6],'salons');
});
