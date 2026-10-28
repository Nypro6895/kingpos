import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = {
  'server-only': '',
  'next/headers': 'export const headers=async()=>new Headers(globalThis.__aux.headers);export const cookies=async()=>({set(){}});',
  'next/server': 'export const NextRequest=Request;',
  './request-business-context': 'export async function getRequestBusinessContext(){globalThis.__aux.admissions++;return globalThis.__aux.context;}',
  './experience-context': 'export const getExperienceContext=c=>({scope:c.scope});',
  './current-context': 'export const getCurrentStaffBusinessContext=async()=>globalThis.__aux.context;export const isOwnerMembership=()=>false;export const isSalonManageContext=()=>false;',
  './staff-portal-identity': 'export const getStaffPortalIdentity=async()=>({context:globalThis.__aux.context});',
  '@/app/salon-switcher': 'export const getSalonSwitcherProps=async()=>null;',
  '@/components/abuse-notice': 'export async function getAbuseNoticeData(){globalThis.__aux.notice++;if(globalThis.__aux.noticeError)throw globalThis.__aux.noticeError;return "warning";}',
  './vietnamese-plugin': 'export async function vietnamesePluginState(){globalThis.__aux.config++;return {active:true,staff_enabled:true,portable_enabled:false,paid_until:null,trial_ends_at:null};}',
  './explore-advertising': 'export function advertisingClient(){throw Error("Staff must not enter owner wallet");}',
  './owner-campaigns': 'export async function ownerCampaignSettings(){throw Error("Unexpected campaign read");}',
  './workspace-pending': 'export async function getWorkspacePendingSummary(){globalThis.__aux.summary++;if(globalThis.__aux.summaryError)throw globalThis.__aux.summaryError;return {unread:7};}',
  './workspace-language-server': 'export const getWorkspaceTranslation=async()=>x=>({...x,translated:true});',
  './bounded-get': 'export const runReadWithDeadline=p=>p;',
  '@/lib/workspace-selection': 'export const selectWorkspaceContext=async()=>{throw Error("No command in read");};',
};
for (const p of ['@/app/(app)/api/auth/session/route','@/app/(app)/api/auth/logout/route','@/app/api/public-booking/context/route','@/app/api/explore/advertising/route','@/app/api/campaigns/delivery/route']) mocks[p]='export const GET=async()=>{throw Error("Unexpected HTTP forward");};export const POST=GET;';
const built=await build({stdin:{contents:'export {readAppLocalShellResource} from "./lib/app-local-shell-server";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},({path})=>Object.hasOwn(mocks,path)?{path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:mocks[path],loader:'js'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture(){return globalThis.__aux={headers:{},admissions:0,config:0,summary:0,notice:0,context:{scope:'scope-a',user:{id:'viewer'},workspaceType:'salon',salonMode:'staff',currentStaffSalon:{id:'salon'},currentWorkspace:{id:'staff:salon'}}};}
const read=(name='shell.auxiliary',options={scope:'scope-a'})=>api.readAppLocalShellResource(name,{},options);

test('one admission returns the same three guarded fields as independent shell reads',async()=>{
  const f=fixture();const batch=await read();assert.equal(f.admissions,1);assert.deepEqual([f.config,f.summary,f.notice],[1,1,1]);
  for(const [key,name]of [['configuration','shell.configuration'],['summary','shell.summary'],['notice','shell.notice']])assert.deepEqual(batch.data[key].data,(await read(name)).data);
  assert.equal(f.admissions,4);assert.equal(batch.data.configuration.data.language.enabled,true);assert.equal(batch.data.summary.data.summary.unread,7);
});
test('workspace mismatch and unsupported arguments reject before auxiliary data reads',async()=>{
  const f=fixture();await assert.rejects(read('shell.auxiliary',{scope:'other'}),e=>e.status===409);
  await assert.rejects(api.readAppLocalShellResource('shell.auxiliary',{salonId:'other'},{scope:'scope-a'}),e=>e.status===400);
  assert.deepEqual([f.config,f.summary,f.notice],[0,0,0]);
});
test('transient field failure preserves independent fallback without hiding successful fields',async()=>{
  const f=fixture();f.noticeError=new Error('private upstream details');const value=await read();
  assert.deepEqual(value.data.notice,{unavailable:true});assert(value.data.configuration.data);assert(value.data.summary.data);
  assert(!JSON.stringify(value).includes('private upstream'));await assert.rejects(read('shell.notice'),/private upstream/);
});
test('authoritative denial rejects the whole batch and is never converted into optional unavailability',async()=>{
  for(const status of [401,403,409]){const f=fixture();f.summaryError=Object.assign(new Error('withdrawn'),{status});await assert.rejects(read(),e=>e.status===status);}
});
test('next request observes a changed scope; guest summary never reads private pending state',async()=>{
  const f=fixture();const first=await read();f.context={...f.context,scope:'scope-b',user:null};await assert.rejects(read(),e=>e.status===409);
  const next=await read('shell.auxiliary',{scope:'scope-b'});assert.equal(next.data.scope,'scope-b');assert.deepEqual(next.data.summary,{unavailable:true});assert.equal(f.summary,1);assert.equal(first.data.scope,'scope-a');
});
test('conditional reads still authorize freshly and aborted requests cannot publish a batch',async()=>{
  const f=fixture();const first=await read();const next=await read('shell.auxiliary',{scope:'scope-a',etag:first.etag});assert.equal(next.status,304);assert.equal(next.data,undefined);assert.equal(f.admissions,2);
  const c=new AbortController();c.abort();await assert.rejects(read('shell.auxiliary',{scope:'scope-a',signal:c.signal}));assert.equal(f.admissions,2);
});

const uiMocks={
  'next/navigation':'export const usePathname=()=>globalThis.__auxUI.path;export const useRouter=()=>({push(){}});',
  '@/lib/app-local-resource':'export function useAppLocalResource(scope,name,args,options){globalThis.__auxUI.calls.push({scope,name,enabled:options.enabled});return globalThis.__auxUI.states[name]??{};}',
  '@/app/navigation-shell':'export const NavigationShell=({children})=>children;',
  '@/app/guest-navigation-shell':'export const GuestNavigationShell=({children,accountFallback})=>React.createElement(React.Fragment,null,accountFallback,children);',
  './workspace-language':'export function WorkspaceLanguageProvider({children,enabled}){globalThis.__auxUI.language=enabled;return children;}',
  './campaign-plugin-context':'export const CampaignPluginProvider=({children})=>children;',
  './explore-account-actions':'export const ExploreAccountActionsProvider=({children})=>children;',
  './explore-advertising':'export const ExploreAdvertising=({children})=>children;',
};
for(const [p,name]of Object.entries({'@/app/action-dialog':'ActionDialog','./quick-booking':'QuickBooking','./app-local-session-expiry-prompt':'AppLocalSessionExpiryPrompt','./overlay-dismissal':'OverlayDismissal','./owner-campaign-runtime':'OwnerCampaignRuntime','@/app/pos/owner-queue-runtime':'OwnerQueueRuntime','./abuse-notice-view':'AbuseNoticeView','@/app/notifications/workspace-summary-seed':'WorkspaceSummarySeed'}))uiMocks[p]=`export const ${name}=()=>null;`;
const uiBuilt=await build({stdin:{contents:'export {AppLocalShell} from "./components/app-local-shell";export {appLocalCommandAffectsResource} from "./lib/app-local-resource-invalidation";',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'node',format:'esm',external:['react','react-dom'],jsx:'automatic',plugins:[{name:'ui-boundaries',setup(b){b.onResolve({filter:/.*/},({path})=>Object.hasOwn(uiMocks,path)?{path,namespace:'ui-fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'ui-fixture'},({path})=>({contents:"import React from 'react';"+uiMocks[path],loader:'jsx'}));}}]});
// A file-backed ESM import keeps external React resolution on the repo's package tree.
const {writeFile,mkdir,mkdtemp,rm}=await import('node:fs/promises');const {pathToFileURL}=await import('node:url');const {resolve,sep}=await import('node:path');
const artifactRoot=resolve(process.cwd(),'artifacts');await mkdir(artifactRoot,{recursive:true});
const temp=await mkdtemp(artifactRoot+sep+'shell275-test-');const moduleFile=temp+'/ui.mjs';await writeFile(moduleFile,uiBuilt.outputFiles[0].text);const ui=await import(pathToFileURL(moduleFile).href);
if(!resolve(temp).startsWith(artifactRoot+sep+'shell275-test-'))throw Error('Unexpected test output directory');await rm(temp,{recursive:true,force:true});
function uiFixture(scope='scope-a'){
  const configuration={scope,language:{enabled:true,portableEnabled:false,expiresAt:null},campaign:{installed:false,runtime:null}};
  return globalThis.__auxUI={path:'/staff/my-work',calls:[],states:{'shell.navigation':{data:{scope,navigation:{}}},'shell.auxiliary':{data:{scope,configuration:{data:configuration},summary:{data:{scope,notificationScope:'viewer:staff',summary:{unread:7}}},notice:{data:{scope,mode:null}}}}}};
}
function render(context={context:{scope:'scope-a',authenticated:true}}){return renderToStaticMarkup(React.createElement(ui.AppLocalShell,{context,path:globalThis.__auxUI.path},React.createElement('main',null,'Primary data')));}
const enabled=f=>f.calls.filter(x=>x.enabled).map(x=>x.name).sort();
test('installed shell starts one auxiliary read; healthy fields do not start their legacy readers',()=>{
  const f=uiFixture();assert.match(render(),/Primary data/);assert.deepEqual(enabled(f),['shell.auxiliary','shell.navigation']);assert.equal(f.language,true);
});
test('only an unavailable field enables its original reader; authoritative denial never enables fallbacks',()=>{
  const f=uiFixture();f.states['shell.auxiliary'].data.notice={unavailable:true};render();assert.deepEqual(enabled(f),['shell.auxiliary','shell.navigation','shell.notice']);
  f.calls=[];f.states['shell.auxiliary']={error:'Denied',accessDenied:true};render();assert.deepEqual(enabled(f),['shell.auxiliary','shell.navigation']);
});
test('transient whole-batch failure enables original readers; a different scope cannot supply configuration',()=>{
  const f=uiFixture();f.states['shell.auxiliary']={error:'Unavailable'};render();assert.deepEqual(enabled(f),['shell.auxiliary','shell.configuration','shell.navigation','shell.notice','shell.summary']);
  const next=uiFixture('old-scope');render();assert.equal(next.language,false);
});
test('a failed refresh uses newly revalidated fallback data ahead of the retained older batch',()=>{
  const f=uiFixture();f.states['shell.auxiliary'].error='Refresh unavailable';
  const old=f.states['shell.auxiliary'].data.configuration.data;
  f.states['shell.configuration']={data:{...old,language:{...old.language,enabled:false}}};
  render();assert.equal(f.language,false);
});
test('public Help does not issue private reads and check-in invalidates bundled notification state',()=>{
  const f=uiFixture();f.path='/help?lang=en';render(null);assert.deepEqual(enabled(f),[]);
  assert.equal(ui.appLocalCommandAffectsResource('shell.auxiliary','app/pos/owner-check-in-actions.ts'),true);
});
