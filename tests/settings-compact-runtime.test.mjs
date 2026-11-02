import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';

const index={managed:['one','two'].map((id,i)=>({id,name:i?'Second Salon':'King Nails',address:'1 Main St',role:'Owner',status:'active',owner:true,permissions:{},owners:[]})),staff:[{id:'work',name:'Working Salon',address:''}],accounts:[{id:'business',name:'Business',canCreate:true}]};
const stubs={
 'settings-hub-actions':`export async function loadSettingsHub(){return window.index}`,
 'direct-settings-panel':`import React,{useEffect}from'react';import{InlineForm,Field}from'./app/settings/direct-settings-ui';export function DirectSettingsPanel({kind,salonId}){useEffect(()=>{window.loads.push({kind,salonId})},[]);return <InlineForm save={async f=>{window.writes.push({kind,salonId,value:f.get('value')});return window.fail?{ok:false,error:'Save failed. Draft preserved.'}:{ok:true}}} onSaved={async()=>{if(window.refreshFail)throw Error('Reload failed')}}><Field name="value" label="Setting value" value={salonId}/></InlineForm>}`,
 'account-profile-editor':`export const AccountProfileEditor=()=> <div>Personal profile editor</div>`,
 'personal-public-profile-panel':`export const PersonalPublicProfilePanel=()=> <div>Public profile editor</div>`,
 'deferred-personal-section':`export const DeferredPersonalSection=({kind})=> <div>{kind} editor</div>`,
 'connections-panel':`export const ConnectionsPanel=()=> <div>Connections editor</div>`,
 'blocked-users-panel':`export const BlockedUsersPanel=()=> <div>Blocked users editor</div>`,
 'salon-list-panel':`export const SalonListPanel=()=> <div>Create salon editor</div>`,
 'notification-preferences-panel':`export const NotificationPreferencesPanel=()=> <div>Notification editor</div>`,
 'direct-settings-actions':`export async function saveDirectSalonProfile(id,payload){window.actualWrites.push({kind:'profile',id,payload});return {ok:true}}export async function saveDirectHours(id,payload){window.actualWrites.push({kind:'hours',id,payload});return {ok:true}}export async function saveDirectSpecialHours(){return {ok:true}}export async function saveDirectBooking(){return {ok:true}}`,
 'settings-extra-actions':`export async function saveSettingsProfileIdentity(id,form){window.actualWrites.push({kind:'identity',id,payload:Object.fromEntries(form)});return {ok:true}}export async function refreshSettingsMap(){return {ok:true}}`,
 'staff-hours-booking':`export const StaffHoursBooking=()=>null`,
 'booking-deposit-settings':`export const BookingDepositSettings=()=>null`,
 'booking-plugin-settings':`export const BookingRulesSettings=()=>null;export const BookSmsSettings=()=>null`,
 'time-zone-select':`export const TimeZoneSelect=p=><select {...p}><option value="America/Chicago">America/Chicago</option></select>`,
 'salon-publication-status':`export const SalonPublicationStatus=()=>null`,
 'salon-profile-preferences-panel':`export const SalonProfilePreferencesPanel=()=>null`,
 'booking-setup-editors':`export const StaffAvailabilityEditor=()=>null`,
 'salon-profile-studio':`export const SalonMediaUploader=({onUploaded,kind})=><button type="button" onClick={()=>onUploaded(kind+'/new')}>Upload {kind}</button>`,
};
async function fixture(){
 const output=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from'react';import{createRoot}from'react-dom/client';import{SettingsHubClient}from'./app/settings/settings-hub-client';import{CompactSettingsWorkspace,CompactSettingsPane,CompactSaveBar}from'./app/settings/compact-settings-workspace';import{InlineForm}from'./app/settings/direct-settings-ui';import{SalonDetailsPanel}from'./app/settings/salon-settings-panels';window.loads=[];window.writes=[];window.actualWrites=[];window.index=${JSON.stringify(index)};
 const realData={kind:location.pathname==='/real-public'?'public-profile':'salon-profile',salonId:'one',canManage:true,canManageSalon:true,setting:{business_name:'King Nails',phone:'1234567890',email:'salon@example.com',website:'https://example.com',address_line1:'1 Main St',address_line2:'Suite 2',city:'Chicago',state:'IL',postal_code:'60601',country:'US',business_description:'Nail salon'},hours:{timeZone:'America/Chicago',weeklyHours:[{dayOfWeek:1,opensAtLocal:'09:00',closesAtLocal:'17:00',sortOrder:0}],specialHours:[]},mapLocation:{refreshEnabled:true,coordinates:null,statusDescription:'Ready'},profileIdentity:{},publicProfileAvailable:false,readiness:{canEnable:true,items:[]}};
 const real=<div className="compact-settings settings-hub"><div className="settings-inline-editor"><SalonDetailsPanel data={realData} onSaved={async()=>{}}/></div></div>;
 const standalone=<CompactSettingsWorkspace name="King Nails" items={[{id:'business-information',label:'Business info',group:'Profile'},{id:'operating-hours',label:'Opening hours',group:'Profile'}]}><form className="salon-main-form" onSubmit={e=>{e.preventDefault();window.payload=Object.fromEntries(new FormData(e.currentTarget))}}><CompactSettingsPane id="business-information"><label>Name<input required name="business_name" defaultValue="King Nails"/></label></CompactSettingsPane><CompactSettingsPane id="operating-hours"><label>Time zone<input name="timezone" defaultValue="America/Chicago"/></label></CompactSettingsPane><CompactSaveBar><button>Save settings</button></CompactSaveBar></form></CompactSettingsWorkspace>;
 const action=<div className="compact-settings"><InlineForm save={async()=>{window.actionCount=(window.actionCount||0)+1;return {ok:true}}} onSaved={()=>{}} label="Revoke invitation"><input type="hidden" name="invite_id" value="invite"/><p>Pending invitation</p></InlineForm></div>;
 const initial=new URLSearchParams(location.search).get('section')||'';createRoot(document.getElementById('root')).render(location.pathname.startsWith('/real-')?real:location.pathname==='/salon-settings'?standalone:location.pathname==='/action'?action:<SettingsHubClient user={{email:'me@example.com'}} createdAtLabel="Today" index={window.index} initialSection={initial}/>);`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'stub'}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'stub'}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'stub'}));
 b.onResolve({filter:/(settings-hub-actions|direct-settings-panel|account-profile-editor|personal-public-profile-panel|deferred-personal-section|connections-panel|blocked-users-panel|salon-list-panel|notification-preferences-panel|direct-settings-actions|settings-extra-actions|staff-hours-booking|booking-deposit-settings|booking-plugin-settings|time-zone-select|salon-publication-status|salon-profile-preferences-panel|booking-setup-editors|salon-profile-studio)$/},a=>({path:a.path.split('/').at(-1),namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='language'?`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;`:a.path==='navigation'?`export const usePathname=()=>location.pathname;`:a.path==='link'?`export default function Link(p){return <a {...p}/>}`:stubs[a.path]}));
 }}]});
 const js=output.outputFiles.find(f=>f.path.endsWith('.js')).text,css=output.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':req.url==='/fixture.css'?'text/css':'text/html');res.end(req.url==='/fixture.js'?js:req.url==='/fixture.css'?css:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:14px Arial}button,input,select{font:inherit}button{background:none;border:0;cursor:pointer}h1,h2,h3,h4,p{margin:0}[hidden]{display:none!important}input{min-width:0}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('compact Settings: nested navigation, lazy editors, salon drafts, failed saves, retry and viewport fit',{timeout:120000},async()=>{
 const f=await fixture(),browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 await mkdir('artifacts/settings-compact-complete-20261102/screenshots',{recursive:true});
 try{for(const width of [320,375,428,768,1280]){
  const page=await browser.newPage({viewport:{width,height:926}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(f.url);
  const account=page.getByRole('navigation',{name:'Settings accounts and salons'});
  await account.getByRole('button',{name:'King Nails'}).click();assert.equal(await page.evaluate(()=>window.loads.length),0);
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:/^Services & prices/}).click();
  const editor=page.locator('#salon-one-services');await editor.locator('input').fill('Draft one');
  assert.equal(await page.locator('.settings-inline-editor:visible').count(),1);
  await page.locator('.settings-back').click();await page.locator('.settings-back').click();
  await account.getByRole('button',{name:'Second Salon'}).click();await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:/^Services & prices/}).click();
  const second=page.locator('#salon-two-services');await second.locator('input').fill('Draft two');await page.evaluate(()=>window.fail=true);await second.getByRole('button',{name:'Save changes',exact:true}).click();await second.getByRole('alert').waitFor();assert.equal(await second.locator('input').inputValue(),'Draft two');
  await page.evaluate(()=>{window.fail=false;window.refreshFail=true});await second.getByRole('button',{name:'Save changes',exact:true}).click();await second.getByRole('button',{name:'Reload saved values'}).waitFor();await page.evaluate(()=>window.refreshFail=false);await second.getByRole('button',{name:'Reload saved values'}).click();
  assert.equal(await page.evaluate(()=>window.writes.length),2);assert.equal(await page.evaluate(()=>window.writes.every(w=>w.salonId==='two')),true);
  await page.locator('.settings-back').click();await page.locator('.settings-back').click();await account.getByRole('button',{name:'King Nails'}).click();await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:/^Services & prices/}).click();assert.equal(await editor.locator('input').inputValue(),'Draft one');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);
  await page.screenshot({path:`artifacts/settings-compact-complete-20261102/screenshots/all-settings-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage({viewport:{width:375,height:926}});await page.goto(f.url+'/salon-settings');await page.getByRole('button',{name:'Business info'}).click();await page.locator('input[name=business_name]').fill('Draft salon');await page.getByRole('button',{name:'Salon settings'}).click();await page.getByRole('button',{name:'Opening hours'}).click();await page.locator('input[name=timezone]').fill('America/New_York');await page.getByRole('button',{name:'Save settings'}).click();assert.deepEqual(await page.evaluate(()=>window.payload),{business_name:'Draft salon',timezone:'America/New_York'});
 await page.getByRole('button',{name:'Salon settings'}).click();await page.getByRole('button',{name:'Business info'}).click();await page.locator('input[name=business_name]').fill('');await page.getByRole('button',{name:'Salon settings'}).click();await page.getByRole('button',{name:'Opening hours'}).click();await page.getByRole('button',{name:'Save settings'}).click();await page.locator('input[name=business_name]').waitFor({state:'visible'});
 await page.goto(f.url+'/action');await page.getByRole('button',{name:'Revoke invitation'}).click();assert.equal(await page.evaluate(()=>window.actionCount),1);
 await page.goto(f.url+'/?section=salon-one-booking');await page.locator('#salon-one-booking input').waitFor();assert.equal(await page.locator('.settings-inline-editor:visible').count(),1);
 for(const width of [320,428,1280]){await page.setViewportSize({width,height:926});await page.goto(f.url+'/real-salon');assert.equal(await page.getByText('Nail salon',{exact:true}).count(),0);await page.getByRole('region',{name:'King Nails',exact:true}).getByRole('button',{name:'Edit',exact:true}).click();await page.locator('input[name=business_name]').fill('Updated King Nails');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor();const result=await page.evaluate(()=>window.actualWrites[0]);assert.equal(result.id,'one');assert.equal(result.payload.business_name,'Updated King Nails');assert.equal(result.payload.city,'Chicago');assert.equal(result.payload.address_line2,'Suite 2');assert.equal(result.payload.business_description,'Nail salon');
 await page.getByRole('region',{name:'Opening hours',exact:true}).getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('button',{name:'Remove Monday hours'}).click();await page.getByRole('button',{name:'Save opening hours'}).click();assert.equal(await page.evaluate(()=>window.actualWrites.find(w=>w.kind==='hours').payload.weeklyHours.length),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`real salon overflow ${width}`);await page.screenshot({path:`artifacts/settings-compact-complete-20261102/screenshots/salon-form-${width}.png`,fullPage:true});}
 await page.goto(f.url+'/real-public');await page.locator('summary').filter({hasText:/^Change cover$/}).click();await page.getByRole('button',{name:'Upload cover'}).click();await page.locator('form').filter({has:page.locator('input[name=tagline]')}).getByRole('button',{name:'Save changes',exact:true}).click();assert.equal(await page.evaluate(()=>window.actualWrites.find(w=>w.kind==='identity').payload.cover_path),'cover/new');await page.close();
 }finally{await browser.close();await f.close();}
});
