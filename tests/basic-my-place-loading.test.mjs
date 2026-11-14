import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { chromium } from 'playwright-core';

// Real My Place route/view, profile editor, panels, request rows and document
// workspace navigation. Synthetic admitted context and held reads; action
// transports and unrelated translation/address/persistence UI are bounded mocks.
const fixtureData = `
function data(){
 const action={id:'today',label:'Today',href:'/staff/my-work'};
 const base={description:'',accountId:'account-a',accountName:'Test account',businessName:null,salonName:null,quickActions:[action],menuActions:[],primaryAction:action,secondaryAction:null,avatarUrl:null,salonCount:1};
 const owner={...base,id:'salon:owner:salon-a',type:'salon',salonMode:'manage',salonId:'salon-a',label:'Known Owner Salon',roleCode:'OWNER',roleLabel:'Owner'};
 const staff={...base,id:'salon:staff:salon-b',type:'salon',salonMode:'staff',salonId:'salon-b',label:'Known Staff Salon',roleCode:'STAFF',roleLabel:'Staff'};
 const account={...base,id:'account:account-a',type:'account',salonMode:null,salonId:null,label:'Test account',roleCode:'OWNER',roleLabel:'Owner',menuActions:[{id:'create-salon',label:'Create salon',href:'/salons/new'}]};
 const user={id:'user-a',auth_user_id:null,email:'fixture@example.invalid',phone:'+13125550123',first_name:'Test',last_name:'Person',display_name:'Test Person',avatar_url:null,status:'active',language:'en',timezone:'America/Chicago',last_login_at:null,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};
 const salons=[{id:'salon-a',name:owner.label,status:'active',city:'Chicago',state:'IL'},{id:'salon-b',name:staff.label,status:'active',city:'Chicago',state:'IL'}];
 return{currentWorkspace:owner,user,workspaceOptions:[owner,staff,account],salons};
}
function held(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
`;
const mocks = {
  '@/components/experience-page': 'export const withExperiencePage=Page=>Page;',
  '@/components/workspace-language': `import React from'react';export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as='div',...p})=>React.createElement(as,p);export const useWorkspaceTranslation=()=>s=>s;`,
  '@/components/overlay-dismissal': 'export const useTransientOverlay=()=>{};export const useNativeDialogNavigation=()=>{};export const useCloseOnNavigation=()=>{};',
  '@/components/salon-member-badge': `import React from'react';export const SalonName=({name})=><span>{name}</span>;`,
  '@/components/salon-address-link': `import React from'react';export const SalonAddressLink=({children})=><span>{children}</span>;`,
  '@/components/address-autocomplete': `import React from'react';export const AddressAutocomplete=({label,defaultValue})=><label>{label}<input name='address_line1' defaultValue={defaultValue}/></label>;`,
  '@/components/salon-language-preferences': 'export const LanguageSetting=()=>null;',
  'next/link': `import React from'react';export default function Link({prefetch,...p}){return <a {...p}/>;}`,
  'next/navigation': `export const redirect=href=>{throw Error('REDIRECT:'+href)};export const useRouter=()=>({refresh:()=>globalThis.__myPlaceQa.refreshes++});export const usePathname=()=>'/my-place';`,
  '@/lib/current-context': 'export const getCurrentBusinessContext=async()=>globalThis.__myPlaceQa.context;',
  '@/lib/customer-identity-claims': 'export async function inspectProfilePhoneClaim(){const f=globalThis.__myPlaceQa;f.reads.push("phone");return f.phone.promise;}',
  '@/lib/owner-transfer': 'export async function listMyOwnerTransferInvites(){const f=globalThis.__myPlaceQa;f.reads.push("invitations");return f.invitations.promise;}',
  'fixture-place-actions': `
    export async function getPlaceRequests(){const f=globalThis.__myPlaceQa;f.reads.push('requests');return f.requests.promise;}
    export async function respondPlaceRequest(id,operation){globalThis.__myPlaceQa.actions.push({kind:'request',id,operation});return{ok:true,data:null};}
    export async function createPlaceSalon(form){globalThis.__myPlaceQa.actions.push({kind:'create',name:form.get('name')});return{ok:false,message:'Synthetic rejected save'};}
    const forbid=async()=>{throw Error('Unexpected action')};export const getPlaceAccount=forbid,savePlaceMember=forbid,getPlaceSalon=forbid,savePlaceSalon=forbid,savePlaceLogo=forbid,searchPlaceSalons=forbid,applyToPlaceSalon=forbid,getPlaceLifecycleReview=forbid,setPlaceSalonActivity=forbid;
  `,
  'fixture-owner-actions': `export async function respondOwnerInvite(id,response){globalThis.__myPlaceQa.actions.push({kind:'owner',id,response});return{error:'Synthetic invitation rejection'};}`,
  '@/app/account/actions': `const forbid=async()=>{throw Error('Unexpected account action')};export const getAccountAvatarUploadSessionAction=forbid,sendAccountPhoneVerificationOtpAction=forbid,updateAccountProfileAction=forbid,verifyAccountPhoneOtpAction=forbid;`,
  '@/app/account/phone-change-actions': 'export const authorizePhoneChangeAction=async()=>{throw Error("Unexpected OTP")};',
  '@/app/salon-profile/actions': 'export const getSalonProfileMediaUploadSessionAction=async()=>{throw Error("Unexpected upload")};',
};
function plugin(){return{name:'bounded-my-place-transports',setup(b){
  b.onResolve({filter:/.*/},a=>{
    if(Object.hasOwn(mocks,a.path))return{path:a.path,namespace:'mock'};
    if(a.path==='@/app/my-place/actions'||a.path==='./actions'&&a.importer.replaceAll('\\','/').includes('/app/my-place/'))return{path:'fixture-place-actions',namespace:'mock'};
    if(a.path==='./owner-invite-actions')return{path:'fixture-owner-actions',namespace:'mock'};
    if(a.path==='./workspace-language'&&a.importer.replaceAll('\\','/').includes('/components/'))return{path:'@/components/workspace-language',namespace:'mock'};
  });
  b.onResolve({filter:/\.module\.css$/},a=>({path:a.path,namespace:'style'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
  b.onLoad({filter:/.*/,namespace:'style'},()=>({contents:'export default new Proxy({},{get:(_,key)=>String(key)});',loader:'js'}));
}};}
const serverBuild=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`export{default as Page}from'./app/(app)/my-place/page';${fixtureData};export{data,held};`},bundle:true,platform:'node',format:'esm',write:false,packages:'external',jsx:'automatic',plugins:[plugin()]});
let source=serverBuild.outputFiles[0].text;
for(const name of ['react','react/jsx-runtime'])source=source.replaceAll(`from "${name}"`,`from ${JSON.stringify(import.meta.resolve(name))}`);
const {Page,data,held}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const clientBuild=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
 import{MyPlaceProgressiveClient,MyPlaceClient,MyPlaceLoading}from'./app/my-place/my-place-client';
 ${fixtureData}
 const root=createRoot(document.getElementById('root'));
 const qa=globalThis.__myPlaceQa={props:data(),phone:held(),requests:held(),invitations:held(),reads:[],actions:[],refreshes:0};
 qa.render=()=>flushSync(()=>root.render(<MyPlaceProgressiveClient key={qa.props.user.id} {...qa.props} phoneVerified={qa.phone.promise} requests={qa.requests.promise} invitations={qa.invitations.promise}/>));
 qa.settled=()=>flushSync(()=>root.render(<MyPlaceClient {...qa.props} phoneVerified={true} requests={{ok:true,data:[]}} ownerInvites={[]}/>));
 qa.loading=error=>flushSync(()=>root.render(<MyPlaceLoading error={error} onRetry={()=>qa.refreshes++}/>));
 qa.reset=()=>{qa.phone=held();qa.requests=held();qa.invitations=held();qa.props=data();qa.props.user={...qa.props.user,id:'user-b',display_name:'Second Person'};qa.props.workspaceOptions=[];qa.props.salons=[];qa.props.currentWorkspace=null;qa.render();};
 qa.render();qa.ready=true;
 `},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[plugin()]});
const js=clientBuild.outputFiles[0].text;
function fixture(){const props=data();const f={props,context:{...props,availableManageSalons:[props.salons[0]],availableStaffSalons:[props.salons[1]]},phone:held(),requests:held(),invitations:held(),reads:[],actions:[],refreshes:0,errors:[]};globalThis.__myPlaceQa=f;return f;}
let browser,server,origin;
test.before(async()=>{
 const executablePath=[process.env.TEST_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));assert(executablePath);browser=await chromium.launch({executablePath,headless:true});
 server=createServer(async(req,res)=>{
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(js);return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url!=='/server'){res.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');return;}
  try{const element=await Page({});const stream=renderToPipeableStream(React.createElement('html',null,React.createElement('body',null,element)),{onShellReady(){stream.pipe(res);},onShellError(e){res.statusCode=500;res.end(e.message);},onError(e){globalThis.__myPlaceQa.errors.push(e.message);}});}catch(e){res.statusCode=403;res.end(e.message);}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function open(){const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/client');await page.waitForFunction(()=>globalThis.__myPlaceQa?.ready);return{page,errors};}
const qaEval=(page,fn,arg)=>page.evaluate(fn,arg);

test('Actual admitted route streams known workspace rows without waiting for any optional read',async()=>{
 const f=fixture(),page=await browser.newPage();page.setDefaultTimeout(5000);
 try{await page.goto(origin+'/server',{waitUntil:'commit'});await page.getByRole('heading',{name:'Known Owner Salon',exact:true}).waitFor();await page.getByRole('heading',{name:'Known Staff Salon',exact:true}).waitFor();assert.deepEqual(f.reads.sort(),['invitations','phone','requests']);assert.equal(await page.getByText('Verified ✓',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'＋ Create salon',exact:true}).count(),0);await page.getByRole('status').filter({hasText:'Loading owner invitations…'}).waitFor();
 f.phone.resolve({ok:true,data:{verifiedByCurrentUser:true}});f.requests.resolve({ok:true,data:[]});f.invitations.resolve([]);await page.getByText('Verified ✓',{exact:true}).waitFor();assert.deepEqual(f.errors,[]);
 }finally{f.phone.resolve(null);f.requests.resolve({ok:true,data:[]});f.invitations.resolve([]);await page.close();}
});

test('Actual route rejects unauthenticated actor before starting optional readers',async()=>{
 const f=fixture();f.context.user=null;await assert.rejects(Page({}),/REDIRECT:\/login\?next=\/my-place/);assert.deepEqual(f.reads,[]);
});

test('Thrown optional readers fail locally without a false phone verdict or lost workspace list',async()=>{
 const f=fixture(),page=await browser.newPage();page.setDefaultTimeout(5000);
 try{await page.goto(origin+'/server',{waitUntil:'commit'});await page.getByRole('heading',{name:'Known Owner Salon',exact:true}).waitFor();f.phone.reject(new Error('Synthetic phone outage'));f.requests.reject(Object.assign(new Error('Synthetic requests unavailable'),{status:403}));f.invitations.resolve([]);await page.getByRole('alert').filter({hasText:'Profile verification could not be loaded.'}).waitFor();await page.getByRole('alert').filter({hasText:'Requests could not be loaded.'}).waitFor();await page.getByRole('heading',{name:'Known Staff Salon',exact:true}).waitFor();assert.equal(await page.getByText('Verified ✓',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'＋ Create salon',exact:true}).count(),0);await page.locator('[data-place-salon="salon:staff:salon-b"]').getByRole('button',{name:'Switch',exact:true}).waitFor();assert.deepEqual(f.errors,[]);
 }finally{f.phone.resolve(null);f.requests.resolve({ok:true,data:[]});f.invitations.resolve([]);await page.close();}
});

for(const code of ['database_error','sign_in_required'])test(`Expected phone inspection ${code} stays unknown and withholds profile/create`,async()=>{
 const f=fixture(),page=await browser.newPage();page.setDefaultTimeout(5000);
 try{await page.goto(origin+'/server',{waitUntil:'commit'});await page.getByRole('heading',{name:'Known Owner Salon',exact:true}).waitFor();f.phone.resolve({ok:false,code});f.requests.resolve({ok:true,data:[]});f.invitations.resolve([]);await page.getByRole('alert').filter({hasText:'Profile verification could not be loaded.'}).waitFor();assert.equal(await page.getByRole('button',{name:'Edit personal information',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'＋ Create salon',exact:true}).count(),0);assert.equal(await page.getByText('Verified ✓',{exact:true}).count(),0);assert.deepEqual(f.errors,[]);}finally{f.phone.resolve(null);f.requests.resolve({ok:true,data:[]});f.invitations.resolve([]);await page.close();}
});

test('Same-account unknown phone refresh hides commands and retains the mounted personal-profile draft through retry',async()=>{
 const{page,errors}=await open();
 try{
  await qaEval(page,()=>{__myPlaceQa.phone.resolve(true);__myPlaceQa.requests.resolve({ok:true,data:[]});__myPlaceQa.invitations.resolve({invites:[]});});
  await page.getByRole('button',{name:'Edit personal information',exact:true}).click();
  const displayName=page.getByRole('textbox',{name:'Display name',exact:true});await displayName.fill('Unsent personal draft');await displayName.evaluate(el=>window.savedProfileInput=el);
  await qaEval(page,()=>{__myPlaceQa.phone={promise:Promise.resolve(null)};__myPlaceQa.render();});
  await page.getByRole('alert').filter({hasText:'Profile verification could not be loaded.'}).waitFor();
  assert.equal(await displayName.isVisible(),false);assert.equal(await page.getByRole('button',{name:'＋ Create salon',exact:true}).count(),0);assert.equal(await page.evaluate(()=>savedProfileInput.isConnected&&savedProfileInput.closest('[inert]')!==null),true);
  await page.getByRole('alert').filter({hasText:'Profile verification could not be loaded.'}).getByRole('button',{name:'Retry',exact:true}).click();assert.equal(await qaEval(page,()=>__myPlaceQa.refreshes),1);
  await qaEval(page,()=>{__myPlaceQa.phone={promise:Promise.resolve(true)};__myPlaceQa.render();});await displayName.waitFor();assert.equal(await displayName.inputValue(),'Unsent personal draft');assert.equal(await displayName.evaluate(el=>el===window.savedProfileInput),true);await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Edit personal information',exact:true}).click();assert.equal(await displayName.inputValue(),'Test Person');assert.deepEqual(await qaEval(page,()=>__myPlaceQa.actions),[]);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

test('Optional fragments settle independently and retain search DOM, local query and the open create draft',async()=>{
 const{page,errors}=await open();
 try{
  const search=page.getByRole('textbox',{name:'Search My Place',exact:true});await search.fill('Known');await page.evaluate(()=>globalThis.savedSearch=document.querySelector('input[aria-label="Search My Place"]'));
  await page.getByRole('heading',{name:'Known Owner Salon',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'＋ Create salon',exact:true}).count(),0);
  await qaEval(page,()=>__myPlaceQa.phone.resolve(true));await page.getByText('Verified ✓',{exact:true}).waitFor();
  await page.getByRole('button',{name:'＋ Create salon',exact:true}).click();await page.getByRole('dialog',{name:'Create salon',exact:true}).waitFor();const name=page.getByRole('textbox',{name:'Salon name',exact:false});await name.fill('Unsaved salon draft');
  await qaEval(page,()=>{__myPlaceQa.requests.resolve({ok:true,data:[{id:'request-a',kind:'invitation',label:'Known Staff Invite',status:'pending',createdAt:'2026-01-01'}]});__myPlaceQa.invitations.resolve({invites:[{id:'owner-invite-a',salonName:'Known Owner Invite',mode:'co_owner',message:null}]});});
  await page.getByRole('heading',{name:'Known Staff Invite',exact:true}).waitFor({state:'attached'});await page.getByText('Known Owner Invite',{exact:true}).waitFor({state:'attached'});assert.equal(await name.inputValue(),'Unsaved salon draft');assert.equal(await search.inputValue(),'Known');assert.equal(await page.evaluate(()=>savedSearch===document.querySelector('input[aria-label="Search My Place"]')),true);
  await page.getByRole('button',{name:'Create salon',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic rejected save'}).waitFor();assert.equal(await name.inputValue(),'Unsaved salon draft');assert.deepEqual(await qaEval(page,()=>__myPlaceQa.actions),[{kind:'create',name:'Unsaved salon draft'}]);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

test('Known workspace Switch keeps the original checked document handoff while optional reads are held',async()=>{
 const{page,errors}=await open();
 try{let request;await page.route('**/workspace/open?**',r=>{request={url:r.request().url(),navigation:r.request().isNavigationRequest()};return r.fulfill({contentType:'text/html',body:'<p>Checked workspace document</p>'});});await page.locator('[data-place-salon="salon:staff:salon-b"]').getByRole('button',{name:'Switch',exact:true}).click();await page.getByText('Checked workspace document').waitFor();const url=new URL(request.url);assert.equal(request.navigation,true);assert.equal(url.searchParams.get('workspace_id'),'salon:staff:salon-b');assert.equal(url.searchParams.get('destination'),'/staff/my-work');assert.deepEqual(errors,[]);}finally{await page.close();}
});

test('Settled native props preserve the real create panel and its unsaved Cancel confirmation',async()=>{
 const{page,errors}=await open();
 try{await qaEval(page,()=>__myPlaceQa.settled());await page.getByText('Verified ✓',{exact:true}).waitFor();await page.getByRole('button',{name:'＋ Create salon',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Create salon',exact:true});await dialog.waitFor();const name=dialog.getByRole('textbox',{name:'Salon name',exact:false});await name.fill('Keep this unsaved name');page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'Close panel',exact:true}).click();assert.equal(await name.inputValue(),'Keep this unsaved name');page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Close panel',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual(await qaEval(page,()=>__myPlaceQa.actions),[]);assert.deepEqual(errors,[]);}finally{await page.close();}
});

test('Request failures retain known rows and real retry; settled request actions retain their operation',async()=>{
 const{page,errors}=await open();
 try{await qaEval(page,()=>{__myPlaceQa.phone.resolve(false);__myPlaceQa.requests.resolve({ok:false,message:'Synthetic read failure'});__myPlaceQa.invitations.resolve({invites:[],error:'Synthetic owner failure'});});await page.getByRole('alert').filter({hasText:'Requests could not be loaded.'}).waitFor();await page.getByRole('heading',{name:'Known Owner Salon',exact:true}).waitFor();await page.getByRole('alert').filter({hasText:'Synthetic read failure'}).getByRole('button',{name:'Retry',exact:true}).click();assert.equal(await qaEval(page,()=>__myPlaceQa.refreshes),1);assert.deepEqual(errors,[]);}finally{await page.close();}
 const second=await open();try{await qaEval(second.page,()=>{__myPlaceQa.requests.resolve({ok:true,data:[{id:'request-a',kind:'invitation',label:'New Staff Invite',status:'pending',createdAt:'2026-01-01'}]});});await second.page.getByRole('button',{name:'Accept',exact:true}).click();await second.page.waitForFunction(()=>__myPlaceQa.refreshes===1);assert.deepEqual(await qaEval(second.page,()=>__myPlaceQa.actions),[{kind:'request',id:'request-a',operation:'accept_invite'}]);assert.deepEqual(second.errors,[]);}finally{await second.page.close();}
});

test('Account replacement never publishes a late prior-account invite or profile; neutral native frame has no capabilities',async()=>{
 const{page,errors}=await open();
 try{await qaEval(page,()=>{const old={phone:__myPlaceQa.phone,requests:__myPlaceQa.requests,invitations:__myPlaceQa.invitations};__myPlaceQa.reset();old.phone.resolve(true);old.requests.resolve({ok:true,data:[{id:'old-request',kind:'invitation',label:'Old private request',status:'pending',createdAt:'2026-01-01'}]});old.invitations.resolve({invites:[{id:'old-invite',salonName:'Old private owner invite',mode:'co_owner'}]});});await page.getByText('Your owned and managed salons will appear here.').waitFor();assert.equal(await page.getByText('Old private owner invite',{exact:true}).count(),0);assert.equal(await page.getByText('Old private request',{exact:true}).count(),0);assert.equal(await page.getByText('Verified ✓',{exact:true}).count(),0);
 await qaEval(page,()=>__myPlaceQa.loading('Synthetic unavailable'));await page.getByRole('heading',{name:'My Place',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Search My Place',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Switch',exact:true}).count(),0);await page.getByRole('button',{name:'Retry',exact:true}).click();assert.equal(await qaEval(page,()=>__myPlaceQa.refreshes),1);assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
