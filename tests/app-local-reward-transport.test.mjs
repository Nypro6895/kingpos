import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {build} from 'esbuild';
import * as jsx from 'react/jsx-runtime';

function load(file, modules={}, globals={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>modules[name]??{},URL,URLSearchParams,Request,Response,Headers,DOMException,AbortController,setTimeout,clearTimeout,...globals});
 return exports;
}
const query=load('lib/app-local-reward-query.ts');
const roles=load('lib/app-local-platform-types.ts');
const salon='00000000-0000-4000-8000-000000000001';
const paths=[['/api/rewards/discover?location=Milwaukee%2C%20WI&category=All&kind=all&radius=5','http.rewards.discover'],['/api/rewards/program?salonId='+salon,'http.rewards.program'],['/api/rewards/owner-discovery','http.owner.reward-discovery']];
function harness({native=true,status=200,resultScope='account',hold=false}={}) {
 let scope='account',release,reads=[],originals=0,commands=0;
 const host={isNative:native,read:async(name,args,options)=>{reads.push({name,args,options});if(hold)await new Promise(done=>{release=done});return {scope:resultScope,data:{status,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({ok:status===200})}}},command:()=>{commands++;throw Error('Unexpected write')}};
 const globals={location:{href:'reylumi-app://bundle/explore'}};
 const explore=load('lib/app-local-explore-http-client.ts',{'./app-local-reward-query':query},globals);
 const role=load('lib/app-local-role-http-client.ts',{'./app-local-platform-types':roles},globals);
 const original=async()=>{originals++;throw TypeError('Unbridged local request')};
 const publicFetch=explore.createAppLocalExploreHttpFetch({scope:()=>scope,host:()=>host,fetch:original});
 const fetch=role.createAppLocalRoleHttpFetch({scope:()=>scope,host:()=>host,fetch:publicFetch});
 return {fetch,reads,counts:()=>({originals,commands}),changeScope:()=>{scope='other'},logout:()=>{scope=undefined},release:()=>release()};
}

