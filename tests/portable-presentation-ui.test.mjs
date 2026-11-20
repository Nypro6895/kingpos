import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {_electron as electron} from 'playwright-core';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

test('Portable presentation: real receipt sizing, empty board and signed-out native window actions', {timeout:120000}, async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{PosDeskClient}from'./app/pos/pos-desk-client';
 import{PortablePosLoginForm}from'./app/pos/portable/portable-login-form';
 import{DeviceInputSettingsButton}from'./app/pos/portable/device-settings-panel';
 import{CustomerIdleScreen}from'./app/pos/customer-display/customer-idle-screen';
 import{saveCustomerDisplayPreferences,DEFAULT_CUSTOMER_DISPLAY_PREFERENCES}from'./lib/customer-display-preferences';window.makePromoImmediate=()=>saveCustomerDisplayPreferences({...DEFAULT_CUSTOMER_DISPLAY_PREFERENCES,idleSeconds:0});
 const root=createRoot(document.getElementById('root'));window.mode='pos';window.staffPresent=false;window.checkin=true;
 const staff={id:'staff',display_name:'Alexandria',job_title:'Professional',is_active:true,avatar_url:null,today_status:'working',check_in_at:new Date().toISOString(),turns:{largeTurns:0,queueTurns:0,receiptLargeTurns:0,smallTurns:0,totalTurns:0}};
 window.renderFixture=()=>{if(location.pathname==='/pos/customer-display'){root.render(<CustomerIdleScreen token="test-token" images={['/pos/customer-display-default-promo-slide.png']} title="Welcome" body="Test promotion" salonName="Test Salon" onBegin={()=>{}}><span>Check in</span></CustomerIdleScreen>);return;}return root.render(window.mode==='login'?<main className="grid h-dvh place-items-center bg-zinc-100"><PortablePosLoginForm rememberedAccessId="test-pos"/></main>:<main data-portable-pos-shell className="portable-kiosk-surface flex h-dvh flex-col overflow-hidden bg-zinc-100"><header className="flex h-14 shrink-0 justify-end"><DeviceInputSettingsButton/><button onClick={()=>{window.mode='login';window.renderFixture();}}>Sign out fixture</button></header><div className="min-h-0 flex-1 p-2"><PosDeskClient key={String(window.checkin)} surface="portable" activeSession={{id:'fixture',status:'active',lines:[{id:'line',staff_id:'staff',staff_name:'Alexandria',service_id:'service',service_label:'Express Pedicure with Gel Polish',sort_order:1,amount:1234.56,amount_input:'1234.56',amount_parts:[1234.56],turn_large_count:1,turn_small_count:0}]}} liveDraft={null} salonName="Test salon" services={[{id:'service',name:'Express Pedicure with Gel Polish',base_price:25},{id:'service2',name:'Design basic',base_price:10}]} staff={window.staffPresent?[staff]:[]} defaults={{adsFooter:'',largeTurnThreshold:25,showServiceName:true,showStaffName:true,staffCheckInEnabled:window.checkin,taxEnabled:false,tipSuggestions:[5,10,15,20]}}/></div></main>);};window.renderFixture();
 `},bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'backend-boundary',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
 b.onResolve({filter:/supabase\/browser$/},()=>({path:'supabase',namespace:'fixture'}));
 b.onResolve({filter:/customer-relay$/},()=>({path:'relay',namespace:'fixture'}));
 b.onResolve({filter:/device-appearance$/},()=>({path:'appearance',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='navigation'?'const router={refresh(){},push(){},replace(){}};export const useRouter=()=>router;export const usePathname=()=>"/pos/portable";':path==='supabase'?'export const createSupabaseBrowserClient=()=>null;':path==='relay'?'export const CustomerRelayEntry=()=>null;':'export const DeviceAppearance=()=>null;'}));
 b.onResolve({filter:/\/actions$/},({path,importer})=>({path:resolve(path.startsWith('@/')?path.slice(2):join(dirname(importer),path))+'.ts',namespace:'actions'}));
 b.onLoad({filter:/.*/,namespace:'actions'},({path})=>({contents:[...readFileSync(path,'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>`export async function ${m[1]}(){throw Error('Unexpected server action');}`).join('\n')}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const globals=readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "'+resolve('app').replaceAll('\\','/')+'";');
 const css=(await postcss([tailwindcss()]).process(globals,{from:resolve('app/globals.css')})).css+'\n'+(bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
 const requests=[];const server=createServer((req,res)=>{requests.push({method:req.method,url:req.url});if(req.url==='/pos/customer-display-default-promo-slide.png'){res.setHeader('Content-Type','image/png');res.end(readFileSync('public/pos/customer-display-default-promo-slide.png'));return;}res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':req.url==='/fixture.css'?'text/css':'text/html');res.end(req.url==='/fixture.js'?js:req.url==='/fixture.css'?css:'<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const evidence=resolve('artifacts/portable-addons-dismiss-20261030');mkdirSync(evidence,{recursive:true});
 const profile=mkdtempSync(join(evidence,'electron-profile-'));
 const env={...process.env,KINGPOS_DESKTOP_TEST_PROFILE:profile,KINGPOS_DESKTOP_TEST_ORIGIN:'http://127.0.0.1:'+server.address().port};delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try{
 app=await electron.launch({executablePath:resolve('desktop/node_modules/electron/dist/electron.exe'),args:[resolve('desktop')],env});const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.locator('[data-pos-receipt-line]').waitFor();
 for(const width of [900,1024,1440]){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,800),width);
  await page.waitForTimeout(150);
  const sizes=await page.locator('[data-pos-receipt-line]').evaluate(e=>{const item=e.querySelector('[data-pos-receipt-line-item]'),service=e.querySelector('[data-pos-receipt-line-service]'),price=e.querySelector('[data-pos-receipt-line-price]'),remove=e.querySelector('[data-pos-receipt-line-remove]');return{item:item.getBoundingClientRect().width,price:price.getBoundingClientRect().width,serviceClipped:service.scrollWidth>service.clientWidth+1,overlap:item.getBoundingClientRect().right>price.getBoundingClientRect().left+1,removeVisible:remove.getBoundingClientRect().right<=e.getBoundingClientRect().right+1};});
  assert.ok(sizes.item>sizes.price,JSON.stringify(sizes));assert.equal(sizes.serviceClipped,false);assert.equal(sizes.overlap,false);assert.equal(sizes.removeVisible,true);
  assert.equal(await page.locator('[data-pos-receipt-line-service]').textContent(),'Express Pedicure with Gel Polish');
  const tile=await page.locator('[data-pos-service-tile]').first().evaluate(e=>({clamp:getComputedStyle(e.firstElementChild).webkitLineClamp,clipped:e.firstElementChild.scrollHeight>e.firstElementChild.clientHeight+1}));assert.equal(tile.clamp,'none');assert.equal(tile.clipped,false);
 }
 await page.getByText('No staff checked in yet',{exact:true}).waitFor();
 await page.screenshot({path:join(evidence,'receipt-empty-board.png')});
 await page.evaluate(()=>{window.staffPresent=true;window.renderFixture();});await page.locator('[data-pos-staff-name]').waitFor();assert.equal(await page.locator('[data-pos-staff-empty]').count(),0);
 await page.evaluate(()=>{window.staffPresent=false;window.checkin=false;window.renderFixture();});await page.getByText('No staff available',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Device settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Device settings',exact:true});await settings.waitFor();

 assert.equal(await settings.getByRole('button',{name:'Minimize',exact:true}).count(),0);
 assert.equal(await settings.getByRole('button',{name:'Zoom in',exact:true}).count(),0);
 assert.equal(await settings.getByRole('button',{name:'Offline readiness',exact:true}).count(),0);
 const currentVersion=JSON.parse(readFileSync('desktop/package.json','utf8')).version;
 await settings.getByText(`KingPOS ${currentVersion}`,{exact:true}).waitFor();
 await settings.getByRole('heading',{name:'Settings',exact:true}).click();assert.equal(await settings.isVisible(),true);
 await page.mouse.click(2,2);await settings.waitFor({state:'hidden'});await page.getByRole('button',{name:'Device settings',exact:true}).click();await settings.waitFor();
 await app.evaluate(({ipcMain,app})=>{global.__mockUpdate={phase:'idle',version:'',currentVersion:app.getVersion(),scheduledAt:null,message:''};ipcMain.removeHandler('kingpos:update');ipcMain.handle('kingpos:update',()=>global.__mockUpdate);});
 await settings.getByRole('button',{name:'Up to date',exact:true}).waitFor();
 await app.evaluate(()=>{global.__mockUpdate={...global.__mockUpdate,phase:'available',version:'0.7.4'};});await settings.getByRole('button',{name:'Update',exact:true}).waitFor();
 await app.evaluate(()=>{global.__mockUpdate={...global.__mockUpdate,phase:'idle',version:''};});await settings.getByRole('button',{name:'Up to date',exact:true}).waitFor();
 await settings.getByRole('button',{name:'Turn on keyboard',exact:true}).click();await settings.getByRole('button',{name:'Turn off keyboard',exact:true}).waitFor();
 await settings.getByRole('button',{name:'Turn off keyboard',exact:true}).click();
 await settings.getByRole('button',{name:'Full screen promotion',exact:true}).click();assert.equal(await settings.getByRole('button',{name:'Full screen promotion',exact:true}).getAttribute('aria-pressed'),'true');
 await settings.getByRole('button',{name:'Beside check-in',exact:true}).click();
 await settings.getByRole('button',{name:'Turn off',exact:true}).click();await settings.getByRole('button',{name:'Turn on',exact:true}).waitFor();await settings.getByRole('button',{name:'Turn on',exact:true}).click();
 await settings.getByLabel('Upload promotion images',{exact:true}).setInputFiles(resolve('public/brand/reylumi-app-192.png'));
 await settings.getByRole('button',{name:'Restore',exact:true}).waitFor();
 assert.match(await settings.getByAltText('Promotion image 1',{exact:true}).getAttribute('src'),/^data:image\/jpeg;base64,/);
 await page.screenshot({path:join(evidence,'settings-list.png')});
 const previousImage=await settings.getByAltText('Promotion image 1',{exact:true}).getAttribute('src');
 await settings.getByLabel('Upload promotion images',{exact:true}).setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not-an-image')});
 await settings.getByRole('alert').getByText('This image could not be opened. Please choose another image.',{exact:true}).waitFor();
 assert.equal(await settings.getByAltText('Promotion image 1',{exact:true}).getAttribute('src'),previousImage);
 
 await page.evaluate(async()=>{window.makePromoImmediate();await window.kingposDesktop.display.pair('abcdefghijklmnop1234');await window.kingposDesktop.display.open();});
 const customer=app.windows().find(p=>p!==page);await customer.locator('.customer-idle-ad img').waitFor();
 assert.match(await customer.locator('.customer-idle-ad img').getAttribute('src'),/^data:image\/jpeg;base64,/);
 await customer.waitForFunction(()=>document.querySelector('.customer-idle-ad img').naturalWidth>0);
 await settings.getByRole('button',{name:'Full screen promotion',exact:true}).click();await customer.waitForFunction(()=>document.querySelector('[data-ad-layout]').getAttribute('data-ad-layout')==='full');
 await settings.getByRole('button',{name:'Turn off',exact:true}).click();await customer.waitForFunction(()=>document.querySelector('[data-ad-visible]').getAttribute('data-ad-visible')==='false');
 await settings.getByRole('button',{name:'Turn on',exact:true}).click();await customer.locator('.customer-idle-ad img').waitFor();
 await page.evaluate(()=>window.kingposDesktop.display.pair(null));
 assert.equal(requests.some(r=>!['GET','HEAD'].includes(r.method)),false,'Local images never upload to the server');
 
 await app.evaluate(({dialog,shell})=>{global.__appCalls=[];dialog.showMessageBox=async(_win,options)=>{global.__appCalls.push(options.message);return{response:0};};shell.openExternal=async url=>{global.__appCalls.push(url);};});
 await settings.getByRole('link',{name:'Open help website',exact:true}).click();await page.waitForTimeout(100);assert.ok((await app.evaluate(()=>global.__appCalls)).includes('https://reylumi.com/help/windows-portable'));
 await page.reload();await page.getByRole('button',{name:'Device settings',exact:true}).click();await settings.getByAltText('Promotion image 1',{exact:true}).waitFor();
 await settings.getByRole('button',{name:'Restore',exact:true}).click();await settings.getByAltText('Default promotion image',{exact:true}).waitFor();
 await settings.getByRole('button',{name:'Close settings',exact:true}).click();
 await page.getByRole('button',{name:'Custom services',exact:true}).click();const custom=page.getByRole('dialog',{name:'Custom service',exact:true});await custom.waitFor();await custom.getByRole('heading').click();assert.equal(await custom.isVisible(),true);await page.mouse.click(2,2);await custom.waitFor({state:'hidden'});
 await page.evaluate(()=>window.kingposDesktop.windowControls.fullscreen(true));
 await page.getByRole('button',{name:'Sign out fixture',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Device settings',exact:true}).count(),0);
 const full=page.locator('[data-portable-fullscreen-button]');await full.waitFor();
 const corner=page.locator('[data-portable-fullscreen-corner]');
 const box=await corner.boundingBox();const view=page.viewportSize()??await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(box.x>view.width-80&&box.y<20);
 await page.mouse.move(200,200);await page.waitForTimeout(200);assert.equal(await full.evaluate(el=>Number(getComputedStyle(el).opacity)),0);
 await corner.hover();await page.waitForTimeout(200);assert.equal(await full.evaluate(el=>Number(getComputedStyle(el).opacity)),1);assert.equal((await full.innerText()).trim(),'');
 await page.waitForFunction(()=>document.querySelector('[data-portable-fullscreen-button]').getAttribute('aria-pressed')==='true');assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
 await page.screenshot({path:join(evidence,'signed-out-fullscreen.png')});
 await full.click();await page.waitForFunction(()=>!document.querySelector('[data-portable-fullscreen-button]'));assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),false);
 assert.deepEqual(errors,[]);writeFileSync(join(evidence,'runtime-results.json'),JSON.stringify({receiptWidths:[900,1024,1440],emptyBoard:true,listSettings:true,noWindowZoomMinimize:true,localImageUploadAndReload:true,visualLayouts:true,keyboardToggle:true,currentVersion:true,helpWebsite:true,noSignedOutSettings:true,hiddenTopRightFullscreenExit:true,outsideSettingsDismiss:true,crossWindowLocalPromotion:true,updateStates:true,consoleErrors:errors},null,2));
 }finally{await app?.close().catch(()=>{});await new Promise(r=>server.close(r));}
});
