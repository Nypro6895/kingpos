import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { context as esbuildContext } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

// Actual production page, forms, shell, calculations, receipt and translation.
// Only authentication/data/server-action/provider boundaries are replaced.
export async function ticketDetailPreview({ watch = false, baseline = false } = {}) {
  const cwd = process.cwd();
  const baselinePath = path.join(cwd,'artifacts/ticket-detail-professional/before/app/pos-tickets/closed-ticket-correction-form.tsx');
  if (baseline && !fs.existsSync(baselinePath)) throw Error('Missing exact canonical pre-edit card snapshot; restore the preserved before artifact to run historical pixel comparison');
  let current = null;
  let revision = 0;
  const clients = new Set();
  const entry = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import DetailPage from './app/(app)/pos-tickets/[ticketId]/page';
    import {DailyPosTicketCard} from './app/pos-tickets/closed-ticket-correction-form';
    ${baseline?"import {DailyPosTicketCard as BeforeCard} from 'qa/card-before';":"const BeforeCard=()=>{throw Error('Historical card comparison requires the exact preserved before snapshot')};"}
    import {NavigationShell} from './app/navigation-shell';
    import {WorkspaceLanguageProvider} from './components/workspace-language';
    import {ticketDetailFixture} from './tests/fixtures/ticket-detail-professional-data.mjs';
    import 'qa/watch-globals';
    if(window.__ticketPreviewRoot){window.__ticketPreviewRoot.unmount();window.__ticketPreviewRoot=null;}
    const fixture=ticketDetailFixture(location.search),q=new URLSearchParams(location.search);
    window.qaFixture={kind:'synthetic-production-component',scenario:fixture.scenario,revision:fixture.ticket.workspace_revision};
    window.qaActions=window.qaActions||[];window.qaNavigations=window.qaNavigations||[];
    window.qaNavigate=href=>{window.qaNavigations.push(String(href));const u=new URL(href,location.origin);for(const key of ['scenario','lang','surface','locked'])if(q.has(key)&&!u.searchParams.has(key))u.searchParams.set(key,q.get(key));location.assign(u.pathname+u.search+u.hash);};
    window.qaReads=[];window.qaPrintJobs=[];
    window.__reylumiReceiptPrint={version:1,print:async job=>{window.qaPrintJobs.push(job);return{jobId:job.jobId,status:'presented'}}};
    window.fetch=async input=>{const url=new URL(String(input),location.origin);if(url.origin===location.origin&&url.pathname==='/api/financial-input-history'){window.qaReads.push(url.pathname);return new Response(JSON.stringify({rows:[]}),{status:200,headers:{'content-type':'application/json'}})}throw Error('Unexpected network fetch in ticket component fixture: '+url.pathname)};
    const workspace={id:'salon:'+fixture.salon.id,type:'salon',salonMode:'manage',salonName:fixture.salon.name,label:fixture.salon.name,roleLabel:'Owner',menuActions:[]};
    const shellProps={accountAvatarUrl:null,accountEmail:'owner@example.test',accountLabel:'QA Owner',currentAccountName:'QA Owner',currentUserId:null,currentWorkspace:workspace,workspaceType:'salon',salonMode:'manage',workspaceOptions:[workspace],workspaceSections:[],notificationSummary:{items:[],total:0,bookingNotifications:0,previewItems:[],reviewHref:'/notifications'}};
    const list='/pos-tickets?date=2026-11-14&q=Nene&ticketId='+fixture.ticket.id;
    const detail='/pos-tickets/'+fixture.ticket.id+'?edit=1&returnTo='+encodeURIComponent(list);
    async function mount(){
      let content;
      if(q.has('card')||location.pathname==='/pos-tickets'){const Card=q.get('card')==='before'?BeforeCard:DailyPosTicketCard;content=<main className="mx-auto w-full max-w-6xl px-4 py-4" data-qa-card><Card ticket={fixture.ticket} dailyNumber={1} services={fixture.services} staff={fixture.staff} canEdit={fixture.canManage} canApplyFinancialCorrection={fixture.canManage} isBusinessDateLocked={fixture.locked} businessDateCompactLabel="Nov 14" timeZone="America/Chicago" returnTo={list} editHref={detail}/></main>}
      else content=await DetailPage({params:Promise.resolve({ticketId:fixture.ticket.id}),searchParams:Promise.resolve(Object.fromEntries(q))});
      const node=<WorkspaceLanguageProvider enabled={fixture.language==='vi'} portableEnabled={false} expiresAt={null}>{q.has('bare')?content:<NavigationShell {...shellProps}>{content}</NavigationShell>}</WorkspaceLanguageProvider>;
      window.__ticketPreviewRoot=window.__ticketPreviewRoot||createRoot(document.getElementById('root'));
      window.__ticketPreviewRoot.render(node);window.qaMounted=true;
    }
    mount().catch(e=>{window.qaMountError=e.stack;document.getElementById('root').textContent=e.stack;console.error(e)});
  `;
  const actionNames = [...fs.readFileSync(path.join(cwd,'app/pos-tickets/actions.ts'),'utf8').matchAll(/export\s+async\s+function\s+(\w+)/g)].map(m=>m[1]);
  const sourceFiles = ['app/(app)/pos-tickets/[ticketId]/page.tsx','app/pos-tickets/closed-ticket-correction-form.tsx','app/pos-tickets/ticket-detail-view.tsx','app/pos-tickets/ticket-detail-view.module.css','app/navigation-shell.tsx','app/globals.css','lib/pos-ticket-navigation.ts','lib/pos-ticket-calculations.ts','lib/pos-ticket-receipt.ts','lib/vietnamese-dictionary.ts','lib/vietnamese-ticket-detail.json'];
  const fixtureImport = `import {ticketDetailFixture} from './tests/fixtures/ticket-detail-professional-data.mjs';const fixture=()=>ticketDetailFixture(location.search);`;
  const replacements = {
    'server-only': '',
    '@/components/experience-page':'export const withExperiencePage=page=>page;',
    'next/link':`import React from 'react';export const useLinkStatus=()=>({pending:false});export default function Link({href,onClick,onNavigate,prefetch,replace,scroll,...p}){return <a {...p} href={String(href)} onClick={e=>{onClick?.(e);if(!e.defaultPrevented&&!e.ctrlKey&&!e.metaKey){e.preventDefault();onNavigate?.({preventDefault(){}});window.qaNavigate(String(href));}}}/>}`,
    'next/image':`import React from 'react';export default function Image({priority,fill,unoptimized,...p}){return <img {...p}/>}`,
    'next/navigation':`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:href=>window.qaNavigate(href),replace:href=>window.qaNavigate(href),refresh(){window.qaRefreshed=true}});export function redirect(href){window.qaNavigate(href);throw Error('Synthetic route redirect: '+href)}export function notFound(){throw Error('Synthetic route not found')}`,
    '@/lib/workspace-language-server':`import{translateVietnamese}from './lib/vietnamese-dictionary';export async function getWorkspaceTranslation(){const vi=new URLSearchParams(location.search).get('lang')==='vi';return text=>typeof text==='string'?translateVietnamese(text,vi):text}`,
    '@/lib/route-context-guards':`${fixtureImport}export async function requireSalonManagePageContext(){return{user:{id:'qa-owner'},currentSalon:fixture().salon,currentMembership:{role:fixture().isOwner?'owner':'manager'},workspaceType:'salon',salonMode:'manage'}}`,
    '@/lib/current-context':`export const isOwnerMembership=membership=>membership?.role==='owner';`,
    '@/lib/permissions':`${fixtureImport}export async function hasPermission(permission){const f=fixture();return permission==='tickets.view'?f.canView:permission==='tickets.void'?f.canVoid:f.canManage};export const hasPermissionForRender=hasPermission;`,
    '@/lib/pos-tickets':`${fixtureImport}export const POS_TICKET_PERMISSIONS={view:'tickets.view',manage:'tickets.manage',void:'tickets.void'};export async function getCurrentSalonPosTicket(){return{ticket:fixture().scenario==='not-found'?null:fixture().ticket}}export async function getCurrentSalonPosTicketOptions(){const f=fixture();return{services:f.services,staff:f.staff,customers:[f.ticket.customer]}}export async function getCurrentSalonPosTickets(){return{tickets:[fixture().ticket]}}`,
    '@/lib/staff-workdays':`export const STAFF_WORKDAY_STATUS_LABELS={working:'Working',checked_in:'Checked in',not_checked_in:'Not checked in'};export const getTodayDate=()=> '2026-11-14';`,
    '@/lib/salon-business-clock':`export async function getContextBusinessTimezone(){return 'America/Chicago'}export async function getSalonBusinessTimezone(){return 'America/Chicago'}export async function getContextBusinessDate(){return '2026-11-14'}`,
    '@/lib/daily-pos-report':`${fixtureImport}export const FINANCIAL_CORRECTION_PERMISSIONS={apply:'financial_corrections.apply',request:'financial_corrections.request'};export async function canApplyFinancialCorrections(){return fixture().canManage}export async function isDailyClosingLocked(){return fixture().locked}`,
    '@/lib/pos-workspace-sync':'export function usePosResourceRefresh(){}',
    '@/app/pos-tickets/actions':actionNames.map(name=>`export async function ${name}(...args){const values=args[0] instanceof FormData?Object.fromEntries(args[0]):args;window.qaActions.push({name:${JSON.stringify(name)},values});window.dispatchEvent(new Event('qa-action'));}`).join('\n'),
    '@/lib/supabase/browser':'export const createSupabaseBrowserClient=()=>null;',
    '@/lib/notification-client':`export const markAllCenterViewed=()=>{};export const NOTIFICATIONS_REFRESH='qa-notifications';export const useNotificationSummary=initial=>initial;`,
    '@/components/campaign-plugin-context':'export const useCampaignPlugin=()=>false;',
    '@/components/explore-advertising':'export const ExploreAdSlot=()=>null;',
    '@/app/account/logout-button':'export const LogoutButton=()=>null;',
    '@/app/action-dialog':'export const ActionDialog=()=>null;',
    '@/app/notifications/notification-list':'export const NotificationFeedList=()=>null;',
    '@/app/quick-workspace-panel':'export const QuickWorkspacePanel=()=>null;',
    '@/lib/account-avatar':'export const safeAccountAvatarUrl=()=>null;',
    '@/components/settings-icon':'export const SettingsIconShape=()=>null;',
    '@/app/salons/actions':'export const setCurrentWorkspace=()=>{};export const switchWorkspaceDestination=()=>{};export const switchWorkspaceLanding=()=>{};',
  };
  const context = await esbuildContext({stdin:{contents:entry,resolveDir:cwd,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',outfile:'ticket-preview.js',jsx:'automatic',alias:{'@':cwd},logLevel:'silent',plugins:[{name:'ticket-component-fixture',setup(build){
    build.onResolve({filter:/.*/},args=>Object.hasOwn(replacements,args.path)?{path:args.path,namespace:'qa-stub'}:undefined);
    build.onLoad({filter:/.*/,namespace:'qa-stub'},args=>({resolveDir:cwd,loader:'tsx',contents:replacements[args.path]}));
    build.onResolve({filter:/^qa\/card-before$/},()=>({path:baselinePath,namespace:'qa-before'}));
    build.onLoad({filter:/.*/,namespace:'qa-before'},()=>({contents:fs.readFileSync(baselinePath,'utf8'),resolveDir:path.join(cwd,'app/pos-tickets'),loader:'tsx',watchFiles:[baselinePath]}));
    build.onResolve({filter:/^qa\/watch-globals$/},()=>({path:'globals',namespace:'qa-watch'}));
    build.onLoad({filter:/.*/,namespace:'qa-watch'},()=>({contents:'',watchFiles:[path.join(cwd,'app/globals.css'),path.join(cwd,'app/salon-manage-spacing.css')]}));
    build.onEnd(async result=>{
      if(result.errors.length){current={...current,error:result.errors.map(e=>e.text).join('\n')};return;}
      const {css}=await postcss([tailwind()]).process(fs.readFileSync(path.join(cwd,'app/globals.css'),'utf8'),{from:path.join(cwd,'app/globals.css')});
      const compiled=result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
      current={script:result.outputFiles.find(f=>f.path.endsWith('.js')).text,css:css+'\n'+compiled,revision:++revision,hashes:Object.fromEntries(sourceFiles.filter(f=>fs.existsSync(path.join(cwd,f))).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(cwd,f))).digest('hex')]))};
      for(const client of clients)client.write(`data: ${revision}\n\n`);
    });
  }}]});
  await context.rebuild();
  if(current?.error)throw Error(current.error);
  if(watch)await context.watch();
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method!=='GET'){res.writeHead(405);res.end('Read-only synthetic fixture');return;}
    if(url.pathname==='/__qa/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({synthetic:true,source:cwd,revision:current?.revision,hashes:current?.hashes,error:current?.error}));return;}
    if(url.pathname==='/__qa/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(`data: ${revision}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
    if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(current?.script||'');return;}
    if(url.pathname==='/bundle.css'){res.setHeader('Content-Type','text/css');res.end(current?.css||'');return;}
    if(url.pathname==='/brand/reylumi-logo-horizontal.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(path.join(cwd,'public/brand/reylumi-logo-horizontal.png')));return;}
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="qa-evidence" content="Synthetic production-component fixture; no database or provider"><title>Ticket actual source · Synthetic QA</title><link id="qa-source-css" rel="stylesheet" href="/bundle.css"><style>body{margin:0;font-family:Arial,Helvetica,sans-serif}</style></head><body><div id="root"></div><script src="/bundle.js"></script>${watch?`<script>let rev=${revision};const events=new EventSource('/__qa/events');events.onmessage=e=>{const next=Number(e.data);if(next===rev)return;rev=next;const old=document.getElementById('qa-source-css');const sheet=document.createElement('link');sheet.id='qa-source-css';sheet.rel='stylesheet';sheet.href='/bundle.css?revision='+next;sheet.onload=()=>old?.remove();document.head.appendChild(sheet);const script=document.createElement('script');script.src='/bundle.js?revision='+next;document.body.appendChild(script)};</script>`:''}</body></html>`);
  });
  return {server,rebuild:()=>context.rebuild(),getSource:()=>({source:cwd,revision:current?.revision,hashes:current?.hashes}),dispose:async()=>{for(const client of clients)client.end();if(server.listening)await new Promise(resolve=>server.close(resolve));await context.dispose();}};
}
