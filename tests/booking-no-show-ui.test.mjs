import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('no-show buttons, optional notes, history warning and filters work on desktop and mobile', {
 skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH, timeout:90000
}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{PortableBookWorkspace}from'./app/pos/portable/book/portable-book-workspace';
 const base={id:'booking',customerId:'customer',customerName:'Maya',customerPhone:'555',serviceIds:['a'],serviceNames:['Manicure'],staffId:'alice',staffName:'Alice',startAt:'2026-10-01T14:00:00Z',endAt:'2026-10-01T14:30:00Z',status:'confirmed',updatedAt:'2026-10-01T15:00:00Z',noShowCount:2,lines:[{id:'line',serviceId:'a',serviceName:'Manicure',staffId:'alice',staffName:'Alice',price:40}],total:40};
 window.server={...base};window.calls=[];
 const root=createRoot(document.getElementById('root'));
 const history=[{id:'previous',startAt:'2026-08-31T14:00:00Z',timezone:'America/Chicago',services:['Manicure'],note:null},{id:'previous2',startAt:'2026-07-01T15:45:00Z',timezone:'America/Chicago',services:['Full-Set'],note:'Optional historical note'}];
 window.renderRows=()=>root.render(<PortableBookWorkspace data={{appointments:[window.server],date:'2026-10-01',timezone:'America/Chicago',salonName:'King Nails',canCreate:true,canCancel:true,services:[{id:'a',name:'Manicure',duration_minutes:30,base_price:40}],staff:[{id:'alice',display_name:'Alice'}],setupMessage:null}} action={async()=>({ok:false,error:'unused'})} manageAction={async req=>{window.calls.push(req);if(req.action==='confirm'&&!req.payload?.acknowledgeNoShow)return{ok:true,data:{requiresNoShowReview:true,noShowHistory:history}};if(req.action==='confirm')window.server={...window.server,status:'confirmed'};if(req.action.startsWith('mark_no_show'))window.server={...window.server,status:'no_show',noShowKind:req.action==='mark_no_show_excused'?'excused':'unexcused',noShowNote:req.payload.reason};return{ok:true,data:window.server}}}/>);
 window.renderRows();
 `},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/portable-workspace-state$/},()=>({path:'workspace',namespace:'stub'}));
 b.onResolve({filter:/portable-operations$/},()=>({path:'operations',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='workspace'?'export const usePortableWorkspaceState=()=>null;':'export const PORTABLE_OPERATIONS_CHANGED="operations";export const listPortableOperations=async()=>[];export const savePortableOperation=async()=>{};'}));
 }}]});
 const tw=await postcss([tailwind({base:process.cwd()})]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const css=tw.css+'\n'+built.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 await mkdir('artifacts/no-show-qa',{recursive:true});
 try{
 for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date('2026-10-01T18:00:00Z'));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('button',{name:'Change status for Maya'}).click();
 await page.getByRole('button',{name:'No-show',exact:true}).click();
 await page.getByRole('button',{name:'Change status for Maya'}).click();
 assert.match(await page.getByRole('dialog',{name:'Appointment status'}).textContent(),/No-show/);
 await page.getByRole('button',{name:'No-show with reason',exact:true}).click();
 assert.match(await page.getByRole('table').textContent(),/No-show · With reason/);
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action.startsWith('mark_no_show')).every(c=>c.payload.reason==='')),true);
 await page.getByRole('button',{name:'Change status for Maya'}).click();
 await page.getByRole('button',{name:'No-show',exact:true}).click();
 await page.evaluate(()=>{window.server={...window.server,status:'pending'};window.renderRows();});
 await page.getByRole('button',{name:'Change status for Maya'}).click();
 await page.getByRole('button',{name:'Confirm appointment',exact:true}).click();
 const warning=page.getByRole('dialog',{name:'Previous no-shows'});await warning.waitFor();
 assert.match(await warning.textContent(),/2 unexcused no-shows/);
 assert.match(await warning.textContent(),/Aug 31, 2026/);
 assert.match(await warning.textContent(),/Full-Set/);
 await page.screenshot({path:'artifacts/no-show-qa/'+width+'-confirm-warning.png'});
 const rect=await warning.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1,'Warning fits viewport');
 await page.getByRole('button',{name:'Go back',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.server.status),'pending');
 await page.getByRole('button',{name:'Confirm appointment',exact:true}).click();
 await page.getByRole('button',{name:'Confirm anyway',exact:true}).click();
 await page.getByRole('dialog',{name:'Appointment status'}).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.server.status),'confirmed');
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='confirm'&&c.payload.acknowledgeNoShow).length),1);
 await page.getByRole('button',{name:'Change status for Maya'}).click();await page.getByRole('button',{name:'No-show with reason',exact:true}).click();
 await page.getByText('Filter',{exact:false}).first().click();
 await page.getByLabel('Status',{exact:true}).selectOption('no_show_unexcused');
 assert.equal(await page.getByRole('button',{name:'Change status for Maya'}).count(),0);
 await page.getByLabel('Status',{exact:true}).selectOption('no_show_excused');
 await page.getByRole('button',{name:'Change status for Maya'}).waitFor();
 assert.deepEqual(errors,[]);
 await page.close();
 }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
