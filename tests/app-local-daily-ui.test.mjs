import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(executablePath);
let bundle;
async function fixture(path, data = {}, context = null, options = {}) {
  bundle ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{getAppLocalDailyPage as getAppLocalPage}from'./lib/app-local-daily-registry';import{OfflineNetworkFormGuard}from'./components/offline-network-form-guard';
import{resetAppLocalResources,seedAppLocalResource}from'./lib/app-local-resource';
window.fixture.reads=[];window.fixture.actions=[];window.fixture.onlineOpens=[];window.fixture.api=[];
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.fixture.online===true});
window.fetch=async(input,options)=>{window.fixture.api.push([input,options]);if(String(input).startsWith('/api/business-claims/matches?'))return Response.json({matches:window.fixture.matches??[],error:null});throw Error('Offline fixture forbids API access')};
window.resolvePage=path=>getAppLocalPage(path)?.id;window.pageIds=[];
window.seed=(name,args,data)=>seedAppLocalResource(window.fixture.context.context.scope,name,args,{schemaVersion:1,status:200,scope:window.fixture.context.context.scope,etag:'r2',updatedAt:Date.now()+1000,data});
function App(){const[props,setProps]=useState({path:window.fixture.path,context:window.fixture.context});window.navigate=path=>{history.pushState(null,'',path);setProps(value=>({...value,path}))};window.switchAccount=context=>{window.fixture.context=context;resetAppLocalResources();setProps(value=>({...value,context}))};const page=getAppLocalPage(props.path);return <><OfflineNetworkFormGuard/>{page?<page.Component {...props} navigate={window.navigate}/>:<p>No local renderer</p>}</>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define:{'process.env.NEXT_PUBLIC_MAPTILER_KEY':'""'}, plugins: [{ name: 'local-runtime-fixture', setup(builder) {
    const modules = {
      'next/navigation': `export const useRouter=()=>({push:href=>window.navigate(href),replace:href=>window.navigate(href),refresh:()=>window.dispatchEvent(new Event('reylumi:app-local-command-complete')),prefetch:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});`,
      'next/link': `import React from'react';export const useLinkStatus=()=>({pending:false});export default function Link({href,children,prefetch,replace,scroll,shallow,locale,legacyBehavior,passHref,onNavigate,onClick,...props}){return <a {...props} href={typeof href==='string'?href:href.pathname} onClick={event=>{onClick?.(event);if(event.defaultPrevented||event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||String(href).startsWith('#'))return;event.preventDefault();window.navigate(String(href))}}>{children}</a>}`,
      'next/image': `import React from'react';export default function Image({src,fill,priority,unoptimized,fetchPriority,quality,placeholder,blurDataURL,loader,...props}){return <img {...props} src={typeof src==='string'?src:src.src}/>}`,
      'next/form': `import React from'react';export default function Form({action,children,...props}){return <form {...props} action={typeof action==='function'?action:undefined} onSubmit={typeof action==='string'?event=>{event.preventDefault();const q=new URLSearchParams(new FormData(event.currentTarget));window.navigate(action+'?'+q)}:undefined}>{children}</form>}`,
      'next/dynamic':`import React from'react';export default function dynamic(){return()=>null}`,
      'server-only': '',
      'app-local-data-policy':`export const appLocalReadIsDurable=name=>name==='owner.ticket-detail';`,
      'experience-scope': `export const useExperienceScope=()=>window.fixture.context?{context:window.fixture.context.context}:null;`,
      'app-local-host': `export function getAppLocalHost(){return{isNative:false,cache:async()=>null,read:async(name,args,options)=>{window.fixture.reads.push({name,args,options});if(window.fixture.holdRead)return new Promise((resolve,reject)=>{window.fixture.resolveRead=data=>resolve({schemaVersion:1,status:200,scope:options.scope,etag:'r1',updatedAt:Date.now(),data});window.fixture.rejectRead=message=>reject(Error(message))});if(window.fixture.responses?.[name])return{schemaVersion:1,status:200,scope:options.scope,etag:'r1',updatedAt:Date.now(),data:window.fixture.responses[name]};throw Error('Offline')},openOnline:async path=>{window.fixture.onlineOpens.push(path)}}}`,
      'portable-sync-indicator': `import React from'react';export function PortableSyncIndicator({scope}){return <span data-fixture-sync-scope={scope}/>}`,
      'experience-persistent-cache': `export const getExperienceOfflineGrant=()=>window.fixture.context?.grant;export const isExperienceSnapshotAuthorized=scope=>scope===window.fixture.context?.context.scope;export const isExperienceSnapshotContextAuthorized=({scope})=>isExperienceSnapshotAuthorized(scope);export const EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT='reylumi:offline-authorization';export const readExperienceSnapshot=async({scope,domain,params})=>{if(!isExperienceSnapshotAuthorized(scope))return null;return window.fixture.data[JSON.stringify([scope,domain,params||{}])]??null};export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};`,
    };
    builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(modules).find(key => args.path === key || args.path.endsWith('/' + key)); return key ? { path: key, namespace: 'fixture' } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', contents: modules[args.path], resolveDir: process.cwd() }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: 'export default {};' }));
    builder.onLoad({ filter: /\.(tsx|ts)$/ }, args => {
      const content = readFileSync(args.path, 'utf8');
      if (!/^\s*['"]use server['"]/.test(content)) return;
      const names = [...content.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(match => match[1]);
      return { loader: 'js', contents: names.map(name => `export async function ${name}(...args){window.fixture.actions.push({name:${JSON.stringify(name)},args});return window.fixture.results?.[${JSON.stringify(name)}]??{}}`).join('\n') };
    });
  } }] });
  const output = await bundle, errors = [], seed = JSON.stringify({ path, context, data, ...options }).replaceAll('<', '\\u003c');
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(output.outputFiles[0].text); }
    else if (request.url?.startsWith('/api/')) { response.statusCode = 500; response.end('No live service'); }
    else { response.setHeader('Content-Type', 'text/html'); response.end(`<div id="root"></div><script>window.fixture=${seed}</script><script src="/bundle.js"></script>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
  return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}
const context = (scope = 'scope-a', authenticated = true) => ({ schemaVersion: 1, context: { scope, viewerId: 'viewer-a', salonId: null, workspaceId: 'personal', permissionRevision: 'r1', authenticated }, grant: null, display: { name: 'Me', language: 'en', role: 'customer' }, onlineValidatedAt: Date.now() });
const saved = (scope, domain, args, data) => ({ [JSON.stringify([scope, domain, args])]: { data, revision: '"r1"', updatedAt: Date.now(), retainUntil: Date.now() + 60000 } });

const ticketId='11111111-1111-4111-8111-111111111111';
function ticketData(){return{salon:{id:'salon-a',name:'My salon',phone:'5125550100'},canManageTickets:true,canVoidTickets:true,options:{services:[{id:'service-a',name:'Manicure',base_price:35}],staff:[]},ticket:{id:ticketId,salon_id:'salon-a',ticket_number:'T-42',status:'open',created_at:'2026-10-16T12:00:00Z',opened_at:'2026-10-16T12:00:00Z',closed_at:null,source_booking_id:null,customer:{id:'customer-a',name:'Existing customer',phone:'5125550100',email:'customer@example.invalid'},discount_type:'fixed_amount',discount_value:0,tax_rate:0,tip_type:'fixed_amount',tip_value:0,audit_logs:[],payments:[],ticket_items:[{id:'item-a',quantity:1,unit_price:35,line_total:35,service_name_snapshot:'Manicure',service:{id:'service-a',name:'Manicure',base_price:35,duration_minutes:30},assigned_staff:null,source_kind:'manual',created_at:'2026-10-16T12:00:00Z'}]}}}
test('canonical installed owner ticket detail keeps one original POS navigation during held, failed and successful reads; legacy keeps its general shell', {skip,timeout:40000},async()=>{
  const owner=context();owner.context.salonId='salon-a';owner.access={ownerWorkspace:true,staffWorkspace:false};
  const app=await fixture('/pos/ticket/'+ticketId,{},owner,{online:true,holdRead:true});
  try{
    const nav=app.page.locator('[data-owner-navigation]');await nav.waitFor();
    assert.equal(await nav.count(),1);assert.equal(await nav.locator('a[data-owner-tab=ticket]').getAttribute('aria-current'),'page');
    assert.equal(await nav.locator('[data-fixture-sync-scope]').getAttribute('data-fixture-sync-scope'),'owner:salon-a:viewer-a');
    await nav.evaluate(node=>window.originalNavigation=node);
    await app.page.waitForFunction(()=>fixture.rejectRead);assert.equal(await app.page.getByRole('heading',{name:'Receipt Preview',exact:true}).count(),0);
    await app.page.evaluate(()=>fixture.rejectRead('The ticket read failed.'));
    await app.page.getByText('The ticket read failed.',{exact:true}).waitFor();
    assert.equal(await nav.evaluate(node=>node===window.originalNavigation),true);
    await app.page.evaluate(data=>{fixture.holdRead=false;fixture.responses={'owner.ticket-detail':data}},ticketData());
    await app.page.getByRole('button',{name:'Try again',exact:true}).click();
    await app.page.getByRole('heading',{name:'Receipt Preview',exact:true}).waitFor();
    assert.equal(await nav.count(),1);assert.equal(await nav.evaluate(node=>node===window.originalNavigation),true);
    await app.page.getByRole('button',{name:'More',exact:true}).click();await app.page.locator('[data-owner-more-popover] a[href="/payroll"]').waitFor();
    await app.page.keyboard.press('Escape');
    await app.page.evaluate(id=>window.navigate('/pos-tickets/'+id),ticketId);
    await app.page.waitForFunction(()=>!document.querySelector('[data-owner-navigation]'));
    await app.page.getByRole('heading',{name:'Receipt Preview',exact:true}).waitFor();
    assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);
  }finally{await app.close()}
});
test('ticket detail navigation uses the admitted owner gate without changing the original sign-in/read guard', {skip,timeout:40000},async()=>{
  const customer=context(),app=await fixture('/pos/ticket/'+ticketId,{},customer);
  try{
    await app.page.getByRole('heading',{name:'POS Ticket',exact:true}).waitFor();assert.equal(await app.page.locator('[data-owner-navigation]').count(),0);
    await app.page.evaluate(()=>window.switchAccount({schemaVersion:1,context:{scope:'scope-b',viewerId:'owner-b',salonId:'salon-b',authenticated:true},grant:{kind:'owner'},offline:true,display:{name:'Owner',language:'en',role:'owner'}}));
    await app.page.locator('[data-owner-navigation]').waitFor();assert.equal(await app.page.locator('[data-fixture-sync-scope]').getAttribute('data-fixture-sync-scope'),'owner:salon-b:owner-b');
    await app.page.evaluate(()=>window.switchAccount({schemaVersion:1,context:{scope:'scope-c',authenticated:false},grant:null,display:{name:'',language:'en',role:'guest'}}));
    await app.page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await app.page.locator('[data-owner-navigation]').count(),0);
    assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);
  }finally{await app.close()}
});
test('complete retained ticket detail keeps payment entries during quiet reads and requires an explicit online confirmation', {skip,timeout:40000},async()=>{
  const data=ticketData(),app=await fixture('/pos/ticket/'+ticketId,saved('scope-a','owner-ticket-detail',{ticketId},data),context());
  try{
    await app.page.getByRole('heading',{name:'Receipt Preview',exact:true}).waitFor();await app.page.getByRole('heading',{name:'Activity Timeline',exact:true}).waitFor();
    const amount=app.page.locator('input[name=amount]');await amount.fill('12.34');
    await app.page.evaluate(()=>{window.originalAmount=document.querySelector('input[name=amount]')});
    await app.page.getByRole('button',{name:'Add Payment',exact:true}).click();
    await app.page.getByRole('status').filter({hasText:"You're offline"}).waitFor();assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);assert.equal(await amount.inputValue(),'12.34');
    await app.page.evaluate(next=>window.seed('owner.ticket-detail',{ticketId:next.ticket.id},next),{...data,ticket:{...data.ticket,notes:'Refreshed source'}});
    assert.equal(await app.page.evaluate(()=>document.querySelector('input[name=amount]')===originalAmount),true);assert.equal(await amount.inputValue(),'12.34');assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);
    await app.page.evaluate(()=>{fixture.online=true;window.dispatchEvent(new Event('online'))});await app.page.getByRole('button',{name:'Add Payment',exact:true}).click();
    await app.page.waitForFunction(()=>fixture.actions.some(row=>row.name==='addPosPayment'));
    assert.equal(await app.page.evaluate(()=>fixture.actions.filter(row=>row.name==='addPosPayment').length),1);
    assert.equal(await app.page.evaluate(()=>fixture.actions.find(row=>row.name==='addPosPayment').args[0].get('ticket_id')),ticketId);assert.equal(await app.page.evaluate(()=>fixture.actions.find(row=>row.name==='addPosPayment').args[0].get('amount')),'12.34');
    await app.page.evaluate(()=>window.switchAccount({schemaVersion:1,context:{scope:'scope-b',authenticated:false},display:{name:'',language:'en',role:'guest'}}));
    await app.page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await app.page.getByText('Existing customer',{exact:true}).count(),0);
  }finally{await app.close()}
});
test('closed read-only ticket preserves receipt/history while hiding payment and workflow forms', {skip,timeout:40000},async()=>{
  const data=ticketData();data.ticket.status='closed';data.ticket.closed_at='2026-10-16T13:00:00Z';data.canManageTickets=false;data.canVoidTickets=false;data.options={services:[],staff:[]};
  const app=await fixture('/pos-tickets/'+ticketId,saved('scope-a','owner-ticket-detail',{ticketId},data),context());
  try{await app.page.getByRole('heading',{name:'Receipt Preview',exact:true}).waitFor();assert.equal(await app.page.locator('form').count(),0);assert.equal(await app.page.locator('input[name=amount]').count(),0);assert.equal(await app.page.getByRole('heading',{name:'Activity Timeline',exact:true}).count(),1);assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);assert.equal(await app.page.evaluate(()=>resolvePage('/pos-tickets/'+location.pathname.split('/').at(-1)+'?token=secret')),undefined)}finally{await app.close()}
});
test('Tax Company uses its complete original report and retains an unsent note through a scoped quiet update without autosave', {skip,timeout:40000},async()=>{
  const id='22222222-2222-4222-8222-222222222222',app=await fixture('/tax-company/'+id,{},context());
  const data={salon:{id,name:'Connected salon',phone:'5125550100',address_line1:'Road',country:'United States'},payrollSetting:{cycle_type:'monthly'},period:{value:'2026-10-01:2026-10-31'},periodOptions:[{value:'2026-10-01:2026-10-31',startDate:'2026-10-01',endDate:'2026-10-31',historical:false}],run:null,lines:[],note:{content:'Saved note',version:2,updated_at:null}};
  try{
    await app.page.evaluate(({id,data})=>window.seed('customer.tax-report',{salonId:id},data),{id,data});await app.page.getByRole('heading',{name:'Connected salon',exact:true}).waitFor();
    const notes=app.page.getByRole('complementary',{name:'Salon notes'});await notes.getByRole('button',{name:'Edit',exact:true}).click();const draft=notes.getByRole('textbox',{name:'Notes for this salon'});await draft.fill('Unsent note');
    await app.page.evaluate(({id,data})=>window.seed('customer.tax-report',{salonId:id},data),{id,data:{...data,note:{content:'New server note',version:3,updated_at:null}}});assert.equal(await draft.inputValue(),'Unsent note');assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);
    await app.page.evaluate(()=>{fixture.online=true;fixture.results={saveTaxCompanyNote:{error:'This note changed. Please reload.'}}});await notes.getByRole('button',{name:'Save',exact:true}).click();await notes.getByRole('status').filter({hasText:'This note changed'}).waitFor();assert.equal(await draft.inputValue(),'Unsent note');assert.deepEqual(await app.page.evaluate(()=>fixture.actions.find(row=>row.name==='saveTaxCompanyNote').args),[id,'Unsent note',2]);
    assert.equal(await app.page.locator('form input[name=salon_id]').inputValue(),id);
  }finally{await app.close()}
});

