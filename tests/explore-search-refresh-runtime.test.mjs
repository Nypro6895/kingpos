import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name]});return exports;}
const discovery=load('lib/explore-feed-discovery.ts');
const context=load('lib/explore-search-context.ts',{'@/lib/explore-feed-discovery':discovery});
const recommendations=load('lib/explore-search-recommendations.ts',{'@/lib/explore-feed-discovery':discovery});

test('a read action refreshing the server tree does not replace an active search cursor',()=>{
 const states=[];let index=0;
 const exports={};
 const react={createContext:()=>({Provider:'provider'}),useState:value=>{const at=index++;if(!(at in states))states[at]=typeof value==='function'?value():value;return [states[at],next=>{states[at]=typeof next==='function'?next(states[at]):next}]},useRef:value=>({current:value}),useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(){},useTransition:()=>[false,fn=>fn()]};
 const runtime={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
 const require=name=>name==='react'?react:name==='react/jsx-runtime'?runtime:name==='next/navigation'?{useRouter:()=>({}),usePathname:()=>'/explore',useSearchParams:()=>new URLSearchParams('q=nail&location=WI')}:name==='next/dynamic'?{__esModule:true,default:()=>()=>null}:name==='@/lib/explore-search-context'?context:name==='@/lib/explore-search-recommendations'?recommendations:name==='@/lib/explore-viewport-priority'?{useExploreFirstContentPaint(){}}:name==='@/lib/explore-startup-interaction'?{readExploreStartupInteraction:()=>null}:{};
 vm.runInNewContext(ts.transpileModule(readFileSync('app/explore/explore-client.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require,URLSearchParams,process:{env:{}}});
 const response={query:'nail',category:'',location:'WI',page:1,pageSize:12,totalCount:256,totalPages:2,hasMore:true,nextCursor:{session:'original',after:12},error:null,results:[],groupCounts:{bestMatches:0,nearby:0,recommended:0},sections:{bestMatches:[],nearby:[],recommended:[]}};
 const props={initialResponse:response,initialSearchMode:true,initialLocationSource:'manual',hasUrlLocation:true,commentViewer:{userId:null},discoveryContent:{shortcuts:[]},homeContent:{inspiration:{items:[]},recommendedSalons:[],newSalons:[],popularServices:[]},initialFeed:{items:[]},quickActions:[],workspaceLocation:{label:'',source:'none'}};
 const cursor=tree=>{if(!tree||typeof tree!=='object')return null;if(tree.type?.name==='SearchContinuationFeed')return tree.props.response.nextCursor;for(const child of [tree.props?.children].flat(Infinity)){const found=cursor(child);if(found)return found;}return null};
 index=0;const firstTree=exports.ExploreClient(props);const first=cursor(firstTree);
 const hasQuickActions=tree=>Boolean(tree&&typeof tree==='object'&&(tree.type?.name==='QuickActions'||[tree.props?.children].flat(Infinity).some(hasQuickActions)));
 assert.equal(hasQuickActions(firstTree),false,'search results must not end in unrelated workspace shortcuts');
 index=0;const refreshed=cursor(exports.ExploreClient({...props,initialResponse:{...response,nextCursor:{session:'unrelated-server-read',after:12}}}));
 assert.equal(first,response.nextCursor);assert.equal(refreshed,response.nextCursor);
});
