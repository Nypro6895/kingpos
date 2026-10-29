import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const executablePath=process.env.TEST_BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const salon=(id,owner=true)=>({id,name:`Salon ${id}`,address:`${id} Main St`,role:owner?'Owner':'Manager',status:'active',owner,permissions:owner?{}:{'services.view':true},owners:[]});
const index={managed:[salon('one'),salon('two'),salon('limited',false)],staff:[{id:'work',name:'My work salon',address:'3 Main St'}],accounts:[{id:'business',canCreate:true}],hasBusinessWorkspace:true};
async function fixture(){
 return build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SettingsHubClient}from'./app/settings/settings-hub-client';window.calls=[];window.saved=[];window.index=${JSON.stringify(index)};window.vi=new URLSearchParams(location.search).has('vi');const root=createRoot(document.getElementById('root'));window.renderSettings=section=>root.render(<SettingsHubClient user={{email:'alex@example.com'}} createdAtLabel="Today" index={window.index} initialSection={section}/>);window.renderSettings(new URLSearchParams(location.search).get('section')||'');`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'settings-fixture',setup(b){
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  b.onResolve({filter:/components\/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onResolve({filter:/(?:\.\/|app\/settings\/)(direct-settings-panel|settings-hub-actions|deferred-personal-section|personal-public-profile-panel|connections-panel|salon-list-panel|blocked-users-panel)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}));
  b.onResolve({filter:/app\/account\/account-profile-editor$/},()=>({path:'profile',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:path==='language'?`import{translateVietnamese}from'./lib/vietnamese-dictionary';export const useWorkspaceTranslation=()=>value=>typeof value==='string'?translateVietnamese(value,window.vi):value;export const WorkspaceText=({text})=>useWorkspaceTranslation()(text);`
   :path==='link'?`export default function Link(props){return <a {...props}/>}`
   :path==='settings-hub-actions'?`export async function loadSettingsHub(){return window.index}`
   :path==='direct-settings-panel'?`import{useEffect}from'react';import{InlineForm,Field,Check,SettingsFieldGroup}from'./app/settings/direct-settings-ui';export function DirectSettingsPanel({kind,salonId}){useEffect(()=>{window.calls.push({kind,salonId})},[]);return <InlineForm save={async form=>{window.saved.push({kind,salonId,value:form.get('value'),enabled:form.get('enabled')});return {ok:true}}} onSaved={()=>{}}><SettingsFieldGroup title="Fixture preferences"><Field name="value" label="Fixture setting" value={salonId}/><Check name="enabled" label="Fixture option" checked/></SettingsFieldGroup></InlineForm>}`
   :path==='salon-list-panel'?`export const SalonListPanel=()=> <p>Create salon in place</p>`
   :`export const ${({'profile':'AccountProfileEditor','deferred-personal-section':'DeferredPersonalSection','personal-public-profile-panel':'PersonalPublicProfilePanel','connections-panel':'ConnectionsPanel','blocked-users-panel':'BlockedUsersPanel'})[path]}=()=> <p>Fixture ${path}</p>`}));

 }}]});
}
const css=['app/settings/settings-hub.css','app/settings/settings-controls.css'].map(p=>readFileSync(p,'utf8')).join('\n');
async function open(browser,bundle,width,path='/'){
 const page=await browser.newPage({viewport:{width,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://settings.test/**',r=>{
  if(r.request().url().includes('/app.js'))return r.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
  if(r.request().url().includes('/api/notifications/preferences'))return r.fulfill({json:{preferences:{booking:true},checkInDefault:false,staffBooking:{salonId:'one',enabled:true}}});
  if(r.request().url().includes('/api/'))return r.fulfill({status:404,json:{error:'Unexpected fixture API request'}});
  return r.fulfill({contentType:'text/html',body:`<style>body{margin:0;font-family:Arial}button,input,select{font:inherit}button{cursor:pointer}h1,h2,h3,p{margin:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.grid{display:grid}.gap-3{gap:12px}.gap-4{gap:16px}.w-full{width:100%}${css}</style><div id="root"></div><script src="/app.js"></script>`});
 });
 await page.goto(`http://settings.test${path}`);await page.locator('.settings-hub').waitFor();return {page,errors};
}
async function home(page){while(await page.locator('.settings-hub').getAttribute('data-mobile-step')!=='home')await page.locator('.settings-back').click();}
async function group(page,name){await home(page);await page.getByRole('navigation',{name:'Settings accounts and salons'}).getByRole('button',{name}).click();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}

