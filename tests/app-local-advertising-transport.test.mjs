import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';

const secret='synthetic-native-ad-transport-test-only';
async function bundle(contents,mocks={}){
 const result=await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',define:{'process.env.ADVERTISING_IP_HASH_SECRET':JSON.stringify(secret),'process.env.SUPABASE_SERVICE_ROLE_KEY':'""'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},({path})=>Object.hasOwn(mocks,path)?{path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:mocks[path],loader:'js'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const client=await bundle('export * from "./lib/app-local-shell-http-client";',{'./app-local-host':'export const getAppLocalHost=()=>null;','./app-local-command-client':'export const getAppLocalCommandScope=()=>undefined;'});
const ok={status:200,headers:{'content-type':'application/json'},body:'{"ok":true}'};
const ids={user:'11111111-1111-4111-8111-111111111111',guest:'22222222-2222-4222-8222-222222222222',other:'33333333-3333-4333-8333-333333333333',request:'44444444-4444-4444-8444-444444444444',campaign:'55555555-5555-4555-8555-555555555555'};
const report=(proof='v1.'+'a'.repeat(5000))=>({requestId:ids.request,kind:'owner_campaign',proof,reason:'scam',details:'Please review this promotion.'});
function adapter(){let scope='scope-a';const calls=[];const host={isNative:true,read:async(name,args,options)=>{calls.push({kind:'read',name,args,scope:options.scope});return{data:ok};},command:async(name,args,options)=>{calls.push({kind:'command',name,args,scope:options.scope});return ok;}};return{calls,host,setScope:v=>scope=v,fetch:client.createAppLocalShellHttpFetch({location:'reylumi-app://bundle/explore',scope:()=>scope,host:()=>host,fetch:async()=>{calls.push({kind:'fallback'});throw Error('No native HTTPS fallback');}})};}
const post=body=>({method:'POST',headers:{'content-type':'application/json','referer':'https://untrusted.example/private'},body:JSON.stringify(body)});
test('native manual/query-only and GPS selection use private nonretained read body, preserving optional values',async()=>{
 const f=adapter();for(const input of [{kind:'select',location:'Milwaukee',query:'',batch:false},{kind:'select',location:'',latitude:43.1,longitude:-87.9,query:'nails',batch:true}])await f.fetch('/api/campaigns/delivery',post(input));
 assert.deepEqual(f.calls,[{kind:'read',name:'http.shell.campaigns',args:{selection:'1',location:'Milwaukee',query:'',batch:'0'},scope:'scope-a'},{kind:'read',name:'http.shell.campaigns',args:{selection:'1',location:'',latitude:'43.1',longitude:'-87.9',query:'nails',batch:'1'},scope:'scope-a'}]);
});
test('only exact proof-backed platform view/reserve may exceed 2KB; confirm/click and unrelated events keep old bound',async()=>{
 const f=adapter(),input={id:ids.campaign,event:'view',phase:'reserve',path:'/explore',device:'mobile',disclosureProof:'v1.'+'a'.repeat(6000)};await f.fetch('/api/explore/advertising',post(input));assert.deepEqual(f.calls[0].args,{input});
 for(const bad of [{...input,event:'click'},{...input,phase:'confirm'},{...input,url:'https://evil.example'},{...input,disclosureProof:'x'.repeat(40001)}])await assert.rejects(f.fetch('/api/explore/advertising',post(bad)));assert.equal(f.calls.length,1);
});
test('legacy GET and view/click/platform events retain their original transport',async()=>{
 const f=adapter();await f.fetch('/api/campaigns/delivery?location=WI');for(const kind of ['view','click'])await f.fetch('/api/campaigns/delivery',post({kind,ticket:'signed'}));for(const kind of ['reserve','confirm'])await f.fetch('/api/explore/advertising',post({kind}));
 assert.equal(f.calls[0].name,'http.shell.campaigns');assert.deepEqual(f.calls[0].args,{location:'WI'});assert.deepEqual(f.calls.slice(1).map(x=>x.name),['http.shell.campaign-event','http.shell.campaign-event','http.shell.advertising-event','http.shell.advertising-event']);
});
test('native report carries exact frozen object above old 2KB bound; no caller headers/path authority',async()=>{
 const f=adapter(),input=report();await f.fetch(new Request('reylumi-app://bundle/api/advertising/reports',post(input)));assert.deepEqual(f.calls,[{kind:'command',name:'http.shell.advertising-report',args:{input},scope:'scope-a'}]);
 for(const value of [{...input,target:'arbitrary'}, {...input,details:'é'.repeat(1001)}, {...input,proof:'a'.repeat(40001)}])await assert.rejects(f.fetch('/api/advertising/reports',post(value)));
 await assert.rejects(f.fetch('/api/advertising/reports',{...post(input),headers:{'content-type':'text/plain'}}));assert.equal(f.calls.length,1);
 await assert.rejects(f.fetch('/api/advertising/arbitrary',post(input)),/fallback/);assert.equal(f.calls.at(-1).kind,'fallback');
});
test('UTF8 streaming and scope/abort checks stop oversized or late dispatch/delivery without repeating commands',async()=>{
 const f=adapter();await assert.rejects(f.fetch('/api/advertising/reports',{...post(report()),body:'é'.repeat(20001)}));await assert.rejects(f.fetch(new Request('reylumi-app://bundle/api/advertising/reports',{method:'POST',headers:{'content-type':'application/json'},body:'é'.repeat(20001)})));assert.equal(f.calls.length,0);
 let resolve;f.host.command=()=>new Promise(r=>resolve=r);const pending=f.fetch('/api/advertising/reports',post(report()));await new Promise(r=>setTimeout(r,0));f.setScope('scope-b');resolve(ok);await assert.rejects(pending,/account has changed/);
 const c=new AbortController();c.abort();await assert.rejects(f.fetch('/api/advertising/reports',{...post(report()),signal:c.signal}));
 const g=adapter();let push;const body=new ReadableStream({start(c){push=c;}});const reading=g.fetch(new Request('reylumi-app://bundle/api/advertising/reports',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}));g.setScope('scope-b');push.enqueue(new TextEncoder().encode(JSON.stringify(report())));push.close();await assert.rejects(reading,/account has changed/);assert.equal(g.calls.length,0);
});

