import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
test('salon midnight expires cached staff and old operation overlays on wake and restart, without deleting queued receipts', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:45000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);const root=resolve('.').replaceAll('\\','/');
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{PortableWorkspaceStateProvider,usePortableWorkspaceState,mergePortableStaff}from'${root}/app/pos/portable/portable-workspace-state';
 const staff=[{id:'a',display_name:'Alice',today_status:'working',check_in_at:'2026-09-23T20:00:00Z',turns:{queueTurns:8,largeTurns:8,smallTurns:2,totalTurns:10,receiptLargeTurns:8}}];
 window.ops=[{id:'yesterday-checkin',kind:'attendance',state:'pending',occurredAt:'2026-09-23T20:00:00Z',payload:{staffId:'a',attendance:{status:'working',queueTurnCount:8}}},{id:'yesterday-sale',kind:'receipt',state:'pending',occurredAt:'2026-09-24T03:00:00Z',payload:{staffAttendance:{a:{status:'working',queueTurnCount:9}}}}];
 function Probe(){const w=usePortableWorkspaceState();const rows=mergePortableStaff(staff,w,'2026-09-23');return <><p data-optional>{mergePortableStaff(staff,w,"2026-09-23",false).length}</p><p data-day>{w.businessDate}</p><p data-staff>{rows.map(r=>r.display_name+':'+r.turns.queueTurns).join(',')}</p><button onClick={()=>w.setAttendance('a',{status:'working',queueTurnCount:0,checkInAt:new Date().toISOString()})}>Check in today</button></>}
 createRoot(document.getElementById('root')).render(<PortableWorkspaceStateProvider scope="test" offlineEnabled preparedAt={Date.parse('2026-09-23T23:00:00Z')} timezone="America/Chicago"><Probe/></PortableWorkspaceStateProvider>);`},jsx:'automatic',bundle:true,write:false,platform:'browser',plugins:[{name:'operations',setup(b){b.onResolve({filter:/pos-workspace-sync$/},args=>({path:args.path,namespace:'sync-fixture'}));b.onLoad({filter:/.*/,namespace:'sync-fixture'},()=>({contents:'export function usePosResourceRefresh(){}'}));b.onResolve({filter:/lib\/portable-operations$/},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const PORTABLE_OPERATIONS_CHANGED='ops';export const listPortableOperations=async()=>window.ops;`}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage();await page.clock.setFixedTime(new Date('2026-09-24T04:59:50Z'));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('[data-staff]').textContent==='Alice:9');
 await page.evaluate(()=>{window.ops[1].state='attention';window.dispatchEvent(new Event('ops'));});await page.waitForFunction(()=>document.querySelector('[data-staff]').textContent==='Alice:8');
 await page.evaluate(()=>{window.ops[1].state='cancelled';window.dispatchEvent(new Event('ops'));});await page.waitForFunction(()=>document.querySelector('[data-staff]').textContent==='Alice:8');
 await page.clock.setFixedTime(new Date('2026-09-24T05:00:01Z'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('[data-day]').textContent==='2026-09-24'&&document.querySelector('[data-staff]').textContent==='');
 await page.evaluate(()=>{window.ops.push({id:'failed-today',kind:'receipt',state:'attention',occurredAt:'2026-09-24T05:00:00Z',payload:{staffAttendance:{a:{status:'working',queueTurnCount:10}}}});window.dispatchEvent(new Event('ops'));});assert.equal(await page.locator('[data-staff]').innerText(),'');assert.equal(await page.evaluate(()=>window.ops.length),3);
 await page.reload();await page.waitForFunction(()=>document.querySelector('[data-day]').textContent==='2026-09-24');assert.equal(await page.locator('[data-staff]').innerText(),'');assert.equal(await page.locator('[data-optional]').innerText(),'1');
 await page.getByRole('button',{name:'Check in today'}).click();await page.waitForFunction(()=>document.querySelector('[data-staff]').textContent==='Alice:0');await page.evaluate(()=>window.dispatchEvent(new Event('ops')));assert.equal(await page.locator('[data-staff]').innerText(),'Alice:0');assert.equal(await page.evaluate(()=>window.ops.length),2);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
