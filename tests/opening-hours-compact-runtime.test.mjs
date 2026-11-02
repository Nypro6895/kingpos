import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';

test('Opening hours: compact week, focused day, split hours, cancel, timezone and safe save/retry', {timeout:90000}, async()=>{
 const out='artifacts/opening-hours-compact';fs.mkdirSync(out,{recursive:true});
 const fixture=`import React from 'react';import{createRoot}from'react-dom/client';
 import{OpeningHoursEditor}from'./app/settings/opening-hours-editor';
 import{SettingsChildPages,SettingsChildPage}from'./app/settings/settings-child-pages';
 import'./app/settings/direct-settings.css';import'./app/settings/compact-settings.css';import'./app/settings/settings-hub.css';
 window.writes=[];window.refreshes=0;window.hold=false;window.fail=false;
 const weeklyHours=Array.from({length:7},(_,dayOfWeek)=>({id:'day-'+dayOfWeek,dayOfWeek,opensAtLocal:dayOfWeek===0?'11:00':'09:00',closesAtLocal:dayOfWeek===0?'16:00':'19:00',sortOrder:0}));
 if(location.search.includes('split'))weeklyHours.splice(1,1,{id:'mon-am',dayOfWeek:1,opensAtLocal:'09:00',closesAtLocal:'12:00',sortOrder:0},{id:'mon-pm',dayOfWeek:1,opensAtLocal:'13:00',closesAtLocal:'19:00',sortOrder:1});
 const data={kind:'salon-profile',salonId:'salon-one',hours:{timeZone:'America/Chicago',weeklyHours}};
 createRoot(document.getElementById('root')).render(<div className="compact-settings settings-hub"><div className="settings-inline-editor settings-direct-panel"><SettingsChildPages label="Salon information"><SettingsChildPage title="Opening hours"><OpeningHoursEditor data={data} onSaved={async()=>{window.refreshes++}}/></SettingsChildPage></SettingsChildPages></div></div>);`;
 const result=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'safe-boundaries',setup(b){
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onResolve({filter:/direct-settings-actions$/},()=>({path:'actions',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='language'?`import React from 'react';export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`:`export async function saveDirectHours(salonId,payload){window.writes.push({salonId,payload});if(window.hold)await new Promise(resolve=>window.release=resolve);return window.fail?{ok:false,error:'Save failed. Your draft is still here.'}:{ok:true};}`,loader:'js',resolveDir:process.cwd()}));
 }}]});
 for(const file of result.outputFiles)fs.writeFileSync(out+'/'+(file.path.endsWith('.css')?'fixture.css':'fixture.js'),file.text);
 const base=await postcss([tailwind()]).process('@import "tailwindcss";',{from:path.resolve('app/globals.css')});fs.writeFileSync(out+'/base.css',base.css);
 fs.writeFileSync(out+'/index.html','<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:14px Arial;background:#fff}button,input,select{font:inherit}h1,h2,h3,p{margin:0}[hidden]{display:none!important}</style><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>');
 const server=createServer((req,res)=>{const file=req.url.endsWith('.js')?'fixture.js':req.url.endsWith('base.css')?'base.css':req.url.endsWith('.css')?'fixture.css':'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(out+'/'+file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),origin='http://127.0.0.1:'+server.address().port;
 const checks=[];
 try {
  for(const width of [320,375,430,768]){
   const page=await browser.newPage({viewport:{width,height:812},timezoneId:'America/Chicago'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByRole('button',{name:'Opening hours',exact:true}).click();
   const days=page.locator('.opening-hours-day');assert.equal(await days.count(),7);assert.equal(await page.locator('.opening-hours-day[open]').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   const rows=await days.locator('summary').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().height));assert.ok(rows.every(h=>h<=54&&h>=44));
   assert.ok((await days.last().boundingBox()).y<650,'All seven days fit together');
   const selected=await page.locator('select[name=timezone] option:checked').textContent();assert.equal(selected,'America / Chicago');
   if(width===375)await page.screenshot({path:out+'/opening-hours-week.png',fullPage:true});
   await days.nth(1).locator('summary').click();await page.getByLabel('Monday: Opens 1',{exact:true}).fill('10:00');
   assert.equal(await page.evaluate(()=>window.writes.length),0,'Editing never saves implicitly');
   const range=page.locator('.opening-hours-day[open] .opening-hours-range');const sizes=await range.locator('input,button').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().toJSON()));assert.equal(sizes.length,3);assert.ok(sizes.every(s=>s.height>=44));assert.ok(Math.abs(sizes[0].y-sizes[1].y)<1);assert.ok(Math.abs(sizes[1].y-sizes[2].y)<1,'Delete stays alongside times');assert.ok(sizes[2].width<=45);
   if(width===375)await page.screenshot({path:out+'/opening-hours-day.png',fullPage:true});
   await days.nth(2).locator('summary').click();await page.waitForFunction(()=>document.querySelectorAll('.opening-hours-day[open]').length===1);await days.nth(1).locator('summary').click();assert.equal(await page.getByLabel('Monday: Opens 1',{exact:true}).inputValue(),'10:00','Day switching retains drafts');
   await page.getByRole('switch',{name:'Monday: Open',exact:true}).uncheck();assert.match(await days.nth(1).locator('summary').innerText(),/Closed/);await page.getByRole('switch',{name:'Monday: Open',exact:true}).check();assert.equal(await page.getByLabel('Monday: Opens 1',{exact:true}).inputValue(),'10:00','Reopening restores draft');
   await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('.opening-hours-day[open]').count(),0);await days.nth(1).locator('summary').click();assert.equal(await page.getByLabel('Monday: Opens 1',{exact:true}).inputValue(),'09:00');
   await page.getByRole('button',{name:'+ Add time range',exact:true}).click();await page.getByLabel('Monday: Closes 1',{exact:true}).fill('12:00');await page.getByLabel('Monday: Opens 2',{exact:true}).fill('13:00');await page.getByLabel('Monday: Closes 2',{exact:true}).fill('19:00');await page.locator('select[name=timezone]').selectOption('America/New_York');
   await page.evaluate(()=>{window.hold=true;window.fail=true});await page.getByRole('button',{name:'Save opening hours',exact:true}).click();await page.waitForFunction(()=>window.writes.length===1);assert.equal(await page.getByLabel('Monday: Opens 1',{exact:true}).isDisabled(),true);await page.evaluate(()=>window.release());await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Monday: Opens 2',{exact:true}).inputValue(),'13:00');assert.equal(await page.locator('select[name=timezone]').inputValue(),'America/New_York');
   await page.evaluate(()=>{window.hold=false;window.fail=false});await page.getByRole('button',{name:'Save opening hours',exact:true}).click();await page.getByRole('status').waitFor();const saved=await page.evaluate(()=>window.writes.at(-1));assert.equal(saved.salonId,'salon-one');assert.equal(saved.payload.timeZone,'America/New_York');assert.equal(saved.payload.weeklyHours.length,8);assert.equal(saved.payload.weeklyHours.find(w=>w.id==='day-1').closesAtLocal,'12:00');assert.equal(saved.payload.weeklyHours.find(w=>w.id==='day-0').opensAtLocal,'11:00');assert.deepEqual(errors,[]);
   checks.push({width,rowsCompact:true,noOverflow:true,draftsCancelAndRetry:true,canonicalPayload:true});await page.close();
  }
  const page=await browser.newPage({viewport:{width:375,height:812}});await page.goto(origin+'/?split');await page.getByRole('button',{name:'Opening hours',exact:true}).click();const monday=page.locator('.opening-hours-day').nth(1);assert.equal(await monday.locator('.opening-hours-summary>span').count(),2);await monday.locator('summary').click();await page.getByRole('button',{name:'Remove Monday time range 1',exact:true}).click();assert.equal(await page.getByLabel('Monday: Opens 1',{exact:true}).inputValue(),'13:00');await page.getByRole('switch',{name:'Monday: Open',exact:true}).uncheck();await page.getByRole('button',{name:'Save opening hours',exact:true}).click();await page.getByRole('status').waitFor();assert.equal(await page.evaluate(()=>window.writes.at(-1).payload.weeklyHours.some(w=>w.dayOfWeek===1)),false,'Closed saves no windows');
  const validation=await browser.newPage({viewport:{width:375,height:812},timezoneId:'America/Los_Angeles'});await validation.goto(origin);await validation.getByRole('button',{name:'Opening hours',exact:true}).click();assert.equal(await validation.locator('select[name=timezone]').inputValue(),'America/Chicago','Salon zone must not become the device zone');await validation.locator('.opening-hours-day').nth(1).locator('summary').click();await validation.getByLabel('Monday: Opens 1',{exact:true}).fill('');await validation.locator('.opening-hours-day').nth(2).locator('summary').click();await validation.getByRole('button',{name:'Save opening hours',exact:true}).click();await validation.getByLabel('Monday: Opens 1',{exact:true}).waitFor({state:'visible'});assert.equal(await validation.evaluate(()=>window.writes.length),0,'Invalid hidden input prevents writes and reveals its day');await validation.getByLabel('Monday: Opens 1',{exact:true}).fill('10:00');await validation.locator('.settings-child-back').click();await validation.getByRole('button',{name:'Opening hours',exact:true}).click();assert.equal(await validation.getByLabel('Monday: Opens 1',{exact:true}).inputValue(),'10:00','Page Back retains the draft');
  fs.writeFileSync(out+'/checks.json',JSON.stringify({passed:true,checks,hiddenRequiredFieldRevealed:true,salonZonePreservedAcrossDeviceZones:true,pageBackRetainsDraft:true,scope:'Real editor, InlineForm, Settings navigation and all shared Settings CSS; synthetic action transport; no hosted or installed-device acceptance'},null,2));
 } finally {await browser.close();await new Promise(r=>server.close(r));}
});