test('all three Reward GETs cross the existing native read bridge at the bundle origin',async()=>{
 const h=harness();
 for(const [path,name]of paths){const response=await h.fetch(path,{cache:'no-store'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(h.reads.at(-1).name,name);assert.equal(h.reads.at(-1).options.scope,'account');}
 assert.equal(h.reads[0].args.location,'Milwaukee, WI');assert.equal(h.reads[1].args.salonId,salon);
 assert.deepEqual(h.counts(),{originals:0,commands:0});
 const coordinates=harness();await coordinates.fetch('/api/rewards/discover?lat=43.0389&lon=-87.9065&radius=10');assert.equal(coordinates.reads[0].args.lon,'-87.9065');
});
test('read bridge preserves owner denial and upstream failure without retries or writes',async()=>{
 for(const status of [400,401,403,503])for(const [path]of paths){const h=harness({status});assert.equal((await h.fetch(path)).status,status);assert.equal(h.reads.length,1);assert.deepEqual(h.counts(),{originals:0,commands:0});}
});
test('Reward query contract rejects unknown, duplicate, malformed and unbounded arguments before native dispatch',async()=>{
 const invalid=[
 '/api/rewards/discover?location=a&location=b','/api/rewards/discover?scope=other','/api/rewards/discover?lat=91&lon=0','/api/rewards/discover?lat=0','/api/rewards/discover?lat=&lon=0','/api/rewards/discover?lat=NaN&lon=0','/api/rewards/discover?kind=money','/api/rewards/discover?radius=100','/api/rewards/discover?category='+'x'.repeat(81),'/api/rewards/discover?location='+'x'.repeat(161),
 '/api/rewards/program','/api/rewards/program?salonId=invalid','/api/rewards/program?salonId='+salon+'&salonId='+salon,'/api/rewards/program?salonId='+salon+'&userId=other','/api/rewards/owner-discovery?salonId='+salon,
 ];
 const h=harness();for(const path of invalid)await assert.rejects(h.fetch(path),/Unsupported/);
 assert.equal(h.reads.length,0);assert.deepEqual(h.counts(),{originals:0,commands:0});
});
test('Reward reads cancel before and after bridge completion and reject account changes',async()=>{
 for(const [path]of paths){
  const before=harness(),pre=new AbortController();pre.abort();await assert.rejects(before.fetch(path,{signal:pre.signal}));assert.equal(before.reads.length,0);
  const h=harness({hold:true}),controller=new AbortController(),pending=h.fetch(path,{signal:controller.signal});assert.equal(h.reads.length,1);controller.abort();h.release();await assert.rejects(pending);assert.deepEqual(h.counts(),{originals:0,commands:0});
  const switched=harness({hold:true}),old=switched.fetch(path);switched.changeScope();switched.release();await assert.rejects(old,/account has changed/);
  const logout=harness({hold:true}),signedOut=logout.fetch(path);logout.logout();logout.release();await assert.rejects(signedOut,/account has changed/);
  const noScope=harness();noScope.logout();await assert.rejects(noScope.fetch(path),/Connect/);assert.equal(noScope.reads.length,0);assert.equal(noScope.counts().originals,0);
  await assert.rejects(harness({resultScope:'old-account'}).fetch(path),/account has changed/);
 }
});
test('browser, foreign origin, different methods and unknown paths retain previous fetch',async()=>{
 for(const [path,options,config]of [
  [paths[0][0],{}, {native:false}],['https://example.com'+paths[0][0],{},{}],[paths[1][0],{method:'POST'},{}],['/api/rewards/other',{},{}],
 ]){const h=harness(config);await assert.rejects(h.fetch(path,options),/Unbridged/);assert.equal(h.reads.length,0);assert.equal(h.counts().originals,1);}
});

function serverHarness({scope='account',authUnavailable=false,user=true,status=200,abortOnContext}={}){
 const calls=[];
 const original=async(request)=>{calls.push(request);return Response.json({salon:null},{status,headers:{'Cache-Control':'no-store'}})};
 const common={
  'node:crypto':{createHash},'next/server':{NextRequest:Request},'next/headers':{headers:async()=>new Headers({'cookie':'synthetic-session',...(authUnavailable?{'x-reylumi-auth-unavailable':'1'}:{})})},
  './request-business-context':{getRequestBusinessContext:async()=>{abortOnContext?.abort();return {user:user?{id:'u'}:null}}},'./experience-context':{getExperienceContext:()=>({scope})},
  './staff-portal-identity':{getStaffPortalIdentity:async()=>({context:{},staff:null})},'./app-local-reward-query':query,'./app-local-platform-types':roles,
  '@/app/api/rewards/discover/route':{GET:original},'@/app/api/rewards/program/route':{GET:original},'@/app/api/rewards/owner-discovery/route':{GET:()=>original()},
 };
 return {calls,read:load('lib/app-local-explore-server.ts',common).readAppLocalExploreResource,owner:load('lib/app-local-role-http-server.ts',common).readAppLocalRoleHttpResource};
}
test('native server dispatcher invokes exact Reward originals with current cookies and wire statuses',async()=>{
 const h=serverHarness({status:503});
 for(const [path,name]of paths){const args=Object.fromEntries(new URL(path,'https://reylumi.com').searchParams);const result=await (name.startsWith('http.owner.')?h.owner:h.read)(name,args,{scope:'account',etag:'ignored-control-etag'});assert.equal(result.scope,'account');assert.equal(result.status,200);assert.equal(result.data.status,503);assert.equal(result.data.headers['cache-control'],'no-store');}
 assert.equal(new URL(h.calls[0].url).pathname,'/api/rewards/discover');assert.equal(new URL(h.calls[0].url).searchParams.get('location'),'Milwaukee, WI');assert.equal(h.calls[0].headers.get('cookie'),'synthetic-session');assert.equal(h.calls[1].url,'https://reylumi.com'+paths[1][0]);assert.equal(h.calls.length,3);
});
test('native server validates arguments, account, outage and cancellation before calling originals',async()=>{
 const h=serverHarness();
 await assert.rejects(h.read('http.rewards.program',{salonId:salon,actor:'other'},{scope:'account'}),/Unsupported/);
 await assert.rejects(h.read('http.rewards.program',{salonId:7},{scope:'account'}),/Unsupported/);
 await assert.rejects(h.read('http.rewards.discover',{lat:'0'},{scope:'account'}),/Unsupported/);
 await assert.rejects(h.owner('http.owner.reward-discovery',{salonId:salon},{scope:'account'}),/Unsupported/);
 for(const name of ['http.rewards.discover','http.owner.reward-discovery']){
  const call=(instance,options)=>name.startsWith('http.owner.')?instance.owner(name,{},options):instance.read(name,{},options);
  await assert.rejects(call(h,{scope:'other'}),/account has changed/);
  await assert.rejects(call(serverHarness({authUnavailable:true}),{scope:'account'}),/reconnect/);
  const controller=new AbortController();controller.abort();await assert.rejects(call(h,{scope:'account',signal:controller.signal}));
  const during=new AbortController(),duringAuth=serverHarness({abortOnContext:during});await assert.rejects(call(duringAuth,{scope:'account',signal:during.signal}));assert.equal(duringAuth.calls.length,0);
 }
 await assert.rejects(h.owner('http.owner.reward-discovery',{},{}),/account has changed/);
 await assert.rejects(serverHarness({user:false}).owner('http.owner.reward-discovery',{},{scope:'account'}),/Sign in/);
 assert.equal(h.calls.length,0);assert.equal(await h.read('http.rewards.arbitrary',{},{scope:'account'}),null);
});
test('actual native packaging metadata emits three exact nonpersistent Reward reads',async()=>{
 // Execute the metadata bundling and read-policy generation statements from the
 // real packager, without its asset writes, activation or generated-file writes.
 const script=readFileSync('scripts/build-app-local-bundle.mjs','utf8');
 const begin=script.indexOf('const metadata = await build('),end=script.indexOf("reads.push({name:'staff.relay'",begin);
 assert.ok(begin>0&&end>begin);
 const emitted=await new (Object.getPrototypeOf(async function(){}).constructor)('build','root',script.slice(begin,end)+'return {reads,meta};')(build,process.cwd());
 for(const name of ['http.rewards.discover','http.rewards.program','http.owner.reward-discovery']){
  const matches=emitted.reads.filter(row=>row.name===name);assert.equal(matches.length,1);assert.equal(matches[0].path,'/api/app-local/read');assert.equal(matches[0].access,'scoped');assert.equal(matches[0].cacheable,false);
 }
 const discover=emitted.meta.APP_LOCAL_EXPLORE_READS.find(row=>row.name==='http.rewards.discover');assert.equal(discover.retain,false);assert.deepEqual([...discover.argumentKeys],['lat','lon','location','category','kind','radius']);
 assert.equal(emitted.meta.APP_LOCAL_EXPLORE_READS.find(row=>row.name==='http.rewards.program').retain,false);
 const compiled=await build({stdin:{contents:'export {appLocalReadIsDurable} from "./lib/app-local-data-policy"',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node'});
 const policy={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(policy,policy.exports);
 for(const name of ['http.rewards.discover','http.rewards.program','http.owner.reward-discovery'])assert.equal(policy.exports.appLocalReadIsDurable(name),false);
});
test('native salon reward links resolve locally and mount actor-keyed panel with current profile guards',()=>{
 const anchor=load('lib/app-local-public-anchor.ts');let scrolled=0;
 const reward=()=>null,profile=()=>null;
 const pathname='/explore/salons/'+salon,path=pathname+'#salon-rewards';
 const api=load('lib/app-local-public-registry.tsx',{
  react:{useEffect:effect=>effect()},'react/jsx-runtime':jsx,'./app-local-public-anchor':anchor,'./app-local-public-metadata':{APP_LOCAL_BOOKING_QUERY_KEYS:[]},
  '@/app/salon-profile/salon-profile-view':{SalonProfileView:profile},'@/components/rewardlumi/reward-salon-panel':{RewardSalonPanel:reward},
 },{location:{pathname,search:'',hash:'#salon-rewards'},document:{getElementById:id=>id==='salon-rewards'?{scrollIntoView:()=>scrolled++}:null},requestAnimationFrame:callback=>{callback();return 1},cancelAnimationFrame:()=>{}});
 assert.equal(api.getAppLocalPublicPage(path).id,'public.salon');assert.equal(api.getAppLocalPublicPage(pathname+'#unknown'),null);assert.equal(api.getAppLocalPublicPage(pathname+'?actor=other#salon-rewards'),null);
 const data={view:'salon',props:{capabilities:{currentUserId:'one',canBook:true},data:{profile:{salonId:salon,activeServiceCount:1}}}};
 const element=api.AppLocalPublicView({data,path}),panel=element.props.children[0];
 assert.equal(panel.type,reward);assert.equal(panel.props.salonId,salon);assert.equal(panel.props.canBook,true);assert.equal(scrolled,1);assert.equal(element.props.children[1].type,profile);
 data.props.capabilities.currentUserId='two';data.props.data.profile.activeServiceCount=0;
 const second=api.AppLocalPublicView({data,path}).props.children[0];assert.equal(second.props.canBook,false);assert.notEqual(second.key,panel.key);
 data.props.capabilities.canBook=false;data.props.data.profile.activeServiceCount=1;assert.equal(api.AppLocalPublicView({data,path}).props.children[0].props.canBook,false);
 data.props.capabilities=undefined;const restricted=api.AppLocalPublicView({data,path}).props.children[0];assert.equal(restricted.props.canBook,false);assert.match(restricted.key,/guest$/);
});