const mocks={
 'server-only':'',
 'next/headers':'export const headers=async()=>new Headers(globalThis.__nativeAds.headers);export const cookies=async()=>({get:name=>({value:globalThis.__nativeAds.cookies[name]}),set:cookie=>globalThis.__nativeAds.setCookies.push(cookie)});',
 'next/server':'export const NextRequest=Request;',
 './request-business-context':'export async function getRequestBusinessContext(){globalThis.__nativeAds.admissions++;return globalThis.__nativeAds.context;}',
 './experience-context':'export const getExperienceContext=c=>({scope:c.scope});',
 './current-context':'export const getCurrentStaffBusinessContext=async()=>globalThis.__nativeAds.context;export const isOwnerMembership=()=>false;export const isSalonManageContext=()=>false;',
 '@/lib/current-context':'export async function getCurrentBusinessContext(){globalThis.__nativeAds.freshActorReads++;return globalThis.__nativeAds.context;}',
 '@/lib/abuse-server':'export async function assertAbuseRequest(kind){globalThis.__nativeAds.abuse.push(kind);if(globalThis.__nativeAds.abuseDenied)throw Error("denied");}',
 '@/lib/explore-advertising':'export const advertisingClient=()=>({rpc:async(name,args)=>{globalThis.__nativeAds.rpc.push({name,args});return {data:name==="get_verified_ad_report_receipt"?null:{reportId:"66666666-6666-4666-8666-666666666666",reference:"AD-fixture",guestThreadId:null},error:null};}});',
 './staff-portal-identity':'export const getStaffPortalIdentity=async()=>({context:globalThis.__nativeAds.context});',
 '@/app/salon-switcher':'export const getSalonSwitcherProps=async()=>null;',
 '@/components/abuse-notice':'export const getAbuseNoticeData=async()=>null;',
 './vietnamese-plugin':'export const vietnamesePluginState=async()=>null;',
 './explore-advertising':'export const advertisingClient=()=>{throw Error("unexpected wallet");};',
 './owner-campaigns':'export const ownerCampaignSettings=async()=>null;',
 './workspace-pending':'export const getWorkspacePendingSummary=async()=>null;',
 './workspace-language-server':'export const getWorkspaceTranslation=async()=>x=>x;',
 './salon-language-server':'export const getSalonLanguageForContext=async()=>null;',
 './bounded-get':'export const runReadWithDeadline=p=>p;',
 '@/lib/workspace-selection':'export const selectWorkspaceContext=async()=>{throw Error("unexpected switch");};',
 '@/app/api/campaigns/delivery/route':'async function forward(request){const f=globalThis.__nativeAds;f.forward.push({url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body:request.method==="POST"?await request.json():null});const response=Response.json({selected:true});response.cookies={getAll:()=>[{name:"reylumi-owner-ad-report",value:"private-cookie",httpOnly:true,secure:true,sameSite:"lax",path:"/"}]};return response;}export const GET=forward,POST=forward;',
};
for(const p of ['@/app/api/membership/salon-badges/route','@/app/api/forum/latest/route','@/app/(app)/api/auth/session/route','@/app/(app)/api/auth/logout/route','@/app/api/public-booking/context/route','@/app/api/explore/advertising/route'])mocks[p]='export const GET=async()=>Response.json({ok:true});export const POST=GET;';
const server=await bundle('export {readAppLocalShellResource,runAppLocalShellCommand} from "./lib/app-local-shell-server";export {sealAdDisclosureProof} from "./lib/ad-disclosure-ticket";export {APP_LOCAL_SHELL_READS,APP_LOCAL_SHELL_COMMANDS} from "./lib/app-local-shell-metadata";',mocks);
function fixture(userId=null){return globalThis.__nativeAds={context:{scope:'scope-a',user:userId?{id:userId,status:'active'}:null},headers:{cookie:'nativeHttpOnly=fixture','x-vercel-forwarded-for':'192.0.2.1','user-agent':'synthetic-WKWebView',referer:'https://untrusted.example/private'},cookies:{'reylumi-owner-ad-report':ids.guest},setCookies:[],forward:[],admissions:0,freshActorReads:0,abuse:[],rpc:[]};}
const commandRequest=(origin='https://reylumi.com')=>new Request('https://reylumi.com/api/app-local/command',{method:'POST',headers:{origin,'content-type':'application/json'}});
function proof(actor){const now=Date.now(),selectedAt=new Date(now).toISOString();return server.sealAdDisclosureProof({version:1,selectionId:ids.request,issuedAt:now,expiresAt:now+600000,target:{kind:'owner_campaign',campaignId:ids.campaign,sourceType:'custom',sourceId:ids.campaign,salonId:ids.other},snapshot:{advertiserName:'Fixture salon',title:'Promotion',caption:'Synthetic public caption',mediaBucket:null,mediaPath:null,destinationPath:'/explore',selectedAt},summary:{locationSource:'manual',areaLabel:'WI',searchKind:null,searchCategory:null,page:'explore',device:'mobile',audience:'guest',selectionRuleCodes:[],selectedAt},disclosure:{advertiserName:'Fixture salon',primaryReasons:['Fixture area','Fixture placement'],details:[]}},actor,{secret});}
test('server reconstructs exact select POST, canonical Origin/current HttpOnly cookie, no Referer; syncs selected cookies outside DTO',async()=>{
 const f=fixture();const input={selection:'1',location:'WI',batch:'0',query:''};const result=await server.readAppLocalShellResource('http.shell.campaigns',input,{scope:'scope-a'});assert.equal(f.admissions,1);assert.deepEqual(f.forward[0].body,{kind:'select',location:'WI',batch:false,query:''});assert.equal(f.forward[0].method,'POST');assert.equal(f.forward[0].url,'https://reylumi.com/api/campaigns/delivery');assert.deepEqual(f.forward[0].headers,{'content-type':'application/json',cookie:'nativeHttpOnly=fixture',origin:'https://reylumi.com','user-agent':'synthetic-WKWebView','x-vercel-forwarded-for':'192.0.2.1'});assert.equal(f.setCookies[0].httpOnly,true);assert(!JSON.stringify(result).includes('private-cookie'));assert.equal(result.data.headers['set-cookie'],undefined);
 await assert.rejects(server.readAppLocalShellResource('http.shell.campaigns',{...input,latitude:'',longitude:'0'},{scope:'scope-a'}),e=>e.status===400);await assert.rejects(server.readAppLocalShellResource('http.shell.campaigns',{...input,url:'/arbitrary'},{scope:'scope-a'}),e=>e.status===400);
 await server.readAppLocalShellResource('http.shell.campaigns',{location:'WI',latitude:'43',longitude:'-87',batch:'1'},{scope:'scope-a'});assert.equal(f.forward.at(-1).headers['content-type'],'application/json');assert.deepEqual(f.forward.at(-1).body,{kind:'select',location:'WI',latitude:43,longitude:-87,batch:true});
});
test('actual report handler verifies guest/user proof against fresh actor, passes abuse gate, preserves no-store/no-referrer and exact receipt',async()=>{
 for(const userId of [null,ids.user]){const f=fixture(userId),input=report(proof({kind:userId?'user':'guest',id:userId??ids.guest}));const value=await server.runAppLocalShellCommand('http.shell.advertising-report',{input},commandRequest(),'scope-a');assert.equal(value.handled,true);assert.equal(value.data.status,200);assert.deepEqual(f.abuse,['report']);assert.equal(f.freshActorReads,1);assert.equal(f.rpc.length,2);assert.equal(f.rpc[1].args.p_actor_user_id,userId);assert.equal(f.rpc[1].args.p_request_id,input.requestId);assert.equal(value.data.headers['referrer-policy'],'no-referrer');assert.equal(value.data.headers['cache-control'],'private, no-store');assert.equal(JSON.parse(value.data.body).supportHref,userId?'/support/66666666-6666-4666-8666-666666666666':null);}
});
test('native report cannot borrow old-account proof, arbitrary context/path, withdrawn auth or foreign Origin; security rejection stays rejected',async()=>{
 const f=fixture(ids.other),input=report(proof({kind:'user',id:ids.user}));const value=await server.runAppLocalShellCommand('http.shell.advertising-report',{input},commandRequest(),'scope-a');assert.equal(value.data.status,400);assert.equal(JSON.parse(value.data.body).outcome,'rejected');assert.equal(f.rpc.length,0);
 await assert.rejects(server.runAppLocalShellCommand('http.shell.advertising-report',{input,url:'https://evil.example'},commandRequest(),'scope-a'),e=>e.status===400);await assert.rejects(server.runAppLocalShellCommand('http.shell.advertising-report',{input},commandRequest('https://evil.example'),'scope-a'),e=>e.status===403);await assert.rejects(server.runAppLocalShellCommand('http.shell.advertising-report',{input},commandRequest(),'other-scope'),e=>e.status===409);f.headers['x-reylumi-auth-unavailable']='1';await assert.rejects(server.runAppLocalShellCommand('http.shell.advertising-report',{input},commandRequest(),'scope-a'),e=>e.status===503);
 const g=fixture();g.abuseDenied=true;const rejected=await server.runAppLocalShellCommand('http.shell.advertising-report',{input:report(proof({kind:'guest',id:ids.guest}))},commandRequest(),'scope-a');assert.equal(rejected.data.status,400);assert.equal(g.rpc.length,1);assert.deepEqual(g.abuse,['report']);
});
test('server body bounds and legacy campaign command still reject select disguised as billable event; signed manifest source declares exact new transport',async()=>{
 fixture();await assert.rejects(server.runAppLocalShellCommand('http.shell.advertising-report',{input:report('x'.repeat(40000))},commandRequest(),'scope-a'),e=>e.status===400);await assert.rejects(server.runAppLocalShellCommand('http.shell.campaign-event',{input:{kind:'select',location:'WI'}},commandRequest(),'scope-a'),e=>e.status===400);
 assert.deepEqual(server.APP_LOCAL_SHELL_COMMANDS.find(x=>x.name==='http.shell.advertising-report').argumentKeys,['input']);const selection=server.APP_LOCAL_SHELL_READS.find(x=>x.name==='http.shell.campaigns');assert.equal(selection.retain,false);assert(selection.argumentKeys.includes('selection'));
 const route=await readFile('app/api/app-local/command/route.ts','utf8');assert(route.includes('length > 262144'));assert(JSON.parse(await readFile('lib/app-local-command-trace-names.generated.json','utf8')).names.includes('http.shell.advertising-report'));
});

