import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

// Actual registries and scoped read/cache engine with held native transport.
// Small view adapters observe the integration contract; companion loading
// tests exercise the actual views. This is not native-device acceptance.
const root = process.cwd();
const registry = path.resolve('lib/app-local-page-registry.tsx').replaceAll('\\', '/');
const personalRegistry = path.resolve('lib/app-local-personal-registry.tsx').replaceAll('\\', '/');
function importedNames(source, request) {
  const escaped = request.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('import\\s+([\\s\\S]*?)\\s+from\\s+["\\\']' + escaped + '["\\\']', 'g');
  const names = new Set(); let match;
  while ((match = pattern.exec(source))) {
    const braces = match[1].split(';').at(-1).match(/\{([\s\S]*?)\}/);
    if (braces) for (const value of braces[1].split(',')) {
      const name = value.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}
const mocks = {
  'next/image': `import React from'react';export default p=><img {...p}/>;`,
  'next/link': `import React from'react';export default function Link(props){return <a {...props}/>;}`,
  '@/components/workspace-language': `export const WorkspaceText=({text})=>text;`,
  '@/components/experience-scope': `export const useExperienceScope=()=>({context:window.qa.context?.context});`,
  'fixture-host': `export const getAppLocalHost=()=>window.qa.host;`,
  'fixture-persistence': `export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>undefined;export const writeExperienceSnapshot=async()=>{throw Error('Unexpected persistence write')};export const removeExperienceSnapshot=async()=>{};`,
};
const keep = new Set(['./app-local-resource']);
const fixture = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{getAppLocalPage}from'./lib/app-local-page-registry';import{getAppLocalPersonalPage}from'./lib/app-local-personal-registry';
    import{resetAppLocalResources,appLocalResourceCache}from'./lib/app-local-resource';
    const qa=window.qa={reads:[],pending:[],cacheCalls:[],commands:[]};
    qa.host={isNative:true,read(name,args,options){qa.reads.push({name,args,scope:options.scope});return new Promise((resolve,reject)=>qa.pending.push({name,args,scope:options.scope,resolve,reject}));},cache:async(name,args)=>{qa.cacheCalls.push({name,args});return undefined;},command:async(...args)=>{qa.commands.push(args);throw Error('Unexpected command')},openOnline:async()=>{}};
    const root=createRoot(document.getElementById('root'));

    function App(){const descriptor=getAppLocalPage(qa.path)||getAppLocalPersonalPage(qa.path);return <descriptor.Component path={qa.path} context={qa.context} navigate={()=>{}}/>;}
    qa.render=()=>flushSync(()=>root.render(<App/>));
    qa.scope=index=>'v3:'+String(index).repeat(64);
    qa.start=(path,role='owner',index=1)=>{qa.path=path;qa.context={schemaVersion:1,context:{scope:qa.scope(index),viewerId:'viewer-'+index,salonId:role==='personal'?null:'salon-'+index,workspaceId:role==='personal'?'personal':'salon:'+index,permissionRevision:'test',authenticated:true},access:{ownerWorkspace:role==='owner',staffWorkspace:role==='staff'},display:{name:'Test account'},onlineValidatedAt:Date.now(),offline:false};qa.render();};
    qa.finish=(index,data)=>{const p=qa.pending[index];p.resolve({schemaVersion:1,status:200,scope:p.scope,etag:'"test"',updatedAt:Date.now(),data});};
    qa.fail=(index,status)=>qa.pending[index].reject(Object.assign(new Error('Held read failed'),status?{status}:{}));
    qa.reset=()=>resetAppLocalResources();
    qa.snapshot=index=>appLocalResourceCache.get({scope:qa.scope(index),key:'app-local:'+JSON.stringify([qa.path==='/services'?'page.services':qa.path.startsWith('/notifications')?'page.notifications':'page.my-place',qa.path.startsWith('/notifications')?{filter:'unread'}:{}])})?.data;
    qa.suspend=()=>appLocalResourceCache.suspend();
    qa.withdraw=()=>{qa.context=null;qa.render();};
    qa.ready=true;
  ` },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'held-wave2-native-transport', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'mock' };
      if (/(?:^|\/)app-local-host$/.test(args.path)) return { path: 'fixture-host', namespace: 'mock' };
      if (/(?:^|\/)experience-persistent-cache$/.test(args.path)) return { path: 'fixture-persistence', namespace: 'mock' };
      if (![registry,personalRegistry].includes(args.importer.replaceAll('\\', '/')) || keep.has(args.path) || !args.path.startsWith('.') && !args.path.startsWith('@/')) return;
      if (args.path==='@/app/services/services-manager') return {path:args.path,namespace:'mock-views',pluginData:{contents:"import React from'react';export function ServicesManager(p){return <main><h1>Services</h1><input aria-label='Search services' disabled={p.pending}/>{p.data?<p>{p.data.label}</p>:p.error?<div role='alert'>{p.error}<button onClick={p.onRetry}>Retry</button></div>:<p role='status'>Loading services…</p>}</main>;}"}};
      if (args.path==='@/app/my-place/my-place-client') return {path:args.path,namespace:'mock-views',pluginData:{contents:"import React from'react';export const MyPlaceClient=p=><p>{p.label}</p>;export const MyPlaceLoading=p=><main><h1>My Place</h1>{p.error?<div role='alert'>{p.error}<button onClick={p.onRetry}>Retry</button></div>:<p role='status'>Loading your places…</p>}</main>;"}};
      if (args.path==='@/app/notifications/notification-center-client') return {path:args.path,namespace:'mock-views',pluginData:{contents:"import React from'react';export const NotificationCenterClient=p=><p>{p.label}</p>;export const NotificationCenterLoading=p=><main><h1>Notifications</h1><button aria-pressed={p.initialFilter==='unread'} disabled>Unread</button>{p.error?<div role='alert'>{p.error}<button onClick={p.onRetry}>Retry</button></div>:<p role='status'>Loading notifications…</p>}</main>;"}};
      const names = importedNames(readFileSync(args.importer, 'utf8'), args.path);
      return { path: args.path, namespace: 'unrelated-view', pluginData: { contents: names.map(name => 'export const ' + name + '=()=>null;').join('\n') } };
    });
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    b.onLoad({filter:/.*/,namespace:'mock-views'},args=>({contents:args.pluginData.contents,loader:'tsx',resolveDir:root}));
    b.onLoad({ filter: /.*/, namespace: 'unrelated-view' }, args => ({ contents: args.pluginData.contents, loader: 'tsx', resolveDir: root }));
  } }],
});
const js = fixture.outputFiles[0].text;
let browser, server, origin;
test.before(async () => {
  const executablePath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
  assert(executablePath);
  browser = await chromium.launch({ executablePath, headless: true });
  server = createServer((req, res) => {
    const script = req.url === '/fixture.js'; res.setHeader('Content-Type', script ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(script ? js : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function open() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/more'); try { await page.waitForFunction(() => window.qa?.ready); } catch { throw Error('Fixture initialization failed: '+errors.join('; ')); }
  return { page, errors };
}

for(const [path,name,title] of [['/services','page.services','Services'],['/my-place','page.my-place','My Place'],['/notifications?filter=unread','page.notifications','Notifications']]) {
 test(title+' native registry keeps a neutral frame with one existing authoritative read, then admits data',async()=>{
  const{page,errors}=await open();try{await page.evaluate(path=>qa.start(path),path);await page.getByRole('heading',{name:title,exact:true}).waitFor();await page.waitForFunction(()=>qa.reads.length===1);
  assert.equal(await page.evaluate(()=>qa.reads[0].name),name);assert.equal(await page.evaluate(()=>qa.commands.length),0);if(name==='page.notifications')assert.equal(await page.getByRole('button',{name:'Unread',exact:true}).getAttribute('aria-pressed'),'true');
  if(name==='page.services')await page.evaluate(()=>window.retained=document.querySelector('input'));
  await page.evaluate(name=>qa.finish(0,name==='page.services'?{data:{label:'Accepted private content'}}:{label:'Accepted private content'}),name);await page.getByText('Accepted private content',{exact:true}).waitFor();
  if(name==='page.services')assert.equal(await page.evaluate(()=>window.retained===document.querySelector('input')&&window.retained.isConnected),true);
  assert.equal(await page.evaluate(()=>qa.reads.length),1);assert.deepEqual(errors,[]);
  }finally{await page.close();}
 });
 test(title+' native registry rejects old scope data after reset and shows denial/retry',async()=>{
 const{page,errors}=await open();try{await page.evaluate(path=>qa.start(path),path);await page.waitForFunction(()=>qa.reads.length===1);await page.evaluate(path=>{qa.reset();qa.start(path,'personal',2);},path);await page.waitForFunction(()=>qa.reads.length===2);
 await page.evaluate(name=>qa.finish(0,name==='page.services'?{data:{label:'Old private content'}}:{label:'Old private content'}),name);await page.evaluate(()=>qa.fail(1,403));await page.getByRole('alert').waitFor();assert.equal(await page.getByText('Old private content',{exact:true}).count(),0);await page.getByRole('button',{name:'Retry',exact:true}).click();await page.waitForFunction(()=>qa.reads.length===3);assert.deepEqual(errors,[]);
 }finally{await page.close();}
 });
}
