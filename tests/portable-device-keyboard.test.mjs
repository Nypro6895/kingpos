import {deviceSettingsFixture} from './helpers/device-settings-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

test('device input: default off, persist/reopen, cross-window sync, device isolation, native typing, custom service and storage failure', { timeout: 90000 }, async () => {
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{DeviceInputSettingsButton}from'./app/pos/portable/device-input-settings';
    import{PortableTouchKeyboard}from'./app/pos/portable/touch-keyboard';
    import{CustomServiceDialog}from'./app/pos/custom-service-dialog';
    import{useSupplementalKeyboard}from'./lib/portable-keyboard-preference';
    function App(){const enabled=useSupplementalKeyboard();const[value,setValue]=useState('');const[custom,setCustom]=useState(false);
      return <main data-portable-shell className="p-5"><DeviceInputSettingsButton/><label>Customer<input inputMode="text" value={value} onChange={e=>setValue(e.target.value)}/></label><label>Notes<textarea/></label><label>Date<input type="date"/></label>
      <output>{String(enabled)}</output><button onClick={()=>setCustom(true)}>Custom service</button>
      {custom&&<CustomServiceDialog showKeyboard={enabled} onCancel={()=>setCustom(false)} onDone={()=>setCustom(false)}/>}
      <PortableTouchKeyboard/></main>};createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: 'out', jsx: 'automatic', loader: { '.css': 'css' },
    plugins: [deviceSettingsFixture(),{name:'next-fixture',setup(builder){
      builder.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const usePathname=()=>'/pos/portable';export const useRouter=()=>({refresh(){},push(){}});`}));
    }}],
  });
  const js = built.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const sources='@source "'+resolve('app').split(String.fromCharCode(92)).join('/')+'";';
  const globals = (await readFile('app/globals.css','utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n'+sources);
  const global = await postcss([tailwindcss()]).process(globals,{from:resolve('app/globals.css')});
  assert.ok(global.css.includes('.h-10'),'Render the real device settings utilities');
  const css = global.css + '\n' + built.outputFiles.find(f=>f.path.endsWith('.css')).text;
  if(process.env.KEYBOARD_QA_DIR)await writeFile(resolve(process.env.KEYBOARD_QA_DIR,'rendered-settings.css'),css);
  const server = createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const context=await browser.newContext({viewport:{width:1024,height:768}});
    const page=await context.newPage(), other=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await other.goto(url);
    const keyboard=page.getByRole('group',{name:'Touch keyboard'});
    const open=()=>page.getByRole('button',{name:'Device settings',exact:true}).click();
    const close=()=>page.getByRole('dialog',{name:'Device settings'}).getByRole('button',{name:'Close settings',exact:true}).click();
    const toggle=page.getByLabel('Keyboard');
    await page.getByLabel('Customer',{exact:true}).click();
    await page.keyboard.type('Maya');assert.equal(await page.getByLabel('Customer',{exact:true}).inputValue(),'Maya');
    assert.equal(await keyboard.count(),0);assert.equal(await page.getByLabel('Customer',{exact:true}).getAttribute('inputmode'),'text');
    // An old salon setting must not re-enable a new device. A fresh device has no saved choice.
    assert.equal(await page.locator('output').textContent(),'false');
    await page.getByRole('button',{name:'Custom service',exact:true}).click();
    assert.equal(await page.getByLabel('Service keyboard').count(),0);
    assert.equal(await page.getByLabel('Service name',{exact:true}).getAttribute('inputmode'),'text');
    await page.keyboard.type('Custom manicure');assert.equal(await page.getByLabel('Service name',{exact:true}).inputValue(),'Custom manicure');
    await page.keyboard.press('Escape');
    await open();assert.equal(await toggle.isChecked(),false);await toggle.check();await close();
    await other.waitForFunction(()=>document.querySelector('output').textContent==='true');
    await page.getByLabel('Customer',{exact:true}).click();await keyboard.waitFor();
    await keyboard.getByRole('button',{name:'a',exact:true}).click();
    assert.equal(await page.getByLabel('Customer',{exact:true}).inputValue(),'Mayaa');
    assert.equal(await page.getByLabel('Customer',{exact:true}).getAttribute('inputmode'),'none');
    await open();await toggle.uncheck();await close();
    assert.equal(await keyboard.count(),0);
    assert.equal(await page.getByLabel('Customer',{exact:true}).getAttribute('inputmode'),'text');
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--portable-keyboard-height')),'');
    await other.waitForFunction(()=>document.querySelector('output').textContent==='false');
    await open();await toggle.check();await close();
    await page.reload();await page.waitForFunction(()=>document.querySelector('output').textContent==='true');
    await page.getByRole('button',{name:'Custom service',exact:true}).click();
    await page.getByLabel('Service keyboard').waitFor();
    await page.getByLabel('Service keyboard').getByRole('button',{name:'A',exact:true}).click();
    assert.equal(await page.getByLabel('Service name',{exact:true}).inputValue(),'A');
    await page.keyboard.press('Escape');
    // Separate browser context represents another machine/profile: no shared salon preference.
    const isolated=await browser.newContext(), fresh=await isolated.newPage();await fresh.goto(url);
    assert.equal(await fresh.locator('output').textContent(),'false');await isolated.close();
    // Read errors fail closed; write errors remain visible and do not claim a save.
    const unavailable=await browser.newContext();await unavailable.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('blocked')};Storage.prototype.setItem=()=>{throw Error('disk full')};});
    const blocked=await unavailable.newPage();await blocked.goto(url);await blocked.getByRole('button',{name:'Device settings',exact:true}).click();
    await blocked.getByLabel('Keyboard').click();
    await blocked.getByRole('alert').waitFor();assert.equal(await blocked.getByLabel('Keyboard').isChecked(),false);await unavailable.close();
    await open();await toggle.uncheck();await close();await page.reload();await page.waitForFunction(()=>document.querySelector('output').textContent==='false');
    await open();
    for(const viewport of [{width:1024,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);const box=await page.getByRole('dialog').boundingBox();
      if(process.env.KEYBOARD_QA_DIR){await mkdir(process.env.KEYBOARD_QA_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.KEYBOARD_QA_DIR,'device-settings-'+viewport.width+'.png')});}
      assert.ok(box.width>200&&box.width<=448&&box.x>=0&&box.x+box.width<=viewport.width&&box.y>=0&&box.y+box.height<=viewport.height);
      assert.ok(Math.abs(box.x+box.width/2-viewport.width/2)<=1&&Math.abs(box.y+box.height/2-viewport.height/2)<=1,'Dialog stays centered: '+JSON.stringify({box,viewport,style:await page.getByRole('dialog').evaluate(el=>{const c=getComputedStyle(el);return {margin:c.margin,inset:c.inset,position:c.position}})}));
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});

test('staff PIN keypad remains visible and accepts digits with supplemental keyboard off and on', {timeout:30000}, async()=>{
  const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from'react';import{createRoot}from'react-dom/client';
    import{PortableCheckInClient}from'./app/pos/portable/check-in/portable-check-in-client';
    import{DeviceInputSettings}from'./app/pos/portable/device-input-settings';
    import{PortableTouchKeyboard}from'./app/pos/portable/touch-keyboard';
    import{portableBusinessDate}from'./lib/portable-business-day';
    const data={checkInEnabled:true,salonId:'fixture',salonLogoUrl:null,salonName:'Fixture',today:portableBusinessDate('America/Chicago'),timezone:'America/Chicago',staff:[{id:'alex',displayName:'Alex',avatarUrl:null,checkInAt:null,checkInSequence:null,isPasscodeDefault:false,jobTitle:null,queueTurnCount:0,status:'not_checked_in'}]};
    createRoot(document.getElementById('root')).render(<main data-portable-shell><DeviceInputSettings/><PortableCheckInClient data={data} action={async()=>{throw Error('Unexpected submit')}}/><PortableTouchKeyboard/></main>);
  `},bundle:true,write:false,outdir:'out',jsx:'automatic',define:{'process.env':'{}'},loader:{'.css':'css'},plugins:[deviceSettingsFixture(),{name:'fixture',setup(b){
    b.onResolve({filter:/^next\/navigation$/},()=>({path:'nav',namespace:'fixture'}));
    b.onResolve({filter:/supabase\/browser$/},()=>({path:'supabase',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='nav'?`export const usePathname=()=>'/pos/portable/check-in';const router={refresh(){}};export const useRouter=()=>router;`:`export const createSupabaseBrowserClient=()=>null;`}));
  }}]});
  const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?js:'<div id="root"></div><script src="/app.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try{const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);process.stderr.write(e.message+'\n');});await page.goto(`http://127.0.0.1:${server.address().port}`);
    for(const enabled of [false,true]){
      await page.getByLabel('Keyboard').setChecked(enabled);
      await page.getByRole('button',{name:/Alex/}).click();const dialog=page.getByRole('dialog');
      await dialog.getByRole('button',{name:'1',exact:true}).click();await dialog.getByRole('button',{name:'2',exact:true}).click();
      assert.equal(await dialog.getByRole('textbox',{name:'Passcode',exact:true}).textContent(),'••');
      assert.equal(await page.getByRole('group',{name:'Touch keyboard'}).count(),0);
      await dialog.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await dialog.getByRole('textbox',{name:'Passcode',exact:true}).textContent(),'•');
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    }assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
