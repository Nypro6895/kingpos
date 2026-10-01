import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('Calendar follows salon time on tab entry, shows an orange clock after closing, and preserves manual scrolling', {timeout:90000}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{PortableBookWorkspace}from'./app/pos/portable/book/portable-book-workspace';
 const data={appointments:[],date:'2026-09-25',timezone:'America/Chicago',salonName:'Fixture',canCreate:true,canCancel:true,canCreateTicket:true,services:[],staff:[{id:'a',display_name:'Alice'},{id:'b',display_name:'Bob'}],staffServiceAssignments:[],setupMessage:null};
 function App(){const[visible,setVisible]=React.useState(true);return <><nav aria-label="POS workspace"><a href="/pos/portable" onClick={e=>{e.preventDefault();setVisible(false)}}>POS</a><a href="/pos/portable/book" onClick={e=>{e.preventDefault();setVisible(true)}}>Book</a></nav><div hidden={!visible}><PortableBookWorkspace data={data} action={async()=>({ok:false,error:'unused'})} manageAction={async()=>({ok:false,error:'unused'})} slotsAction={async()=>[]} hoursAction={async date=>({date,source:'salon',intervals:[{start:540,end:1020}]})}/></div></>};
 createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'workspace',setup(b){b.onResolve({filter:/portable-workspace-state$/},()=>({path:'stub',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const usePortableWorkspaceState=()=>null;'}));}}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<style>body{margin:0;font-family:Arial}button{font:inherit}*{box-sizing:border-box}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-09-25T01:09:00Z')});
  await page.addInitScript(()=>localStorage.setItem('kingpos:booking-scale','168'));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  const marker=page.locator('[data-booking-current-time]'),scroll=page.getByLabel('Day schedule',{exact:true});
  assert.equal(await marker.count(),0,'Future dates do not pretend to be today');
  await page.getByRole('link',{name:'Book',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-booking-current-time]')&&document.querySelector('[aria-label="Day schedule"]').scrollTop>0);
  assert.equal(await page.getByLabel('Selected date').inputValue(),'2026-09-24','Use salon date, not UTC date');
  assert.equal(await marker.getAttribute('aria-label'),'Current time 8:09 PM');
  assert.equal(await marker.evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(242, 111, 61)');
  async function assertVisibleClock(){const line=await marker.boundingBox(),box=await scroll.boundingBox();assert.ok(line.y>box.y+70&&line.y<box.y+box.height-5,JSON.stringify({line,box}));assert.ok(line.width>box.width-90,'One line spans all staff columns');}
  await assertVisibleClock();
  await scroll.evaluate(el=>el.scrollTop=0);await page.clock.fastForward(60000);
  assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'Minute updates must not undo manual scrolling');
  assert.equal(await marker.getAttribute('aria-label'),'Current time 8:10 PM');
  await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Day schedule"]').scrollTop>0);await assertVisibleClock();
  await scroll.evaluate(el=>el.scrollTop=0);await page.getByRole('link',{name:'POS',exact:true}).click();await page.getByRole('link',{name:'Book',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Day schedule"]').scrollTop>0);await assertVisibleClock();
  await scroll.evaluate(el=>el.scrollTop=0);await page.getByRole('link',{name:'Book',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Day schedule"]').scrollTop>0);
  await page.getByLabel('Selected date').fill('2026-09-25');assert.equal(await marker.count(),0);
  await page.getByRole('link',{name:'Book',exact:true}).click();await marker.waitFor();
  if(process.env.BOOKING_QA_DIR)await page.screenshot({path:process.env.BOOKING_QA_DIR+'/calendar-current-time.png'});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