test('grouped Settings retains drafts, scopes saves, uses distinct icons, and restores history at phone and desktop sizes',{skip:!executablePath,timeout:90000},async()=>{
 const bundle=await fixture(),browser=await chromium.launch({executablePath,headless:true});
 try{for(const width of [320,390,768,1280]){
  const {page,errors}=await open(browser,bundle,width);
  assert.deepEqual(await page.evaluate(()=>window.calls),[],'opening Settings must not load every editor');
  await group(page,'alex@example.com');
  const nav=page.getByRole('navigation',{name:'Settings sections'});
  const icons=await nav.locator('[data-settings-icon]').evaluateAll(nodes=>nodes.map(n=>n.dataset.settingsIcon));assert.equal(new Set(icons).size,icons.length);
  assert.equal(await nav.getByRole('button').count(),7);assert.equal(await nav.locator('h3 svg').count(),0);await noOverflow(page);
  if(process.env.SETTINGS_SCREENSHOTS_DIR){mkdirSync(process.env.SETTINGS_SCREENSHOTS_DIR,{recursive:true});await page.screenshot({path:`${process.env.SETTINGS_SCREENSHOTS_DIR}/personal-${width}.png`,fullPage:true});}
  await group(page,'Salon one');assert.equal(await nav.getByRole('button').count(),10);assert.deepEqual(await page.evaluate(()=>window.calls),[]);
  await nav.getByRole('button',{name:/^Services & prices/}).click();await page.locator('.settings-inline-editor:visible').getByLabel('Fixture setting').fill('Keep my draft');
  assert.deepEqual(await page.evaluate(()=>window.calls),[{kind:'services',salonId:'one'}]);
  await group(page,'Salon two');await nav.getByRole('button',{name:/^Services & prices/}).click();await page.locator('.settings-inline-editor:visible').getByLabel('Fixture setting').fill('Second salon');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.saved),[{kind:'services',salonId:'two',value:'Second salon',enabled:'on'}]);
  await group(page,'Salon one');await nav.getByRole('button',{name:/^Services & prices/}).click();assert.equal(await page.locator('.settings-inline-editor:visible').getByLabel('Fixture setting').inputValue(),'Keep my draft');
  if(process.env.SETTINGS_SCREENSHOTS_DIR)await page.screenshot({path:`${process.env.SETTINGS_SCREENSHOTS_DIR}/editor-${width}.png`,fullPage:true});
  await noOverflow(page);await page.goBack();await nav.waitFor();await page.goForward();await page.locator('.settings-inline-editor:visible').getByLabel('Fixture setting').waitFor();assert.equal(await page.locator('.settings-inline-editor:visible').getByLabel('Fixture setting').inputValue(),'Keep my draft');
  await group(page,'Salon limited');assert.equal(await nav.getByRole('button').count(),2);assert.equal(await nav.getByRole('button',{name:/Ownership|Payroll|closure/}).count(),0);
  await group(page,'My work salon');assert.equal(await nav.getByRole('button').count(),2);await nav.getByRole('button',{name:/Working hours/}).click();await page.locator('.settings-inline-editor:visible').getByLabel('Fixture setting').waitFor();
  assert.equal((await page.evaluate(()=>window.calls)).at(-1).kind,'staff-schedule');
  await home(page);await page.getByLabel('Find a setting or salon').fill('opening hours');await page.getByRole('button',{name:/Salon information.*Salon one/}).click();assert.equal(await page.locator('.settings-inline-editor:visible').getAttribute('id'),'salon-one-salon-profile');
  await group(page,'Add salon');await page.getByText('Create salon in place').waitFor();
  await group(page,'Legal & Privacy');await page.getByRole('link',{name:'Privacy Policy',exact:true}).waitFor();
  await group(page,'Help & support');await page.getByRole('link',{name:'Account recovery',exact:true}).waitFor();
  await noOverflow(page);assert.deepEqual(errors,[]);await page.close();

 }}finally{await browser.close();}
});

