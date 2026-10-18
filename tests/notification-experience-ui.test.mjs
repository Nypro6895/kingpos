import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

test('notification center refreshes silently, preserves the reading row and drops late responses after logout', {timeout:60000}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {NotificationCenterClient} from './app/notifications/notification-center-client';
 import {resetExperienceCaches} from './lib/reset-experience-cache';
 import {experienceResourceCache} from './lib/experience-resource-cache';
 const row=(n)=>{const id=String(n).padStart(8,'0')+'-0000-4000-8000-000000000000';return {id:'app:'+id,title:'Update '+n,body:'Appointment update',createdAt:new Date(Date.UTC(2026,9,11,12,0,-n)).toISOString(),kindLabel:'Booking',meta:'Today',source:'app',status:'read',unread:false,action:{type:'open-app',notificationId:id,href:'/my-bookings/'+n,workspaceId:null,label:'View appointment'}}};
 const rows=Array.from({length:30},(_,i)=>row(i+1));window.serverRows=rows;window.calls=[];window.fail=false;window.delay=false;
 window.fetch=async(url,options)=>{window.calls.push(String(url));if(window.delay)await new Promise(resolve=>window.release=resolve);if(window.fail)return Response.json({error:'Background unavailable'},{status:503});const limit=Number(new URL(url,location.href).searchParams.get('limit'));const items=window.serverRows.slice(0,limit);return Response.json({items,cursor:{at:items.at(-1).createdAt,id:items.at(-1).action.notificationId}});};
 window.refresh=()=>window.dispatchEvent(new CustomEvent('kingpos:notifications-refresh',{detail:{newItems:true}}));
 window.addNew=()=>{const fresh=row(999);fresh.createdAt='2026-10-11T13:00:00Z';window.serverRows=[fresh,...rows];window.refresh();};
 window.logout=()=>resetExperienceCaches({reason:'logout',broadcast:false});window.cacheStats=()=>experienceResourceCache.stats();
 createRoot(document.getElementById('root')).render(<NotificationCenterClient initialItems={rows.slice(0,20)} initialCursor={{at:rows[19].createdAt,id:rows[19].action.notificationId}} actionItems={[]}/>);
 `},bundle:true,write:false,jsx:'automatic',plugins:[{name:'stubs',setup(b){
  b.onResolve({filter:/components\/experience-scope$/},()=>({path:'scope',namespace:'stub'}));
  b.onResolve({filter:/app\/(notifications|staff)\/actions$/},()=>({path:'actions',namespace:'stub'}));
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='scope'?`const scope={context:{scope:'fixture'},validate:async()=>true};export function useExperienceScope(){return scope;}`:args.path==='link'?`import React from 'react';export default function Link({children,href}){return <a href={href}>{children}</a>}`:`export async function runNotificationBookingAction(){return {ok:true}};export async function openAppNotificationAction(){};export async function acceptStaffInviteByRequestFormAction(){};export async function cancelStaffSalonApplicationFormAction(){};export async function declineStaffInviteByRequestFormAction(){}`,loader:'tsx',resolveDir:process.cwd()}));
 }}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><style>article{height:120px;box-sizing:border-box}body{margin:0}</style><div id='root'></div><script>${result.outputFiles[0].text}</script></html>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{channel:'msedge'}),headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('article').nth(19).waitFor();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.calls.length),0,'authorized initial data is not fetched twice');
  const original=await page.evaluate(()=>{const row=document.querySelectorAll('article')[6];window.scrollTo(0,row.getBoundingClientRect().top+window.scrollY-40);return {id:row.dataset.notificationId,top:row.getBoundingClientRect().top};});
  await page.evaluate(()=>window.addNew());await page.getByText('Update 999',{exact:true}).waitFor();
  const updated=await page.locator(`[data-notification-id="${original.id}"]`).evaluate(row=>row.getBoundingClientRect().top);
  assert.ok(Math.abs(updated-original.top)<=2,`reading position moved ${updated-original.top}px`);
  assert.equal(await page.locator('article').count(),21,'older loaded page remains after the new head arrives');
  assert.equal(await page.getByText(/New updates available|Showing the last available|saved temporarily/).count(),0);
  assert.equal(await page.getByRole('status').count(),0,'background fetch has no loading banner');
  await page.evaluate(()=>{window.fail=true;window.refresh();});await page.waitForFunction(()=>window.calls.length===2);await page.waitForTimeout(50);
  assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.locator('article').count(),21);
  await page.evaluate(()=>{window.fail=false;window.delay=true;window.refresh();});await page.waitForFunction(()=>typeof window.release==='function');
  await page.evaluate(()=>{window.logout();window.release();});await page.waitForTimeout(100);
  assert.equal(await page.locator('article').count(),0);assert.equal(await page.evaluate(()=>window.cacheStats().entries),0);assert.equal(await page.evaluate(()=>window.cacheStats().suspended),true);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
