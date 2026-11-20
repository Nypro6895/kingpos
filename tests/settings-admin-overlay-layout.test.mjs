import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {existsSync, readFileSync, mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const artifactDir = 'artifacts/settings-admin-overlay-layout';
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const user = {id:'fixture-user',auth_user_id:'fixture-auth',display_name:'Alex Nguyen',first_name:'Alex',last_name:'Nguyen',email:'alex@example.test',phone:null,language:'en',timezone:'America/Chicago',created_at:'2026-01-01',avatar_url:null,status:'active'};
const overview = {account:{id:user.id,email:user.email,phone:null,status:'active'},activity:[],currentRequest:{},currentSessionId:'fixture-session',dataUnavailableReason:null,mfa:{factors:[],unavailableReason:null},preferences:{loginAlertsEnabled:true,smsLoginAlertsEnabled:false},recoveryCodes:{unused:0},recoveryRequests:[],sessions:[],smsLoginAlerts:{configured:true},trustedDevices:[]};
const securityNames = [...readFileSync('app/settings/login-security/actions.ts','utf8').matchAll(/export async function (\w+)/g)].map(match=>match[1]);
const conversation = {id:'11111111-1111-4111-8111-111111111111',summary:'Fixture support case',reference:'TEST-001',status:'open',can_reply:true,messages:[],attachments:[],review:null,resolution:null};

async function fixture() {
  const mocks = {
    'next/link': `export const useLinkStatus=()=>({pending:false});export default props=><a {...props}/>`,
    'next/form': `export default props=><form {...props}/>`,
    'next/image': `export default({unoptimized,...props})=><img {...props}/>`,
    'next/navigation': `const router={refresh(){},push(){},replace(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`,
    '@/components/workspace-language': `export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='span',text,...props})=><Tag {...props}>{text||props.children}</Tag>;export const useWorkspaceTranslation=()=>value=>value;`,
    '@/components/salon-language-preferences': `export const LanguageSetting=()=>null;`,
    '@/app/account/actions': `export async function updateAccountProfileAction(payload){window.calls.push({action:'profile',payload});return {error:null,phoneClaim:{status:'verification_required',normalizedPhone:payload.phone,canSendOtp:true,resendCooldownSeconds:0}}}export async function getAccountAvatarUploadSessionAction(){throw Error('No uploads in fixture')}export async function sendAccountPhoneVerificationOtpAction(){throw Error('No SMS in fixture')}export async function verifyAccountPhoneOtpAction(){throw Error('No OTP submit in fixture')}`,
    '@/app/account/phone-change-actions': `export async function authorizePhoneChangeAction(payload){window.calls.push({action:'email',payload});if(window.holdEmail)return new Promise(resolve=>window.resolveEmail=resolve);return {error:null,...(payload.code?{verified:true}:{sent:true})}}`,
    '@/app/settings/login-security/actions': securityNames.map(name=>`export async function ${name}(){window.calls.push({action:'${name}'});throw Error('No security writes in fixture')}`).join('\n'),
    'fixture-public-read': `export async function loadPersonalPublicProfileSettings(){return {displayName:'Alex Nguyen',bio:'Saved public bio',visibility:'self',coverImageUrl:null,coverMediaPath:null,avatarUrl:null,initials:'AN'}}`,
    '@/app/beauty/actions': `const action=async()=>{throw Error('No Beauty writes in fixture')};export const updateBeautyProfileAction=action;export const getBeautyMediaUploadSessionAction=action;export const deleteBeautyMediaAction=action;`,
    '@/app/market/scoped-market-client': `const action=async()=>{window.calls.push({action:'campaign'});throw Error('No campaign writes in fixture')};export const useScopedMarketActions=()=>({createCampaignCreativeAction:action});`,
    '@/app/support/actions': `const action=async()=>{window.calls.push({action:'support'});throw Error('No support writes in fixture')};export const sendSupportMessage=action;export const uploadSupportEvidence=action;`,
    'fixture-users-actions': `const action=async()=>{window.calls.push({action:'admin-user'});throw Error('No user writes in fixture')};export const userWorkspaceAction=action;export const bulkUserAccessAction=action;`,
    'fixture-user-drawer': `export const UserDrawerContent=()=>null;export const userDate=v=>v;export const userName=u=>u.display_name||'Fixture';`,
  };
  const contents = `
    import React,{Activity,useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{AccountProfileEditor}from'./app/account/account-profile-editor';import{LoginSecurityPanel}from'./app/settings/login-security/login-security-panel';import{PersonalPublicProfilePanel}from'./app/settings/personal-public-profile-panel';import{SettingsChildPages}from'./app/settings/settings-child-pages';import{LegalFooter}from'./components/legal-footer';
    import{CreateCampaign}from'./app/campaigns/create-campaign';import{UsersWorkspace}from'./app/(app)/admin/users/users-workspace';import{AdminSupportHub}from'./app/(app)/admin/_components/admin-support-hub';import{PLATFORM_ADMIN_PERMISSIONS as P}from'./types/platform-admin';
    import{installMobileViewport}from'./lib/mobile-viewport';import{OverlayDismissal}from'./components/overlay-dismissal';
    window.calls=[];installMobileViewport();const root=createRoot(document.getElementById('root'));let revision=0;
    function App({kind}){const[hidden,setHidden]=useState(false);window.hide=()=>flushSync(()=>setHidden(true));window.reveal=()=>flushSync(()=>setHidden(false));
      return <><OverlayDismissal/><Activity mode={hidden?'hidden':'visible'}>{['avatar','phone','password'].includes(kind)?<div className="settings-hub compact-settings"><div className="settings-inline-editor"><SettingsChildPages label="Settings">{kind==='avatar'?<PersonalPublicProfilePanel user={${JSON.stringify(user)}} createdAtLabel="Jan 1, 2026"/>:<LoginSecurityPanel overview={${JSON.stringify(overview)}} contactEditor={<AccountProfileEditor embedded phoneOnly user={{...${JSON.stringify(user)},phone:window.fixturePhone??null}} createdAtLabel="Jan 1, 2026"/>}/>}</SettingsChildPages></div></div>:kind==='campaign'?<CreateCampaign onClose={()=>window.show('empty')} onCreated={()=>{throw Error('Do not submit campaign')}}/>:<main className="admin-workspace">{kind==='users'?<UsersWorkspace users={{items:[],total:0,page:1,page_size:25,can_read_sensitive:true}} context={{userId:'fixture-admin',permissions:Object.values(P)}} query={{}} identityReady/>:kind==='support'?<AdminSupportHub/>:null}</main>}</Activity><LegalFooter/><nav className="workspace-mobile-nav"><button>Mobile navigation</button></nav></>;
    }
    window.show=kind=>flushSync(()=>root.render(<App key={++revision} kind={kind}/>));
    window.navigate=url=>{history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))};
  `;
  const built = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'inert-dialog-services',setup(b){
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:/\/workspace-actions$/.test(a.path)?{path:'fixture-users-actions',namespace:'fixture'}:/\/user-drawer-content$/.test(a.path)?{path:'fixture-user-drawer',namespace:'fixture'}:/personal-public-profile-actions$/.test(a.path)?{path:'fixture-public-read',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
  }}]});
  const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:process.cwd()+'/app/globals.css'})).css+'\n'+[
    'app/settings/settings-hub.css','app/settings/settings-controls.css','app/settings/compact-settings.css','app/settings/settings-child-pages.css','app/settings/settings-compact-children.css','components/iphone-glass-nav.css','app/(app)/admin/admin.css',
  ].map(file=>readFileSync(file,'utf8')).join('\n')+'\n'+built.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n')+'\nbody{margin:0;font-family:Arial,sans-serif}.workspace-mobile-nav{position:fixed;bottom:0;height:80px;width:100%;z-index:60;background:white}';
  return {js:built.outputFiles.find(file=>file.path.endsWith('.js')).text,css};
}

