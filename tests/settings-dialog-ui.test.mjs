import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('Settings keeps inline service creation and native child dialogs inside the parent panel', {skip:!process.env.ESBUILD_MODULE_PATH,timeout:90000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const panels=['ConnectionsPanel','SalonListPanel','AccountDeletionPanel','AccountProfileEditor','LoginSecurityPanel','NotificationPreferencesPanel'];
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AllSettingsClient}from'./app/settings/all-settings-client';window.nav=[];window.saved=0;window.calls=[];const row={id:'services',detailKind:'services',label:'Services',scope:'salon',icon:'scissors',description:'Edit services',action:'Edit',status:'Ready',keywords:[]};createRoot(document.getElementById('root')).render(<AllSettingsClient accountDeletionImpact={null} accountStatus="Active" accountStatusTone="success" activeScope="all" createdAtLabel="Today" currentWorkspaceLabel="Test Salon" initialQuery="" loginSecurityOverview={null} sections={[{id:'salon',label:'Salon',description:'',rows:[row]}]} user={{id:'user',display_name:'User'}}/>);`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'stub',setup(b){
 b.onResolve({filter:/next\/navigation$/},()=>({path:'nav',namespace:'stub'}));
 b.onResolve({filter:/app\/settings\/direct-settings-panel$/},()=>({path:'direct',namespace:'stub'}));
 b.onResolve({filter:/app\/(?:settings\/(?:connections-panel|salon-list-panel|notification-preferences-panel|login-security\/login-security-panel)|account\/(?:account-profile-editor|account-deletion-panel))$/},()=>({path:'panels',namespace:'stub'}));
 b.onResolve({filter:/app\/services\/actions$/},()=>({path:'actions',namespace:'stub'}));
 b.onResolve({filter:/\.\/delete-unused-action$/},()=>({path:'delete',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='nav'?`export const useRouter=()=>({replace:url=>window.nav.push(url),refresh:()=>window.nav.push('refresh')});export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>'/settings';`:a.path==='direct'?`import React,{useRef} from 'react';import{ServicesManager}from'./app/services/services-manager';export function DirectSettingsPanel(){const dialog=useRef(null);return <><button onClick={()=>dialog.current.showModal()}>Verify test salon</button><dialog ref={dialog}><input aria-label="Verification code"/></dialog><ServicesManager embedded expectedSalonId="salon" initialServiceId={null} data={{services:[],staff:[],addOnLinks:[],canManage:true}} onSaved={()=>{if(window.failReload)throw Error("Refresh unavailable");window.saved++}}/></>}`:a.path==='panels'?panels.map(n=>`export const ${n}=()=>null;`).join(''):a.path==='delete'?`export async function deleteUnusedRecordAction(){return {ok:true}}`:`export async function createServiceAction(input,salon){window.calls.push({input,salon});return {ok:true,message:'Created',serviceIds:['new']}};export async function saveServiceConfigsAction(){return {ok:true,message:'Saved',serviceIds:[]}};`}));
 }}]});
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{for(const width of [375,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.process={env:{}};});
  await page.route('http://localhost/',r=>r.fulfill({contentType:'text/html',body:`<style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${readFileSync('app/services/services.css','utf8')}${readFileSync('app/settings/direct-settings.css','utf8')}</style><div id="root"></div><script src="/app.js"></script>`}));
  await page.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:result.outputFiles.find(f=>f.path.endsWith('.js')).text}));
  await page.goto('http://localhost/');
  await page.getByRole('button',{name:/Services/}).click({timeout:5000}).catch(async error=>{throw Error(error.message+'\n'+await page.locator('body').innerText()+'\n'+errors.join('\n'))});
  await page.getByRole('button',{name:'New service',exact:true}).click();
  const creation=page.locator('.service-create-inline');await creation.waitFor();
  assert.equal(await creation.evaluate(e=>getComputedStyle(e).position),'static');
  assert.equal(await page.locator('.service-drawer-backdrop').count(),0);
  await creation.locator('input').first().focus();await page.keyboard.press('Escape');
  await creation.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Close settings detail'}).count(),1);
  await page.getByRole('button',{name:'Verify test salon'}).click();await page.getByLabel('Verification code').fill('123456');
  await page.keyboard.press('Escape');await page.locator('dialog[open]').waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Close settings detail'}).count(),1);
  await page.getByRole('button',{name:'New service',exact:true}).click();
  await creation.locator('input').first().fill('Test service');
  await creation.getByRole('button',{name:'Create service',exact:true}).click();
  await page.waitForFunction(()=>window.saved===1);
  assert.deepEqual(await page.evaluate(()=>window.nav),[]);
  assert.equal(await page.evaluate(()=>window.calls[0].salon),'salon');
  await page.evaluate(()=>{window.failReload=true});
  await page.getByRole('button',{name:'New service',exact:true}).click();
  await creation.locator('input').first().fill('Another service');
  await creation.getByRole('button',{name:'Create service',exact:true}).click();
  await page.getByRole('button',{name:'Reload service list'}).waitFor();
  await page.getByText(/Saved, but the service list/).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  await page.evaluate(()=>{window.failReload=false});
  await page.getByRole('button',{name:'Reload service list'}).click();
  await page.getByRole('button',{name:'Reload service list'}).waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  await page.getByRole('button',{name:'Close settings detail'}).click();
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});
