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
const intent=load('lib/explore-query-intent.ts');
const context=load('lib/explore-search-context.ts',{'@/lib/explore-feed-discovery':discovery,'@/lib/explore-query-intent':intent});
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
 function ExploreDiscoveryFeed(){}function ExploreSearchRecommendations(){}function ExploreSearchOnwardActions(){}function ExploreSearchContext(){}
 const api=load('app/explore/explore-client.tsx',{'react':react,'react/jsx-runtime':runtime,'next/navigation':{useRouter:()=>({push:(...args)=>events.push(args)}),usePathname:()=>'/explore',useSearchParams:()=>new URLSearchParams('q=christmas+nail+design&type=posts&scope=fixed')},'next/dynamic':{__esModule:true,default:()=>()=>null},'@/lib/explore-search-context':context,'@/lib/explore-search-recommendations':recommendations,'@/lib/explore-viewport-priority':{useExploreFirstContentPaint(){}},'@/lib/use-explore-search-media':{useExploreSearchMedia:({results})=>results},'@/lib/explore-startup-interaction':{readExploreStartupInteraction:()=>null},'@/app/explore/explore-discovery-feed':{ExploreDiscoveryFeed},'@/app/explore/explore-search-recommendations':{ExploreSearchRecommendations,ExploreSearchOnwardActions},'@/app/explore/explore-search-context':{ExploreSearchContext}});
 const props={initialResponse:initial,initialSearchMode:true,initialLocationSource:initial.locationSource,hasUrlLocation:true,commentViewer:{userId:'viewer-a'},discoveryContent:{shortcuts:[]},homeContent:{inspiration:{items:[]},recommendedSalons:[],newSalons:[],popularServices:[]},initialFeed:{items:[]},quickActions:[],workspaceLocation:{label:'',source:'none'}};
 function render(){stateIndex=0;refIndex=0;return api.ExploreClient(props);}
 const find=(tree,predicate)=>{if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of [tree.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;};
 const walk=(tree,name)=>find(tree,node=>node.type?.name===name);
 return{render,walk,find,set:(name,value)=>{assert.ok(setters[name],`actual hook ${name} exists`);setters[name](value);},events,setPending:value=>{pending=value;}};
}
test('legacy Ideas targets render the same salon results and never orphan catalog cards',()=>{
 const first=item('salon-a'),second={...item('salon-b'),name:first.name,resultGroup:'reference',isPrimaryMatch:false};
 const committed=response({results:[first,second],sections:{bestMatches:[first],nearby:[],recommended:[],reference:[first,second]},totalCount:2});
 const api=harness(committed),tree=api.render();
 assert.equal(api.walk(tree,'ExploreDiscoveryFeed'),null);
 assert.equal(api.walk(tree,'NailSearchInspiration'),null);
 assert.equal(api.find(tree,node=>node.props?.['aria-label']==='Search type'),null);
 assert.deepEqual(Array.from(api.walk(tree,'ResultSection').props.results,row=>row.id),['salon-a']);
 const reference=api.walk(tree,'SearchRecommendationSections');
 assert.deepEqual(Array.from(reference.props.results,row=>row.id),['salon-b'],'dedupe by ID preserves distinct salons with the same name');
});

test('committed results ignore draft query, category, area and GPS while a new search is prepared',()=>{
 const first=item('salon-a'),committed=response({results:[first],sections:{bestMatches:[first],nearby:[],recommended:[]}}),api=harness(committed);
 const before=api.walk(api.render(),'ResultSection');
 api.set('query','red ombre nail design');api.set('category','Hair');api.set('location','Chicago, IL');api.set('gpsCoordinates',{latitude:41.88,longitude:-87.63});
 const draft=api.walk(api.render(),'ResultSection');assert.equal(draft.props.results[0],before.props.results[0]);
 api.setPending(true);assert.equal(api.walk(api.render(),'ResultSection').props.results[0],first);
 const next=item('salon-b'),completed=response({query:'red ombre nail design',contentQuery:'red ombre',displayQuery:'Red ombre nail design',locationSource:'gps',locationOrigin:'context',scope:{policy:'expandable'},results:[next],sections:{bestMatches:[next],nearby:[],recommended:[]}});
 api.set('gpsResponse',completed);api.set('committedGpsContext',{response:completed,coordinates:{latitude:43.0389,longitude:-87.9065}});api.setPending(false);
 assert.equal(api.walk(api.render(),'ResultSection').props.results[0],next);
});

test('a pending unified transition retains results height without restoring the retired Ideas branch',()=>{
 const api=harness();api.render();api.set('pendingIdeasHeight',1540);api.setPending(true);
 const pending=api.find(api.render(),node=>node.props?.['data-testid']==='explore-content-search');
 assert.equal(pending.props.style.minHeight,1540);assert.equal(api.walk(pending,'ExploreDiscoveryFeed'),null);
 api.setPending(false);const completed=api.find(api.render(),node=>node.props?.['data-testid']==='explore-content-search');
 assert.equal(completed.props.style,undefined);assert.equal(api.walk(completed,'ExploreDiscoveryFeed'),null);
});