async function settle(page) { await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); }
async function setViewport(page,height,offsetTop=0) { await page.evaluate(({height,offsetTop})=>window.setViewport(height,offsetTop),{height,offsetTop});await settle(page); }
async function openPage(browser,built,kind,viewport={width:390,height:844},savedPhone=null) {
  const page=await browser.newPage({viewport});page.setDefaultTimeout(5000);const errors=[],requests=[];
  const localConversation={...conversation,messages:[]};
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{const vv=new EventTarget();Object.assign(vv,{height:innerHeight,width:innerWidth,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{value:vv,configurable:true});window.setViewport=(height,offsetTop=0)=>{Object.assign(vv,{height,offsetTop});vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));};});
  await page.route('**/*',route=>{const request=route.request(),url=new URL(request.url());
    if(url.origin!=='https://overlay-layout.test'){requests.push(url.href);return route.abort();}
    if(url.pathname.startsWith('/admin/api/')){
      if(request.method()!=='GET'){requests.push(request.method()+' '+url.pathname);return route.abort();}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(url.pathname.includes('support-conversation')?localConversation:{items:[],unread_count:0})});
    }
    return route.fulfill({contentType:url.pathname.endsWith('.js')?'text/javascript':'text/html',body:url.pathname.endsWith('.js')?built.js:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${built.css}</style><div id="root"></div><script src="/fixture.js"></script>`});
  });
  await page.goto('https://overlay-layout.test/settings');await page.evaluate(({kind,savedPhone})=>{window.fixturePhone=savedPhone;window.show(kind);},{kind,savedPhone});
  if(kind==='avatar'){await page.getByRole('textbox',{name:'Bio',exact:true}).fill('Preserved public draft');await page.getByRole('button',{name:'Change avatar',exact:true}).click();}
  if(kind==='password')await page.getByRole('button',{name:'Change',exact:true}).click();
  if(kind==='phone'){await page.getByRole('button',{name:/Two-factor authentication/}).click();await page.getByRole('button',{name:'Send',exact:true}).click();}
  if(kind==='users')await page.getByRole('button',{name:'Create user',exact:true}).click();
  if(kind==='support'){await settle(page);await page.evaluate(id=>window.dispatchEvent(new CustomEvent('kingpos:admin-support-open',{detail:id})),conversation.id);}
  const modal=kind==='campaign'?page.locator('dialog[open]'):page.getByRole('dialog',{name:{avatar:'Change avatar',phone:'Add phone',password:'Change password',users:'Create user',support:'Reporter conversation'}[kind],exact:true});await modal.waitFor();await settle(page);
  const field=kind==='avatar'?null:kind==='phone'?modal.getByRole('textbox',{name:'Phone',exact:true}):kind==='password'?modal.getByLabel('Current password',{exact:true}):kind==='campaign'?modal.locator('textarea[name="caption"]'):kind==='users'?modal.locator('input[name="password"]'):modal.getByRole('textbox',{name:'Reply to the user',exact:true});
  const action=kind==='avatar'||kind==='phone'?modal.getByRole('button',{name:'Save profile',exact:true}):kind==='password'?modal.getByRole('button',{name:'Save',exact:true}):kind==='campaign'?modal.getByRole('button',{name:'Choose audience →',exact:true}):kind==='users'?modal.getByRole('button',{name:'Create user',exact:true}):modal.getByRole('button',{name:'Send message',exact:true});
  if(field){await field.fill(kind==='phone'?'+14145550200':'Preserved fixture draft');await field.evaluate(element=>element.focus({preventScroll:true}));await settle(page);}
  const incomingSupportMessage=async()=>{
    const text='Incoming fixture reply '+localConversation.messages.length+' '+('Long conversation text. '.repeat(35));
    localConversation.messages.push({id:'message-'+localConversation.messages.length,sender:'requester',body:text,created_at:'2026-11-19T00:00:00Z'});
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText(text,{exact:true}).waitFor();await settle(page);
  };
  return {page,modal,field,action,errors,requests,incomingSupportMessage};
}
async function assertVisible(page,target) {
  const state=await target.evaluate(element=>{const box=element.getBoundingClientRect(),vv=visualViewport,hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return {box:box.toJSON(),visibleTop:vv.offsetTop,visibleBottom:vv.offsetTop+vv.height,hit:hit?.tagName,receivesClick:hit===element||element.contains(hit)};});
  assert.ok(state.box.top>=state.visibleTop-.5&&state.box.bottom<=state.visibleBottom+.5,JSON.stringify(state));assert.equal(state.receivesClick,true,JSON.stringify(state));
}
async function revealAction(target) {
  await target.evaluate(element=>{for(let panel=element.parentElement;panel&&panel!==document.body;panel=panel.parentElement){if(/(auto|scroll)/.test(getComputedStyle(panel).overflowY))panel.scrollTop=panel.scrollHeight;if(panel.getAttribute('role')==='dialog'||panel.tagName==='DIALOG')break;}});
}

test('Settings, Campaign and Admin dialogs keep real fields/actions usable through keyboard sizing', {skip:!executablePath,timeout:120000}, async t=>{
  const built=await fixture(),browser=await chromium.launch({executablePath,headless:true});mkdirSync(artifactDir,{recursive:true});
  try {
    for(const kind of ['avatar','phone','password','campaign','users','support'])for(const width of [390,768])await t.test(`${kind} ${width}`,async()=>{
      const state=await openPage(browser,built,kind,{width,height:844});const {page,modal,field,action,errors,requests}=state;
      try {
        const originalStyle=await (kind==='campaign'?modal:kind==='users'||kind==='support'?modal:page.locator('[data-settings-dialog-layer]')).evaluate(element=>element.style.cssText);
        if(['avatar','phone','password'].includes(kind))assert.equal(await modal.evaluate(element=>!!element.closest('.settings-hub')),false,'Settings portal must escape page clipping');
        if(field)await assertVisible(page,field);await revealAction(action);await assertVisible(page,action);
        const pageScroll=await page.evaluate(()=>scrollY),draft=field?await field.inputValue():null;
        for(const [height,offsetTop] of [[360,0],[360,60],[220,0]]){
          if(field)await field.evaluate(element=>element.focus({preventScroll:true}));await setViewport(page,height,offsetTop);
          if(field)await assertVisible(page,field);
          await revealAction(action);await assertVisible(page,action);await action.click({trial:true});
          assert.equal(await page.evaluate(()=>scrollY),pageScroll,'modal scrolling must not move retained page');
          if(field)assert.equal(await field.inputValue(),draft);
          assert.equal(await page.evaluate(()=>innerHeight),844,'test must independently contract visual viewport');
        }
        await page.screenshot({path:`${artifactDir}/${kind}-${width}-keyboard.png`});
        await setViewport(page,844);assert.equal(await (kind==='campaign'?modal:kind==='users'||kind==='support'?modal:page.locator('[data-settings-dialog-layer]')).evaluate(element=>element.style.cssText),originalStyle,'keyboard dismissal restores ordinary inline styles');
        await revealAction(action);await assertVisible(page,action);if(field)assert.equal(await field.inputValue(),draft);
        if(kind==='users'){
          page.once('dialog',dialog=>dialog.dismiss());await modal.getByRole('button',{name:'Close drawer',exact:true}).click();await modal.waitFor();assert.equal(await field.inputValue(),draft,'refusing discard retains Admin form draft');
        }
        if(kind==='support'){
          await modal.getByRole('button',{name:'Minimize conversation',exact:true}).click();await modal.getByRole('button',{name:'Restore conversation',exact:true}).click();assert.equal(await field.inputValue(),draft,'minimize/restore retains reply draft');
          page.once('dialog',dialog=>dialog.dismiss());await modal.getByRole('button',{name:'Close conversation',exact:true}).click();await modal.waitFor();assert.equal(await field.inputValue(),draft,'refusing discard retains unsent reply');
        }
        assert.deepEqual(await page.evaluate(()=>window.calls),[]);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
      } finally {await page.close();}
    });
    await t.test('Settings nested verification, close, navigation and Activity preserve owner drafts',async()=>{
      const {page,modal,field,action,errors,requests}=await openPage(browser,built,'phone');
      try {
        await action.click();const otp=page.getByRole('dialog',{name:'Verify phone number',exact:true});await otp.waitFor();
        const send=otp.getByRole('button',{name:'Send code',exact:true});await assertVisible(page,send);await send.click({trial:true});
        await page.keyboard.press('Tab');assert.equal(await otp.evaluate(element=>element.contains(document.activeElement)),true,'nested OTP owns Tab');
        await page.keyboard.press('Escape');await otp.waitFor({state:'detached'});await modal.waitFor();assert.equal(await field.inputValue(),'+14145550200');assert.equal(await action.evaluate(element=>document.activeElement===element),true,'OTP restores its parent Save trigger');
        assert.equal((await page.evaluate(()=>window.calls)).length,1,'only the local profile fixture may be submitted; no OTP send');
        await modal.getByRole('button',{name:'Close',exact:true}).click();await modal.waitFor({state:'detached'});
        await page.evaluate(()=>window.show('avatar'));await page.getByRole('textbox',{name:'Bio',exact:true}).fill('Retained public bio');const opener=page.getByRole('button',{name:'Change avatar',exact:true});await opener.click();const avatar=page.getByRole('dialog',{name:'Change avatar',exact:true});await avatar.waitFor();
        await page.keyboard.press('Escape');await avatar.waitFor({state:'detached'});assert.equal(await opener.evaluate(element=>document.activeElement===element),true);assert.equal(await page.getByRole('textbox',{name:'Bio',exact:true}).inputValue(),'Retained public bio');
        await opener.click();await avatar.waitFor();await page.evaluate(()=>window.navigate('/settings#other'));await avatar.waitFor({state:'detached'});assert.equal(await page.getByRole('textbox',{name:'Bio',exact:true}).inputValue(),'Retained public bio');
        await opener.click();await avatar.waitFor();assert.equal(await page.evaluate(()=>{window.hide();return [...document.querySelectorAll('[data-settings-dialog-layer]')].filter(element=>!element.hidden&&element.getClientRects().length).length}),0,'Activity hides body portals synchronously');await page.evaluate(()=>window.reveal());await settle(page);assert.equal(await avatar.count(),0);assert.equal(await page.getByRole('textbox',{name:'Bio',exact:true}).inputValue(),'Retained public bio');
        assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
      } finally {await page.close();}
    });
    await t.test('nested email proof retains busy refusal and closes only the top dialog',async()=>{
      const {page,modal,field,action,errors,requests}=await openPage(browser,built,'phone',{width:390,height:844},'+14145550100');
      try {
        await action.click();const email=page.getByRole('dialog',{name:'Verify phone change',exact:true});await email.waitFor();
        await page.keyboard.press('Tab');assert.equal(await email.evaluate(element=>element.contains(document.activeElement)),true,'email proof owns Tab');
        await page.evaluate(()=>window.holdEmail=true);await email.getByRole('button',{name:'Send email code',exact:true}).click();
        await page.keyboard.press('Escape');await email.waitFor();await modal.waitFor();assert.equal(await page.getByRole('dialog').count(),2,'busy nested email must not dismiss itself or parent');
        await page.evaluate(()=>window.resolveEmail({error:null,sent:true}));await email.getByLabel('Email code',{exact:true}).waitFor();
        await page.keyboard.press('Escape');await email.waitFor({state:'detached'});await modal.waitFor();
        assert.equal(await field.inputValue(),'+14145550200');assert.equal(await action.evaluate(element=>document.activeElement===element),true,'email dismissal restores its parent trigger');
        assert.equal((await page.evaluate(()=>window.calls)).filter(call=>call.action==='profile').length,0,'email gate still prevents profile mutation');
        assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
      } finally {await page.close();}
    });
    await t.test('short keyboard support chat follows incoming replies only when already near bottom',async()=>{
      const {page,modal,field,errors,requests,incomingSupportMessage}=await openPage(browser,built,'support');
      try {
        const draft=await field.inputValue();await setViewport(page,220);await assertVisible(page,field);
        await incomingSupportMessage();await assertVisible(page,field);
        const body=modal.locator('.admin-support-chat-body'),history=modal.locator('.admin-chat-history');
        assert.equal(await history.evaluate(element=>element.scrollHeight>element.clientHeight+80),true,'fixture contains a separately scrollable message history');
        await history.evaluate(element=>{element.scrollTop=0;element.dispatchEvent(new Event('scroll'));});await settle(page);const bodyPosition=await body.evaluate(element=>element.scrollTop);
        await incomingSupportMessage();assert.equal(await history.evaluate(element=>element.scrollTop),0,'incoming replies must not pull a reader away from history');assert.equal(await body.evaluate(element=>element.scrollTop),bodyPosition,'reading history does not move composer scrollport');
        assert.equal(await field.inputValue(),draft);assert.deepEqual(await page.evaluate(()=>window.calls),[]);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
      } finally {await page.close();}
    });
  } finally {await browser.close();}
});
