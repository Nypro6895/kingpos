import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {createElement} from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function load(file,deps={},globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require:name=>deps[name]??{},URLSearchParams,process:{env:{}},...globals});return exports;
}
const discovery=load('lib/explore-feed-discovery.ts');
const context=load('lib/explore-search-context.ts',{'@/lib/explore-feed-discovery':discovery});
const recommendations=load('lib/explore-search-recommendations.ts',{'@/lib/explore-feed-discovery':discovery});
const source=readFileSync('app/explore/explore-client.tsx','utf8');
const ast=ts.createSourceFile('explore-client.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const main=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ExploreClient');
const stateNames=main.body.statements.flatMap(statement=>ts.isVariableStatement(statement)?statement.declarationList.declarations.flatMap(declaration=>ts.isArrayBindingPattern(declaration.name)&&ts.isCallExpression(declaration.initializer)&&declaration.initializer.expression.getText(ast)==='useState'?[declaration.name.elements[0].getText(ast)]:[]):[]);
const item=(id)=>({id,name:id,serviceCategories:['Nails'],city:'Milwaukee',state:'WI'});
const response=(patch={})=>({target:'posts',query:'christmas nail design',contentQuery:'christmas',displayQuery:'Christmas nail design',category:'Nails',location:'Milwaukee, WI',locationSource:'manual',locationOrigin:'manual',scope:{policy:'fixed'},sort:'relevance',appliedSort:'relevance',page:1,pageSize:12,error:null,groupCounts:{bestMatches:0,nearby:0,recommended:0},results:[],sections:{bestMatches:[],nearby:[],recommended:[]},totalCount:0,totalPages:1,hasMore:false,...patch});
function harness(initial=response()){
 const states=[],refs=[],setters={},events=[];let stateIndex=0,refIndex=0,pending=false;
 const react={createContext:()=>({Provider:'provider'}),useState(initializer){const index=stateIndex++;if(!(index in states))states[index]=typeof initializer==='function'?initializer():initializer;const set=value=>{states[index]=typeof value==='function'?value(states[index]):value;};setters[stateNames[index]]=set;return[states[index],set];},useRef(initializer){const index=refIndex++;refs[index]??={current:initializer};return refs[index];},useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){},useTransition:()=>[pending,fn=>{pending=true;fn();}]};
 const runtime={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
 function ExploreDiscoveryFeed(){}function ExploreSearchRecommendations(){}function ExploreSearchContext(){}
 const api=load('app/explore/explore-client.tsx',{'react':react,'react/jsx-runtime':runtime,'next/navigation':{useRouter:()=>({push:(...args)=>events.push(args)}),usePathname:()=>'/explore',useSearchParams:()=>new URLSearchParams('q=christmas+nail+design&type=posts&scope=fixed')},'next/dynamic':{__esModule:true,default:()=>()=>null},'@/lib/explore-search-context':context,'@/lib/explore-search-recommendations':recommendations,'@/lib/explore-viewport-priority':{useExploreFirstContentPaint(){}},'@/lib/explore-startup-interaction':{readExploreStartupInteraction:()=>null},'@/app/explore/explore-discovery-feed':{ExploreDiscoveryFeed},'@/app/explore/explore-search-recommendations':{ExploreSearchRecommendations},'@/app/explore/explore-search-context':{ExploreSearchContext}});
 const props={initialResponse:initial,initialSearchMode:true,initialLocationSource:initial.locationSource,hasUrlLocation:true,commentViewer:{userId:'viewer-a'},discoveryContent:{shortcuts:[]},homeContent:{inspiration:{items:[]},recommendedSalons:[],newSalons:[],popularServices:[]},initialFeed:{items:[]},quickActions:[],workspaceLocation:{label:'',source:'none'}};
 function render(){stateIndex=0;refIndex=0;return api.ExploreClient(props);}
 const find=(tree,predicate)=>{if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of [tree.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;};
 const walk=(tree,name)=>find(tree,node=>node.type?.name===name);
 return{render,walk,find,set:(name,value)=>{assert.ok(setters[name],`actual hook ${name} exists`);setters[name](value);},events,setPending:value=>{pending=value;}};
}
test('the actual Ideas subtree ignores draft query/category/area/new GPS and changes key only after a new response commits',()=>{
 const api=harness(),before=api.walk(api.render(),'ExploreDiscoveryFeed');assert.ok(before);
 api.set('query','red ombre nail design');api.set('category','Hair');api.set('location','Chicago, IL');api.set('gpsCoordinates',{latitude:41.88,longitude:-87.63});
 const draft=api.walk(api.render(),'ExploreDiscoveryFeed');assert.equal(draft.key,before.key);assert.equal(draft.props.discovery.query,'christmas');assert.equal(draft.props.discovery.category,'Nails');assert.equal(draft.props.discovery.location,'Milwaukee, WI');assert.equal(draft.props.discovery.latitude,null);
 api.setPending(true);assert.equal(api.walk(api.render(),'ExploreDiscoveryFeed'),null,'submitted pending search unmounts old requests rather than applying draft filters to their cursor');
 const completed=response({query:'red ombre nail design',contentQuery:'red ombre',displayQuery:'Red ombre nail design',locationSource:'gps',locationOrigin:'context',scope:{policy:'expandable'}});
 api.set('gpsResponse',completed);api.set('committedGpsContext',{response:completed,coordinates:{latitude:43.0389,longitude:-87.9065}});api.setPending(false);
 const next=api.walk(api.render(),'ExploreDiscoveryFeed');assert.notEqual(next.key,before.key);assert.equal(next.props.discovery.query,'red ombre');assert.equal(next.props.discovery.location,'Milwaukee, WI');assert.equal(next.props.discovery.category,'Nails');assert.equal(next.props.discovery.latitude,43.0389);assert.equal(next.props.discovery.strictLocation,false);
});
test('scope-only changes remount the actual primary Ideas subtree while viewer and source stay unchanged',()=>{
 const api=harness(),first=api.walk(api.render(),'ExploreDiscoveryFeed');
 const completed=response({scope:{policy:'expandable'}});api.set('gpsResponse',completed);
 const expanded=api.walk(api.render(),'ExploreDiscoveryFeed');assert.notEqual(first.key,expanded.key);assert.equal(first.props.discovery.strictLocation,true);assert.equal(expanded.props.discovery.strictLocation,false);
 assert.notEqual(first.props.sessionKey,expanded.props.sessionKey);
});
test('a submitted Ideas transition preserves the previous section height only while its old feed is unmounted',()=>{
 const api=harness();api.render();api.set('pendingIdeasHeight',1540);api.setPending(true);
 const pending=api.find(api.render(),node=>node.props?.['data-testid']==='explore-content-search');
 assert.equal(pending.props.style.minHeight,1540);assert.equal(api.walk(pending,'ExploreDiscoveryFeed'),null);
 api.setPending(false);const completed=api.find(api.render(),node=>node.props?.['data-testid']==='explore-content-search');
 assert.equal(completed.props.style,undefined);assert.ok(api.walk(completed,'ExploreDiscoveryFeed'));
});
test('main salon results keep committed server sequence without reintroducing removed filter controls',()=>{
 const low=item('server-first-low-trust'),high=item('server-second-high-trust');low.completedBookingCount=0;high.completedBookingCount=100;
 const committed=response({target:'salons',query:'nail',displayQuery:'nail',sort:'trusted',appliedSort:'relevance',results:[low,high],sections:{bestMatches:[low,high],nearby:[],recommended:[]},groupCounts:{bestMatches:2,nearby:0,recommended:0},totalCount:2});
 const api=harness(committed),tree=api.render();
 assert.equal(api.walk(tree,'SearchRefinementBar'),null);assert.equal(api.walk(tree,'ResultSection').props.results,committed.sections.bestMatches);
 api.set('query','another draft');assert.equal(api.walk(api.render(),'ResultSection').props.results[0],low);
 const applied=response({...committed,results:[high,low],sections:{bestMatches:[high,low],nearby:[],recommended:[]}});api.set('gpsResponse',applied);
 assert.equal(api.walk(api.render(),'SearchRefinementBar'),null);assert.equal(api.walk(api.render(),'ResultSection').props.results[0],high);
});

test('area ambiguity and manual conflicts are exposed above both actual Salons and Ideas branches',()=>{
 for(const target of ['salons','posts']){
  const committed=response({target,locationConflict:true,queryLocationHint:'Chicago, IL'}),api=harness(committed);
  const panel=api.walk(api.render(),'ExploreSearchContext');assert.ok(panel);assert.equal(panel.props.response,committed);
 }
});
test('shared search keeps its draft across header relocation and forwards current area/category without submitting',()=>{
 const states=[],setters=[],calls=[],effects=[],refs=[];let index=0,refIndex=0;
 const runtime={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
 const react={useState(initializer){const slot=index++;if(!(slot in states))states[slot]=initializer;setters[slot]=value=>{states[slot]=value;};return[states[slot],setters[slot]];},useRef(initializer){return refs[refIndex++]??(refs[refIndex-1]={current:initializer});},useEffect:fn=>effects.push(fn),useLayoutEffect(){},useCallback:fn=>fn};
 class Input {constructor(value){this.name='q';this.value=value;}}
 function ExploreSearchInput(){}
 let relocate;const media={matches:true,addEventListener(name,fn){relocate=fn;},removeEventListener(){}};
 const header={id:'desktop-header'},document={activeElement:null,querySelector:()=>header};
 const window={matchMedia:()=>media,requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){},addEventListener(){},removeEventListener(){}};
 const api=load('app/explore/explore-search-toolbar.tsx',{'react':react,'react/jsx-runtime':runtime,'react-dom':{createPortal:(children,target)=>({type:'portal',props:{children,target}})},'@/app/explore/explore-search-input':{ExploreSearchInput}}, {window,document,HTMLInputElement:Input,FormData:class{constructor(form){this.form=form;}get(name){return this.form[name];}}});
 const props={location:'Milwaukee, WI',locationSource:'manual',query:'nail',category:'Nails',scopePolicy:'fixed',locating:false,pending:false,message:null,areaOpen:false,onAreaOpenChange(){},onCurrentLocation(){},onAreaApply(){},onSearch:q=>calls.push(['search',q]),onSuggestionSelect:choice=>calls.push(['choice',choice])};
 const find=(tree,predicate)=>{if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of [tree.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;};
 const render=()=>{index=0;refIndex=0;return api.ExploreSearchToolbar(props);};
 const first=render();first.props.ref.current={querySelector:()=>new Input('red ombre')};effects.forEach(fn=>fn());
 const moved=render();assert.equal(moved.type,'portal');
 let input=find(moved,node=>node.type===ExploreSearchInput);assert.equal(input.props.initialDraftValue,'red ombre');assert.equal(input.props.location,'Milwaukee, WI');assert.equal(input.props.scopePolicy,'fixed');
 props.location='Chicago, IL';props.category='Hair';media.matches=false;relocate();
 const inline=render();input=find(inline,node=>node.type===ExploreSearchInput);assert.equal(input.props.initialDraftValue,'red ombre');assert.equal(input.props.location,'Chicago, IL');assert.equal(input.props.category,'Hair');assert.equal(calls.length,0);
 find(inline,node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{q:' red ombre '}});assert.deepEqual(calls,[['search','red ombre']]);
 props.query='submitted query';assert.equal(find(render(),node=>node.type===ExploreSearchInput).props.initialDraftValue,'submitted query');
});
const areaPanel=load('app/explore/explore-search-context.tsx',{'react/jsx-runtime':jsxRuntime});
test('area context SSR uses plain labels, keeps the selected manual area and offers explicit city choices for Ideas',()=>{
 const manual=response({locationConflict:true,queryLocationHint:'Chicago, IL'});
 const html=renderToStaticMarkup(createElement(areaPanel.ExploreSearchContext,{response:manual,pending:false,onAreaSelect(){},onEditLocation(){}}));
 assert.match(html,/Searching in Milwaukee, WI, your selected area/);assert.match(html,/Use Chicago, IL/);assert.doesNotMatch(html,/GPS|scope|candidate|query|matching/i);
 const ambiguous=response({locationOrigin:'query',location:'Springfield',areaAmbiguous:true,areaCandidates:[{kind:'city',city:'Springfield',stateCode:'IL',label:'Springfield, IL'},{kind:'city',city:'Springfield',stateCode:'MA',label:'Springfield, MA'}]});
 const choices=renderToStaticMarkup(createElement(areaPanel.ExploreSearchContext,{response:ambiguous,pending:false,onAreaSelect(){},onEditLocation(){}}));assert.match(choices,/Which city do you mean/);assert.match(choices,/Springfield, IL/);assert.match(choices,/Springfield, MA/);
 assert.equal(renderToStaticMarkup(createElement(areaPanel.ExploreSearchContext,{response:ambiguous,pending:true,onAreaSelect(){},onEditLocation(){}})),'');
});