test('deep links and Vietnamese search open the correct editor without extra navigation',{skip:!executablePath,timeout:45000},async()=>{
 const bundle=await fixture(),browser=await chromium.launch({executablePath,headless:true});
 try{
  for(const [section,id] of [['profile','personal-profile'],['salon-two-booking','salon-two-booking'],['staff-schedule','staff-work-schedule']]){
   const {page,errors}=await open(browser,bundle,390,`/?section=${section}`);assert.equal(await page.locator('.settings-inline-editor:visible').getAttribute('id'),id);await noOverflow(page);assert.deepEqual(errors,[]);await page.close();
  }
  const {page}=await open(browser,bundle,390,'/?vi');await page.getByLabel('Tìm cài đặt hoặc tiệm').fill('giờ mở cửa');await page.getByRole('button',{name:/Thông tin tiệm.*Salon one/}).click();assert.equal(await page.locator('.settings-inline-editor:visible').getAttribute('id'),'salon-one-salon-profile');await page.close();
 }finally{await browser.close();}
});

test('notification groups share switches and preserve state after a failed save',{skip:!executablePath,timeout:45000},async()=>{
 const bundle=await fixture(),browser=await chromium.launch({executablePath,headless:true});
 try{const {page,errors}=await open(browser,bundle,390,'/?section=notifications');let writes=0;
  await page.route('**/api/notifications/preferences',r=>{
   if(r.request().method()==='GET')return r.fulfill({json:{preferences:{booking:true},checkInDefault:false,staffBooking:{salonId:'one',enabled:true}}});
   writes++;return writes===1?r.fulfill({status:500,json:{error:'Could not save settings.'}}):r.fulfill({json:{ok:true}});
  });
  // Retry initial load after installing the local API fixture if the effect already ran.
  if(await page.getByRole('button',{name:'Retry',exact:true}).count())await page.getByRole('button',{name:'Retry',exact:true}).click();
  const booking=page.getByRole('switch',{name:/^Booking updates/});await booking.waitFor();await page.waitForFunction(()=>!document.querySelector('[role=switch]').disabled);
  assert.equal(await page.getByRole('switch').count(),8);assert.equal(await booking.getAttribute('aria-checked'),'true');await booking.click();await page.getByRole('alert').waitFor();assert.equal(await booking.getAttribute('aria-checked'),'true');await booking.click();await page.waitForFunction(()=>document.querySelector('[role=switch]').getAttribute('aria-checked')==='false');assert.equal(writes,2);await noOverflow(page);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('one tap remains open when Next synchronizes search params after pushState',{skip:!executablePath,timeout:15000},async()=>{const built=await fixture(),browser=await chromium.launch({executablePath,headless:true});try{const {page,errors}=await open(browser,built,390);await page.getByRole('navigation',{name:'Settings accounts and salons'}).getByRole('button',{name:'alex@example.com'}).click();await page.evaluate(()=>window.renderSettings('personal'));await page.waitForTimeout(100);assert.equal(await page.locator('.settings-hub').getAttribute('data-mobile-step'),'group');assert.equal(await page.locator('.settings-context-header:visible').count(),0);await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:/^Profile & contact/}).click();await page.evaluate(()=>window.renderSettings('personal-profile'));await page.waitForTimeout(100);assert.equal(await page.locator('.settings-hub').getAttribute('data-mobile-step'),'detail');await page.locator('#personal-profile:visible').waitFor();assert.deepEqual(errors,[]);}finally{await browser.close();}});