const routeMocks={...mocks,
 'next/server':'export const NextRequest=Request;export const connection=async()=>{};',
 '@/lib/read-context-scope':'export const runWithReadContext=fn=>fn();',
 '@/lib/scoped-business-context':'export const runInBusinessContext=(c,fn)=>fn();',
 '@/app/api/app-local/context/route':'export const GET=async()=>Response.json({});',
 '@/lib/current-context':mocks['@/lib/current-context']+'export const projectSelectedWorkspaceRead=async()=>globalThis.__nativeAds.context;export const getCurrentStaffBusinessContext=async()=>globalThis.__nativeAds.context;',
 '@/lib/request-business-context':mocks['./request-business-context'],
 '@/lib/experience-context':mocks['./experience-context'],
 '@/lib/staff-portal-identity':mocks['./staff-portal-identity'],
 '@/lib/app-local-commands-server.generated':'export const runAppLocalCommand=async()=>{throw Error("unapproved command");};',
 '@/lib/app-local-command-codec':'export const decodeAppLocalValue=x=>x;',
 '@/lib/app-local-portable-context-server':'export const requireAppLocalPortableScope=async()=>{throw Error("unexpected portable scope");};',
 '@/lib/app-local-scope-id':'export const isAppLocalScopeId=x=>typeof x==="string"&&x.startsWith("scope-");export const isAppLocalPortableScopeId=()=>false;',
 '@/lib/app-local-portable-actions.generated.json':'export default {ids:[]};',
 '@/lib/app-local-display-server':'export const authorizeAppLocalDisplayCommand=async()=>false;',
 '@/lib/app-local-guest-read-policy':'export const APP_LOCAL_GUEST_HIDDEN_POSTS_READ="fixture.hidden-read";',
 '@/lib/app-local-getter-read-scope':'export const runWithAppLocalGetterReadScope=(c,fn)=>fn();',
 '@/lib/supabase/auth-rest':'export class AuthAvailabilityError extends Error{}',
 '@/lib/app-local-command-trace':'export const createAppLocalCommandTrace=()=>({run:fn=>fn(),finish:x=>x,measure:(label,fn)=>fn(),setCommand(){},failure(){},error(){},thrown(){}});',
};
for(const [path,name]of Object.entries({'@/lib/app-local-http-server':'runAppLocalHttpCommand','@/lib/app-local-role-http-server':'runAppLocalRoleHttpCommand','@/lib/app-local-personal-resources-server':'runAppLocalPersonalCommand','@/lib/app-local-explore-server':'runAppLocalExploreHttpCommand','@/lib/app-local-public-server':'runAppLocalPublicHttpCommand','@/lib/app-local-portable-http-server':'runAppLocalPortableHttpCommand','@/lib/app-local-upload-server':'runAppLocalUploadCommand'}))routeMocks[path]=`export const ${name}=async()=>({handled:false});export class AppLocalUploadError extends Error{}`;
const outer=await bundle('export {POST} from "./app/api/app-local/command/route";',routeMocks);
const outerRequest=(input,headers={})=>new Request('https://reylumi.com/api/app-local/command',{method:'POST',headers:{origin:'https://reylumi.com','content-type':'application/json',...headers},body:JSON.stringify(input)});
test('actual outer command admits guest/auth report only through matching current scope; actor proof and 256KiB outer envelope remain authoritative',async()=>{
 for(const userId of [null,ids.user]){const f=fixture(userId),input=report(proof({kind:userId?'user':'guest',id:userId??ids.guest}));const response=await outer.POST(outerRequest({name:'http.shell.advertising-report',requestId:ids.request,scope:'scope-a',args:{input}}));assert.equal(response.status,200);assert.equal((await response.json()).data.status,200);assert.deepEqual(f.abuse,['report']);assert(f.admissions>=2);}
 const f=fixture(),args={input:report(proof({kind:'guest',id:ids.guest}))},envelope={name:'http.shell.advertising-report',requestId:ids.request,scope:'scope-a',args};assert.equal((await outer.POST(outerRequest({...envelope,scope:'scope-b'}))).status,401);assert.equal(f.rpc.length,0);assert.equal((await outer.POST(outerRequest(envelope,{origin:'https://evil.example'}))).status,403);assert.equal((await outer.POST(outerRequest({...envelope,padding:'x'.repeat(262145)}))).status,413);assert.equal((await outer.POST(outerRequest({...envelope,name:'http.shell.arbitrary'}))).status,401);assert.equal(f.rpc.length,0);
});

