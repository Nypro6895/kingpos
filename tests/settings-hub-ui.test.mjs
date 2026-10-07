import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('All Settings switches inline sections and preserves salon drafts without accordion cards or navigation', {skip:!process.env.ESBUILD_MODULE_PATH,timeout:90000}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const index={managed:[{id:'one',name:'King Nails',address:'1 Main St',role:'Owner',status:'active',owner:true,permissions:{},owners:[{id:'ny',email:'ny@example.com',isCurrentUser:false}]},{id:'two',name:'Second Salon',address:'2 Main St',role:'Owner',status:'active',owner:true,permissions:{},owners:[]}],staff:[{id:'work',name:'Working Salon',address:'3 Main St'}],accounts:[{id:'business',name:'My Business',canCreate:true}],support:false,twilio:null};
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SettingsHubClient}from'./app/settings/settings-hub-client';window.calls=[];window.saved=[];window.index=${JSON.stringify(index)};createRoot(document.getElementById('root')).render(<SettingsHubClient user={{email:'me@example.com'}} createdAtLabel="Today" index={window.index}/>);`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'stub',setup(b){
 b.onResolve({filter:/next\/navigation$/},()=>({path:'navigation',namespace:'stub'}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'stub'}));
 b.onLoad({filter:/^link$/,namespace:'stub'},()=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';export default function Link(props){return <a {...props}/>}`}));
 b.onResolve({filter:/(?:\.\/|app\/settings\/)(?:direct-settings-panel|settings-hub-actions|deferred-personal-section|personal-public-profile-panel|connections-panel|salon-list-panel|notification-preferences-panel)$/},a=>({path:a.path.split('/').at(-1),namespace:'stub'}));
 b.onResolve({filter:/app\/account\/account-profile-editor$/},()=>({path:'account',namespace:'stub'}));
 b.onResolve({filter:/admin\/settings\/twilio\/settings-form$/},()=>({path:'twilio',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='direct-settings-panel'?`import React,{useState,useEffect}from'react';import{InlineForm,Field}from'./app/settings/direct-settings-ui';export function DirectSettingsPanel({kind,salonId}){useEffect(()=>{window.calls.push({kind,salonId})},[]);return <InlineForm save={async form=>{window.saved.push({kind,salonId,value:form.get('value')});return {ok:true}}} onSaved={()=>{}}><Field name="value" label="Fixture setting" value={salonId}/></InlineForm>}`:a.path==='settings-hub-actions'?`export async function loadSettingsHub(){return window.index}`:a.path==='personal-public-profile-panel'?`export const PersonalPublicProfilePanel=()=>null`:a.path==='account'?`export const AccountProfileEditor=()=>null`:a.path==='deferred-personal-section'?`export const DeferredPersonalSection=()=>null`:a.path==='connections-panel'?`export const ConnectionsPanel=()=>null`:a.path==='salon-list-panel'?`export const SalonListPanel=({createOnly})=><div>{createOnly?'Create salon in place':'Workspace select'}</div>`:a.path==='notification-preferences-panel'?`export const NotificationPreferencesPanel=()=>null`:a.path==='twilio'?`export const TwilioSettingsForm=()=>null`:`export const useRouter=()=>({push(){throw Error('Unexpected navigation')},replace(){throw Error('Unexpected navigation')}}` }));
 }}]});
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{for(const width of [375,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost/',r=>r.fulfill({contentType:'text/html',body:'<style>body{font-family:Arial}input{max-width:100%}details{margin:8px}summary{padding:8px}</style><div id="root"></div><script src="/app.js"></script>'}));
  await page.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:result.outputFiles.find(f=>f.path.endsWith('.js')).text}));
  await page.goto('http://localhost/');assert.equal(await page.locator('a').count(),0);
  assert.equal(await page.getByText('Roles',{exact:true}).count(),0);assert.equal(await page.getByText('Permissions',{exact:true}).count(),0);
  const accounts=page.getByRole('navigation',{name:'Settings accounts and salons'});
  const sections=page.getByRole('navigation',{name:'Settings sections'});
  await accounts.getByRole('button',{name:'King Nails'}).click();await page.getByText('ny@example.com owns King Nails.').waitFor();
  await sections.getByRole('button',{name:'Services, prices & booking staff'}).click();
  await page.locator('#salon-one-services input[name=value]').fill('Unsaved draft');
  await accounts.getByRole('button',{name:'Second Salon'}).click();await sections.getByRole('button',{name:'Services, prices & booking staff'}).click();
  await page.locator('#salon-two-services input[name=value]').fill('Changed second salon');await page.locator('#salon-two-services button').filter({hasText:'Save changes'}).click();
  assert.deepEqual(await page.evaluate(()=>window.saved),[{kind:'services',salonId:'two',value:'Changed second salon'}]);
  await page.getByLabel('Find a setting or salon').fill('Working Salon');
  await page.getByLabel('Find a setting or salon').fill('');
  await accounts.getByRole('button',{name:'King Nails'}).click();await sections.getByRole('button',{name:'Services, prices & booking staff'}).click();
  assert.equal(await page.locator('#salon-one-services input[name=value]').inputValue(),'Unsaved draft');
  await accounts.getByRole('button',{name:'Working Salon'}).click();await page.locator('#staff-work-profile input[name=value]').waitFor();
  assert.equal(await sections.getByRole('button').count(),2);assert.equal(await sections.getByText('Owners, ownership history & transfer').count(),0);
  await accounts.getByRole('button',{name:'Add salon'}).click();await page.getByText('Create salon in place').waitFor();assert.equal(await page.getByText('Workspace select').count(),0);
  assert.equal(await page.locator('details.settings-hub-branch').count(),0);
  assert.equal(page.url(),'http://localhost/');assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});
