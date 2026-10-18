import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';

test('mobile service editor keeps inline fields, independent extra groups, staff and reachable Save/Cancel',{
  skip:!process.env.TEST_BROWSER_PATH,timeout:90000,
},async()=>{
  console.error('editor-ui: bundling fixture');
  const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{ServicesManager}from'./app/services/services-manager';
    window.calls=[];
    const data={canManage:true,addOnLinks:[],staff:[{id:'anna',displayName:'Anna',isActive:true,onlineBookingEnabled:true,bookingReady:true}],services:[{id:'pedi',salon_id:'salon',name:'Spa pedi',category:'Pedicure',description:'Callus treatment',base_price:40,duration_minutes:45,is_active:true,online_booking_enabled:true,addOnServiceIds:[],bookingStaffIds:['anna'],bookingAddOns:[],readiness:{ready:true,needsSetup:false,reasons:[],bookingStaffCount:1,eligibleBookingStaffCount:1}}]};
    createRoot(document.getElementById('root')).render(<ServicesManager data={data} initialServiceId='pedi'/>);`;
  const stubs={
    '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;`,
    '@/components/contextual-support':`export const ContextualSupport=()=>null;`,
    '@/components/workspace-toolbar':`import React from 'react';export const WorkspaceToolbar=({children})=><div>{children}</div>;export const toolbarStyles={};`,
    '@/components/compact-filters':`import React from 'react';export const CompactFilters=({children})=><div>{children}</div>;`,
    '@/app/settings/delete-unused-button':`export const DeleteUnusedButton=()=>null;`,
    'next/navigation':`export const useRouter=()=>({refresh(){window.refreshed=true},replace(){}});`,
    '@/app/services/actions':`export async function saveServiceConfigsAction(configs){window.calls.push(configs);return{ok:true,serviceIds:configs.map(x=>x.serviceId),message:'Service saved.'}}export const createServiceAction=async()=>({ok:true,serviceIds:['new']});`,
  };
  const built=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'jsx',resolveDir:process.cwd()}));}}]});
  const css=readFileSync('app/services/services.css','utf8');
  const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles[0].text)}else res.end(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${css}#nav{position:fixed;bottom:0;height:64px;width:100%;background:#faf5ef;z-index:50;text-align:center;padding:20px}</style></head><body><div id="root"></div><nav id="nav">Today · Book · Profile · More</nav><script src="/fixture.js"></script></body></html>`)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  console.error('editor-ui: starting browser');
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    page.setDefaultTimeout(7000);
    console.error('editor-ui: loading offline fixture');
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    // Fully offline fixture: the browser sandbox may block even loopback URLs.
    await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${css}#nav{position:fixed;bottom:0;height:64px;width:100%;background:#faf5ef;z-index:50;text-align:center;padding:20px}</style></head><body><div id="root"></div><nav id="nav">Today · Book · Profile · More</nav></body></html>`);
    await page.addScriptTag({content:built.outputFiles[0].text});
    console.error('editor-ui: interacting');
    const editor=page.locator('.service-editor');
    await editor.getByLabel('Name:',{exact:true}).fill('Spa pedi deluxe');
    const nameBox=await editor.getByLabel('Name:',{exact:true}).boundingBox();
    const labelBox=await editor.locator('.services-field').first().locator('span').first().boundingBox();
    assert.ok(Math.abs(nameBox.y-labelBox.y)<15,'label and input share the same row');
    const groups=page.locator('.service-addon-group');assert.equal(await groups.count(),2);
    await groups.nth(0).getByRole('button',{name:'+ Add',exact:true}).click();
    assert.equal(await groups.nth(0).getByLabel('Add-on name',{exact:true}).evaluate(node=>node===document.activeElement),true,'Add focuses the visible name input');
    assert.equal(await groups.nth(0).getByLabel('Add-on name',{exact:true}).getAttribute('placeholder'),'e.g. Gel polish');
    assert.equal(await groups.nth(0).getByLabel('Add-on extra time').inputValue(),'');
    assert.equal(await groups.nth(0).getByLabel('Add-on extra time').getAttribute('placeholder'),'e.g. 10');
    const priceInput=groups.nth(0).getByLabel('Add-on extra price');
    assert.equal(await priceInput.inputValue(),'');
    assert.equal(await priceInput.getAttribute('placeholder'),'e.g. 10.00');
    await priceInput.fill('0');await priceInput.fill('');
    assert.equal(await priceInput.inputValue(),'','deleting zero leaves an empty editable field');
    await priceInput.pressSequentially('10.50');
    assert.equal(await priceInput.inputValue(),'10.50','decimal draft is preserved while typing');
    await priceInput.fill('');await priceInput.pressSequentially('15');
    assert.equal(await priceInput.inputValue(),'15','no undeletable leading zero');
    await groups.nth(0).getByLabel('Add-on name',{exact:true}).fill('Gel polish');
    await groups.nth(0).getByLabel('Add-on extra time').fill('15');
    await priceInput.fill('');
    await page.locator('.services-save-bar').getByRole('button',{name:'Save all changes'}).click();
    assert.equal(await page.evaluate(()=>window.calls.length),0,'blank required price is not silently saved as zero');
    assert.equal(await priceInput.inputValue(),'','validation retains the empty draft');
    await groups.nth(0).getByLabel('Add-on extra price').fill('15');
    await groups.nth(1).getByRole('button',{name:'+ Add',exact:true}).click();
    await groups.nth(1).getByLabel('Add-on name',{exact:true}).fill('Massage');
    await groups.nth(1).getByLabel('Add-on extra time').fill('10');
    await groups.nth(1).getByLabel('Add-on extra price').fill('10');
    await editor.getByRole('checkbox').uncheck();
    const savebar=page.locator('.services-save-bar');
    const saveBox=await savebar.getByRole('button',{name:'Save all changes'}).boundingBox(),navBox=await page.locator('#nav').boundingBox();
    assert.ok(saveBox.y+saveBox.height<=navBox.y,'save remains above bottom navigation');
    await page.locator('.service-editor__actions').getByRole('button',{name:'Save changes',exact:true}).click();
    await page.waitForFunction(()=>window.calls.length===1);
    const [saved]=await page.evaluate(()=>window.calls[0]);
    assert.equal(saved.name,'Spa pedi deluxe');assert.deepEqual(saved.bookingStaffIds,[]);
    assert.deepEqual(saved.bookingAddOns.map(x=>[x.name,x.group,x.durationMinutes,x.basePrice]),[['Gel polish','one',15,15],['Massage','many',10,10]]);
    assert.equal(await page.evaluate(()=>window.refreshed),true);
    await editor.getByLabel('Name:',{exact:true}).fill('Discard this');
    await page.locator('.services-save-bar').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await editor.getByLabel('Name:',{exact:true}).inputValue(),'Spa pedi');
    assert.equal(await page.locator('.services-save-bar').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    mkdirSync('artifacts/service-addon-groups-20261017',{recursive:true});
    await page.screenshot({path:'artifacts/service-addon-groups-20261017/mobile-editor.png',fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'artifacts/service-addon-groups-20261017/desktop-editor.png',fullPage:true});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

