import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(executablePath);
let bundle;
async function fixture(path, data = {}, context = null) {
  bundle ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{getAppLocalPayrollTaxPage as getAppLocalPage}from'./lib/app-local-payroll-tax-registry';import{OfflineNetworkFormGuard}from'./components/offline-network-form-guard';
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
      'app-local-data-policy':`export const appLocalReadIsDurable=()=>false;`,
      'experience-scope': `export const useExperienceScope=()=>window.fixture.context?{context:window.fixture.context.context}:null;`,
      'app-local-host': `export function getAppLocalHost(){return{isNative:false,cache:async()=>null,read:async(name,args,options)=>{window.fixture.reads.push({name,args,options});if(window.fixture.responses?.[name])return{schemaVersion:1,status:200,scope:options.scope,etag:'r1',updatedAt:Date.now(),data:window.fixture.responses[name]};throw Error('Offline')},openOnline:async path=>{window.fixture.onlineOpens.push(path)}}}`,
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
  const output = await bundle, errors = [], seed = JSON.stringify({ path, context, data }).replaceAll('<', '\\u003c');
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

test('full payroll tax report keeps original saved-statement figures and period controls without triggering writes', {skip,timeout:40000},async()=>{
  const app=await fixture('/payroll/tax-company?report=1&month=2026-10',{},context());
  const data={access:{canManagePayroll:true,canViewTaxCompany:true},latestStatement:{run:{id:'saved-run',version:4,status:'printed'}},lines:[],period:{label:'October 2026',preset:'monthly',cycleType:'monthly',startDate:'2026-10-01',endDate:'2026-10-31'},periodOptions:[],scheduleSetup:{needsBiweeklyAnchor:false},salonPayrollSetting:{cycle_type:'monthly'},source:'saved',summary:{totalTaxCompanyTaxableGross:123.45}};
  try{await app.page.evaluate(data=>window.seed('owner.payroll-tax-report',{month:'2026-10'},data),data);
    await app.page.getByRole('heading',{name:'Tax payroll report',exact:true}).waitFor();await app.page.getByText('Saved Statement v4',{exact:false}).waitFor();assert.equal(await app.page.getByText('$123.45',{exact:true}).count(),1);
    await app.page.getByRole('button',{name:'Payroll filters',exact:false}).click();const month=app.page.locator('input[name=month]');await month.waitFor();assert.equal(await month.inputValue(),'2026-10');await month.fill('2026-09');
    const form=month.locator('xpath=ancestor::form');assert.equal(await form.getAttribute('action'),'/payroll/tax-company');assert.equal(await form.locator('input[name=report]').inputValue(),'1');assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);
    await app.page.evaluate(next=>window.seed('owner.payroll-tax-report',{month:'2026-10'},next),{...data,latestStatement:{run:{id:'saved-run',version:5,status:'printed'}}});assert.equal(await month.inputValue(),'2026-09');await app.page.getByText('Saved Statement v5',{exact:false}).waitFor();assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);
  }finally{await app.close()}
});
test('complete Tax Company settings preserves typed credentials through quiet data updates and submits only on explicit online save', {skip,timeout:40000},async()=>{
  const app=await fixture('/payroll/tax-company/settings',{},context()),state={active:true,enabled:true,salon_name:'My salon',login_id:'TAX-owner-id',connections:[{user_id:'tax-account',display_name:'Tax account',email:'tax@example.invalid',phone:null,account_active:true,connected_at:'2026-10-01T12:00:00Z'}]};
  try{await app.page.evaluate(data=>window.seed('owner.payroll-tax-settings',{},data),state);await app.page.getByRole('heading',{name:'Tax Company settings',exact:true}).waitFor();await app.page.getByRole('heading',{name:'People with tax access',exact:true}).waitFor();assert.equal(await app.page.getByRole('button',{name:'Disconnect all accounts',exact:true}).count(),1);
    await app.page.getByRole('button',{name:'Change password',exact:true}).click();const input=app.page.locator('input[name=password]');assert.equal(await input.getAttribute('type'),'password');await input.fill('Fixture-only-unsent-password');await app.page.evaluate(()=>{window.passwordInput=document.querySelector('input[name=password]')});
    await app.page.getByRole('button',{name:'Save new password',exact:true}).click();await app.page.getByRole('status').filter({hasText:"You're offline"}).waitFor();assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);
    await app.page.evaluate(data=>window.seed('owner.payroll-tax-settings',{},data),{...state,connections:[]});assert.equal(await input.inputValue(),'Fixture-only-unsent-password');assert.equal(await app.page.evaluate(()=>document.querySelector('input[name=password]')===passwordInput),true);assert.deepEqual(await app.page.evaluate(()=>fixture.actions),[]);
    await app.page.evaluate(()=>{fixture.online=true;window.dispatchEvent(new Event('online'))});await app.page.getByRole('button',{name:'Save new password',exact:true}).click();await app.page.waitForFunction(()=>fixture.actions.some(row=>row.name==='updateTaxSettings'));assert.equal(await app.page.evaluate(()=>fixture.actions.filter(row=>row.name==='updateTaxSettings').length),1);
    await app.page.evaluate(()=>window.switchAccount({schemaVersion:1,context:{scope:'scope-b',authenticated:false},display:{name:'',language:'en',role:'guest'}}));await app.page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await app.page.locator('input[name=password]').count(),0);
  }finally{await app.close()}
});