test('main salon results keep server sequence and select the server-applied order before and during a new request',()=>{
 const low=item('server-first-low-trust'),high=item('server-second-high-trust');low.completedBookingCount=0;high.completedBookingCount=100;
 const committed=response({target:'salons',query:'nail',displayQuery:'nail',sort:'trusted',appliedSort:'relevance',results:[low,high],sections:{bestMatches:[low,high],nearby:[],recommended:[]},groupCounts:{bestMatches:2,nearby:0,recommended:0},totalCount:2});
 const api=harness(committed),tree=api.render();
 assert.equal(api.walk(tree,'SearchRefinementBar').props.mode,'relevance');assert.deepEqual(Array.from(api.walk(tree,'ResultSection').props.results),committed.sections.bestMatches);
 api.walk(tree,'SearchRefinementBar').props.onModeChange('bookable');
 const pending=api.render();assert.equal(api.walk(pending,'SearchRefinementBar').props.mode,'relevance');assert.equal(api.walk(pending,'ResultSection').props.results[0],low);assert.equal(api.events.length,1);
 const applied=response({...committed,sort:'bookable',appliedSort:'bookable',results:[high,low],sections:{bestMatches:[high,low],nearby:[],recommended:[]}});api.set('gpsResponse',applied);api.setPending(false);
 assert.equal(api.walk(api.render(),'SearchRefinementBar').props.mode,'bookable');assert.equal(api.walk(api.render(),'ResultSection').props.results[0],high);
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


test('empty unified responses keep onward browsing without a separate discovery search or duplicate empty heading',()=>{
 const api=harness(response({searchVersion:3})),tree=api.render();
 assert.equal(api.walk(tree,'ExploreSearchRecommendations'),null);assert.equal(api.walk(tree,'ExploreDiscoveryFeed'),null);assert.equal(api.walk(tree,'NailSearchInspiration'),null);
 const noResults=api.find(tree,node=>node.type==='h2'&&node.props.children==='No results found');assert.ok(noResults);
 assert.equal(api.find(tree,node=>node.type==='h2'&&node.props.children==='No salons found'),null);
 const onward=api.find(tree,node=>node.props?.label==='Browse nail salons');assert.ok(onward);assert.match(onward.props.href,/category=Nails/);assert.equal(new URL(onward.props.href,'https://test').searchParams.get('q'),null);
});

test('King nails with no primary match keeps its selected area and shows actual unified recommendations',()=>{
 const suggested={...item('related-salon'),resultGroup:'reference',isPrimaryMatch:false,isReferenceMatch:true,recommendationReason:'matching_in_broader_area',recommendationAreaLabel:'Wisconsin',imageProvenance:'salon_post'};
 const api=harness(response({searchVersion:3,query:'king nails',displayQuery:'King nails',primaryCount:0,results:[suggested],sections:{bestMatches:[],nearby:[],recommended:[],reference:[suggested]}})),tree=api.render();
 assert.ok(api.find(tree,node=>node.type==='h2'&&node.props.children==='No results found'));
 const reference=api.walk(tree,'SearchRecommendationSections');assert.deepEqual(Array.from(reference.props.results,row=>row.id),['related-salon']);assert.equal(reference.props.location,'Milwaukee, WI');
 assert.equal(api.walk(tree,'ExploreDiscoveryFeed'),null);assert.equal(api.walk(tree,'NailSearchInspiration'),null);
});

test('area-only or category-only suggestions never claim matching salons in the selected city',()=>{
 const suggested={...item('other-city'),city:'Elk Grove',state:'CA',addressLine1:'9141 W Stockton Blvd #110',resultGroup:'reference',isPrimaryMatch:false,imageProvenance:'suggested'};
 for(const patch of [{query:'',displayQuery:''},{query:'nail near me',displayQuery:'Nail near me'},{query:'red nails',displayQuery:'red nails'}]){
  const api=harness(response({searchVersion:3,...patch,results:[suggested],sections:{bestMatches:[],nearby:[],recommended:[],reference:[suggested]}})),tree=api.render();
  assert.ok(api.find(tree,node=>node.type==='h2'&&node.props.children==='No results found'));
  const section=api.walk(tree,'SearchRecommendationSections');assert.equal(section.props.results[0],suggested,'suggestions retain actual salon identity, city, address and image provenance');
  assert.equal(api.find(tree,node=>node.type==='h2'&&typeof node.props.children==='string'&&/^Salons in|^Results for/.test(node.props.children)),null);
 }
});

test('errors, unresolved GPS and unfinished first pages do not announce empty results or mount suggestions',()=>{
 const suggested={...item('related-salon'),resultGroup:'reference',isPrimaryMatch:false};
 for(const patch of [{error:'Offline'},{errorKind:'timeout'},{lookupFailed:true},{requiresGps:true}]){
  const api=harness(response({...patch,results:[suggested],sections:{bestMatches:[],nearby:[],recommended:[],reference:[suggested]}})),tree=api.render();
  assert.equal(api.find(tree,node=>node.type==='h2'&&node.props.children==='No results found'),null);
  assert.equal(api.walk(tree,'SearchRecommendationSections'),null);
  if(patch.requiresGps)assert.ok(api.find(tree,node=>node.type==='h2'&&node.props.children==='Choose a location to find salons near you'));
  else assert.ok(api.walk(tree,'ExploreNotice'));
 }
 for(const pending of [false,true]){
  const api=harness(response({hasMore:!pending}));api.setPending(pending);
  const tree=api.render();assert.equal(api.find(tree,node=>node.type==='h2'&&node.props.children==='No results found'),null);
  assert.ok(api.find(tree,node=>node.type==='h2'&&node.props.children==='Loading results…'));
 }
});

test('recommendation wrapper renders only Suggestions followed by salon cards',()=>{
 const wrapper=load('app/explore/explore-search-recommendations.tsx',{'react/jsx-runtime':jsxRuntime});
 const html=renderToStaticMarkup(createElement(wrapper.ExploreSearchRecommendations,{title:'Suggestions'},createElement('article',null,'Milwaukee Salon')));
 assert.match(html,/>Suggestions<\/h2>/);assert.match(html,/>Milwaukee Salon<\/article>/);assert.equal((html.match(/<h2/g)??[]).length,1);
 assert.doesNotMatch(html,/<p|outside|may not match|suggested examples/);
});