const platformMocks={...mocks,
 'next/server':`export class NextRequest extends Request{get nextUrl(){return new URL(this.url);}get cookies(){return{get:name=>({value:globalThis.__nativeAds.cookies[name]})};}}export class NextResponse extends Response{static json(value,options){const r=Response.json(value,options),all=[];r.cookies={set:(name,value,opts)=>all.push({name,value,...opts}),getAll:()=>all};return r;}}`,
 '@/lib/request-business-context':mocks['./request-business-context'],
 '@/lib/explore-advertising':`export const getCampaigns=async()=>[{id:"${ids.campaign}",enabled:true}];export const getAdvertisingLimits=async()=>({sessionMinutes:30});export const advertisingClient=()=>({rpc:async(name,args)=>{const f=globalThis.__nativeAds;f.rpc.push({name,args});return {error:null,data:name==="reserve_advertising_display_disclosed"?{reservation:"${ids.request}",trace:{version:1,admittedAt:new Date().toISOString(),limits:{maxTotal:10,maxPopups:2,minPopupGapSeconds:30,sessionMinutes:30},session:{viewsBefore:0,reservationsBefore:0,totalBefore:0,sameCampaignViewed:false},popup:{applicable:false,viewsBefore:null,reservationsBefore:null,totalBefore:null,priorPopupAt:null,gapSatisfied:null},repeat:{rule:"always",checked:false,eligible:true,historyScope:"visitor_key_may_be_shared_network",timeZone:"America/Chicago"}}}:true};}});`,
 '@/lib/explore-advertising-rules':'export const campaignActive=()=>true;export const campaignMatches=()=>true;',
 '@/lib/advertising-attribution':'export const AD_ATTRIBUTION_COOKIE="synthetic-attribution";export const signAdAttribution=()=>"synthetic-signed";',
};delete platformMocks['@/app/api/explore/advertising/route'];
const platform=await bundle('export {runAppLocalShellCommand,readAppLocalShellResource} from "./lib/app-local-shell-server";export {sealAdDisclosureProof} from "./lib/ad-disclosure-ticket";',platformMocks);
test('native adapter -> actual shell -> actual platform route carries large AES selection into admission, then confirms/clicks without proof or changed billing semantics',async()=>{
 const f=fixture(),now=Date.now(),selectedAt=new Date(now).toISOString();f.cookies['reylumi-platform-ad-report']=ids.guest;f.cookies['reylumi-ad-session']=ids.request;
 const proof=platform.sealAdDisclosureProof({version:1,selectionId:ids.request,issuedAt:now,expiresAt:now+600000,target:{kind:'platform_campaign',campaignId:ids.campaign,sourceType:'explore_campaign',sourceId:ids.campaign,salonId:null},snapshot:{advertiserName:'Fixture',title:'Promotion',caption:'Synthetic public caption '.repeat(100),mediaBucket:null,mediaPath:null,destinationPath:'/explore',selectedAt},summary:{locationSource:'none',areaLabel:null,searchKind:null,searchCategory:null,page:'/explore',device:'mobile',audience:'guest',selectionRuleCodes:[],selectedAt},disclosure:{advertiserName:'Fixture',primaryReasons:['Fixture page','Fixture audience'],details:[{label:'Page used',value:'/explore'}]}},{kind:'guest',id:ids.guest},{secret});assert(proof.length>2048);
 const sent=[];const transport=client.createAppLocalShellHttpFetch({location:'reylumi-app://bundle/explore',scope:()=> 'scope-a',fetch:()=>{throw Error('Native fallback forbidden');},host:()=>({isNative:true,command:async(name,args,{scope})=>{sent.push(args.input);return(await platform.runAppLocalShellCommand(name,args,commandRequest(),scope)).data;}})});
 const reserve={id:ids.campaign,event:'view',phase:'reserve',path:'/explore',device:'mobile',disclosureProof:proof};const admitted=await(await transport('/api/explore/advertising',post(reserve))).json();assert.equal(admitted.allowed,true);assert.equal(admitted.reservation,ids.request);assert(admitted.admissionDisclosure.proof);assert.equal(f.rpc[0].name,'reserve_advertising_display_disclosed');
 for(const body of [{id:ids.campaign,event:'view',phase:'confirm',reservation:ids.request,path:'/explore',device:'mobile'},{id:ids.campaign,event:'click',reservation:ids.request,path:'/explore',device:'mobile'}])assert.equal((await(await transport('/api/explore/advertising',post(body))).json()).allowed,true);
 assert.deepEqual(f.rpc.map(x=>x.name),['reserve_advertising_display_disclosed','confirm_advertising_display','confirm_advertising_display','record_advertising_event']);assert(!('disclosureProof'in sent[1]));assert(!('disclosureProof'in sent[2]));assert.equal(f.rpc.at(-1).args.p_kind,'click');assert(f.setCookies.some(x=>x.name==='reylumi-ad-session'&&x.httpOnly));
});
