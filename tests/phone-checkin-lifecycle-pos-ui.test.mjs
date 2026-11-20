import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('Arrivals without prices open in Saved tickets, standby updates and failed switches restore the saved revision', {timeout:90000},async()=>{
 const contents=`
 import React from 'react';import{createRoot}from'react-dom/client';import{OwnerPosClient}from'./app/pos/owner-pos-client';import{PosDeskClient}from'./app/pos/pos-desk-client';
 import{DEFAULT_WORKSPACE_PREFERENCES as prefs}from'./lib/pos-workspace-preferences';import{portableBusinessDate}from'./lib/portable-business-day';
 const today=portableBusinessDate('America/Chicago');
 window.ticket={visitId:'visit1',customerId:'customer1',customerName:'Lover-nai',queueNumber:1,status:'checkout',scanMode:true,revision:1,draftTip:5,draftDiscount:2,requestedServices:[{id:'service1',name:'Full Set'}],offers:[{id:'offer1',staffId:'staff1',staffName:'Kim',status:'done'}],lines:[{id:'line1',offerId:'offer1',staffId:'staff1',staffName:'Kim',serviceId:'service1',serviceName:'Full Set',amount:45}]};
 window.initialTicket=structuredClone(window.ticket);window.calls=[];window.normalReceipts=[];
 window.visitState=async visitId=>({data:{visitId,status:window.ticket?.status??'completed',revision:window.ticket?.revision??null,ticketId:window.ticket?null:'final1',completed:!window.ticket,cancelled:false}});
 window.relayLoad=async()=>{if(window.failRead)return{error:"Connection interrupted"};return({data:{installed:true,tickets:window.ticket?[structuredClone(window.ticket)]:[],staff:[{id:'staff1',name:'Kim'}],services:[{id:'service1',name:'Full Set',price:40}]}})};
 window.updateHeld=async input=>{if(window.failNext){window.failNext=false;throw Error("Failed to fetch")};window.calls.push(structuredClone(input));if(!window.ticket&&input.finalize)return{ticketId:"final1",alreadyClosed:true};if(input.revision!==window.ticket?.revision)return{error:'Ticket changed. Refresh before saving.'};if(input.finalize){window.ticket=null;return{ticketId:'final1'}};window.ticket={...window.ticket,revision:window.ticket.revision+1,lines:input.lines.map(l=>({...l,amount:Number(l.amount),staffName:'Kim',serviceName:'Full Set',offerId:'offer1'})),draftNote:input.note,draftTip:input.tip,draftDiscount:input.discount};return{ticket:structuredClone(window.ticket)}};
 window.workspace={scope:'salon1:display',businessDate:today,timezone:'America/Chicago',preparedDay:today,offlineEnabled:true,preferences:prefs,settings:null,attendanceByStaffId:{},setAttendance(){}};
 const defaults={adsFooter:'',largeTurnThreshold:25,showServiceName:true,showStaffName:true,staffCheckInEnabled:false,taxEnabled:false,tipSuggestions:[5,10,15,20]},staff=[{id:'staff1',display_name:'Kim',job_title:'Professional',is_active:true,avatar_url:null,today_status:'working',turns:{largeTurns:0,queueTurns:0,receiptLargeTurns:0,smallTurns:0,totalTurns:0}}],services=[{id:'service1',name:'Full Set',category:'Nails',base_price:40}];
 const portable=new URLSearchParams(location.search).get('surface')==='portable';
 if(!portable)localStorage.setItem('kingpos:owner-cart:v1:owner-test',JSON.stringify({savedAt:Date.now(),cart:{id:'local1',amount:'',staffId:null,serviceId:null,customer:null,lines:[{id:'local-line',staffId:'staff1',staffName:'Kim',serviceId:'service1',serviceLabel:'Full Set',amountInput:'20',amountParts:[20],total:20}],tip:'',discount:''}}));
 createRoot(document.getElementById('root')).render(portable?<PosDeskClient surface="portable" offlineDraftSyncEnabled={true} salonName="Fixture" today={today} defaults={defaults} staff={staff} services={services} activeSession={null} liveDraft={{token:'display',salon_id:'salon1',status:'draft',version:1,customer:null,staff_lines:[],tip:0,subtotal:0,discount:0,tax:0,total:0,total_before_tip:0}} heldTicketState={window.visitState} heldTicketLoad={window.relayLoad} heldTicketUpdate={window.updateHeld} holdSharedDraft={async()=>({shared:true})}/>:<OwnerPosClient scope="owner-test" salonId="salon1" salonName="Fixture" initial={{staff,services,defaults,today}}/>);
 `;
 const built=await build({bundle:true,write:false,outdir:'fixture',jsx:'automatic',stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},plugins:[{name:'safe-boundaries',setup(b){
  const stub=(filter,name)=>b.onResolve({filter},()=>({path:name,namespace:'fixture'}));
  stub(/^next\/navigation$/,'navigation');stub(/^next\/link$/,'link');stub(/workspace-language$/,'language');stub(/supabase\/browser$/,'supabase');stub(/pos-workspace-sync$/,'sync');stub(/portable-operations$/,'operations');stub(/single-workspace-window$/,'single');stub(/owner-pos-tabs$/,'tabs');stub(/portable-sync-indicator$/,'indicator');stub(/portable-workspace-state$/,'workspace');stub(/use-portable-draft$/,'draft');
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:({
   navigation:`const router={refresh(){},push(){},replace(){}};export const useRouter=()=>router;export const usePathname=()=>'/pos';export const useSearchParams=()=>new URLSearchParams();`,
   link:`import React from'react';export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}`,
   language:`export const WorkspaceText=({text})=>text;export const WorkspaceElement=({children})=>children;export const useWorkspaceTranslation=()=>s=>s;`,
   supabase:`export const createSupabaseBrowserClient=()=>null;`,
   sync:`export function usePosResourceRefresh(){};export function subscribePosChanges(id,cb){return()=>{}};`,
   operations:`export const PORTABLE_OPERATIONS_CHANGED='operations';export async function portableCheckpoint(){return 0}export async function listPortableOperations(){return []}export async function savePortableOperation(...args){window.normalReceipts.push(args)}`,
   single:`export const SingleWorkspaceWindow=({children})=>children;`,tabs:`export const OwnerPosTabs=()=>null;export const OwnerPosNavigation=()=>null;`,indicator:`export const PortableSyncIndicator=()=>null;`,
   workspace:`export const usePortableWorkspaceState=()=>window.workspace;export const mergePortableStaff=staff=>staff;`,
   draft:`import{useRef,useCallback}from'react';export function usePortableDraft(){return{ready:true,enqueue(){},flush:async()=>true,observeVersion(){},persistLocal:(payload,recovery)=>{window.recovery=recovery;return true},checkpoint(){},recoveryKey:useRef('fixture')}};export const PORTABLE_DRAFT_STATE_CHANGED='draft';export const portableDraftStates=new Map();`,
  })[a.path]}));
  b.onResolve({filter:/\/actions$/},({path:p,importer})=>({path:path.resolve(p.startsWith('@/')?p.slice(2):path.join(path.dirname(importer),p))+'.ts',namespace:'actions'}));
  b.onLoad({filter:/.*/,namespace:'actions'},({path:p})=>({contents:[...fs.readFileSync(p,'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>`export async function ${m[1]}(...args){${m[1]==='getPosHeldTicketState'?'return window.visitState(...args)':m[1]==='loadServiceRelay'?'return window.relayLoad()':m[1]==='updatePosHeldTicket'?'return window.updateHeld(...args)':m[1]==='searchPosDeskCustomers'?'return []':m[1]==='getPosLiveDraft'?'return {ok:true,data:null}':`throw Error('Unexpected action ${m[1]}')`}}`).join('\n')}));
 }}]});
 const globalCss=(await postcss([tailwind({base:process.cwd()})]).process(fs.readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css;
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=globalCss+(built.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'')+fs.readFileSync('app/pos/owner-pos.css','utf8');
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:14px Arial;--surface-muted:#f4f7f6;--brand-orange-soft:#fff5ef}button{min-height:40px}dialog:not([open]){display:none}${css}</style><div id="root"></div><script>${js}</script></html>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const out='artifacts/checkin-shared-lifecycle-20261111';fs.mkdirSync(out,{recursive:true});
 try{for(const surface of ['owner','portable']){
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?surface=${surface}`);
  await page.getByRole('button',{name:/Saved tickets/}).click();await page.getByRole('button',{name:/Lover-nai · #1/}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Saved tickets"][role="dialog"]'));
  assert.equal(await page.getByRole('button',{name:'Edit services & amounts'}).count(),0);assert.equal(await page.getByRole('button',{name:'Payment collected · Submit'}).count(),0);
  const revision=()=>page.evaluate(surface=>surface==='owner'?JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner-test')).cart.heldTicket?.revision:window.recovery.draft.heldTicket?.revision,surface);
  // Fail only the target refresh, after the current ticket was saved successfully.
  await page.getByRole('button',{name:/Saved tickets/}).click();await page.getByRole('button',{name:/Lover-nai · #1/}).waitFor();
  await page.evaluate(()=>{window.failRead=true});
  await page.getByRole('button',{name:/Lover-nai · #1/}).click();
  await page.getByRole('dialog',{name:'Saving and opening ticket'}).waitFor({state:'detached'});
  assert.equal(await revision(),2);assert.equal(await page.evaluate(()=>window.ticket.revision),2);
  await page.getByRole('dialog',{name:'Saved tickets',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>{window.failRead=false});
  await page.getByRole('button',{name:'Save for later',exact:true}).click();
  await page.getByRole('dialog',{name:'Saved tickets',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>{window.ticket={...window.initialTicket,lines:[],offers:[],status:'waiting',draftTip:0,draftDiscount:0}});
  await page.getByRole('button',{name:/Saved tickets/}).click();await page.getByRole('button',{name:/Lover-nai · #1/}).filter({hasText:'Not priced'}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Saved tickets"][role="dialog"]'));
  assert.equal(await revision(),1);
  await page.getByRole('textbox',{name:'Note',exact:true}).fill('Arrived, no price yet');
  await page.getByRole('button',{name:'Save for later',exact:true}).click();
  await page.getByRole('button',{name:/Lover-nai · #1/}).filter({hasText:'Not priced'}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Saved tickets"][role="dialog"]'));
  assert.equal(await page.getByRole('textbox',{name:'Note',exact:true}).inputValue(),'Arrived, no price yet');
  assert.equal(await revision(),2);
  assert.equal(await page.getByRole('alert').count(),0);
  await page.screenshot({path:out+`/waiting-${surface}.png`,fullPage:true});
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
});
