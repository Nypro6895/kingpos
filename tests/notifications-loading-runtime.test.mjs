import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {chromium} from 'playwright-core';

const dir=path.resolve('artifacts/notifications-loading');
const require=createRequire(new URL('../package.json',import.meta.url));
let browser,server,origin;
const item=(n,title='Update '+n)=>({id:'app:'+String(n).padStart(8,'0')+'-0000-4000-8000-000000000000',title,body:'Notification body',createdAt:new Date(Date.UTC(2026,10,13,12,0,n)).toISOString(),kindLabel:'Update',meta:'Just now',source:'app',status:'unread',unread:true,action:{type:'open-app',notificationId:String(n).padStart(8,'0')+'-0000-4000-8000-000000000000',href:'/activity',workspaceId:null,label:'View'}});
test.before(async()=>{
  await fs.mkdir(dir,{recursive:true});
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{Activity}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{NotificationCenterClient,NotificationCenterLoading}from'./app/notifications/notification-center-client';
    import{ExperiencePageBoundary}from'./components/experience-page-boundary';
    import{experienceResourceCache as cache}from'./lib/experience-resource-cache';
    const query=new URLSearchParams(location.search),seeded=query.has('seed');
    const qa=window.qa={reads:[],writes:[],visible:true,key:0,scope:{context:{scope:'scope-a',authenticated:true},checkedAt:()=>Date.now(),validate:async()=>qa.answer,validationRevision:1},answer:true,refreshes:0};
    qa.props={initialPending:!seeded,initialItems:${JSON.stringify([item(10,'Server seed')])},initialCursor:null,initialScope:'scope-a',actionContent:<p>Private pending action</p>};
    if(!seeded)qa.props.initialItems=undefined;
    qa.router={refresh(){qa.refreshes++;}};
    if(query.has('noscope'))qa.scope=null;
    window.IntersectionObserver=class{observe(){}disconnect(){}unobserve(){}};
    window.fetch=(url,options={})=>{
      if(options.method==='POST'){qa.writes.push({url,body:JSON.parse(options.body)});return Promise.resolve(Response.json({ok:true}));}
      return new Promise(resolve=>qa.reads.push({url:String(url),signal:options.signal,resolve,scope:qa.scope?.context.scope}));
    };
    const root=createRoot(document.getElementById('root'));
    function App(){return <Activity mode={qa.visible?'visible':'hidden'}><ExperiencePageBoundary renderRevision='server-1'><NotificationCenterClient key={qa.key} {...qa.props}/></ExperiencePageBoundary></Activity>;}
    qa.render=()=>flushSync(()=>root.render(<App/>));qa.hide=()=>{qa.visible=false;qa.render()};qa.show=()=>{qa.visible=true;qa.render()};
    qa.reply=(index,items,cursor=null,status=200)=>qa.reads[index].resolve(Response.json(status===200?{items,cursor}:{error:'Denied fixture'},{status}));
    qa.cached=filter=>cache.get({scope:qa.scope.context.scope,key:'notifications?filter='+filter});
    qa.available=scope=>cache.isAvailable({scope,key:'notifications?filter=all'});
    qa.remount=()=>{qa.key++;qa.render()};qa.reset=()=>{window.dispatchEvent(new Event('reylumi:experience-reset'));};
    qa.switchScope=()=>{qa.scope={...qa.scope,context:{scope:'scope-b',authenticated:true}};qa.render()};
    qa.loading=()=>flushSync(()=>root.render(<NotificationCenterLoading/>));
    qa.render();qa.ready=true;
  `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'controlled-read-transport',setup(b){
    const mocks={
      'next/link':`import React from'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
      'next/navigation':`export const usePathname=()=>'/notifications';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>qa.router;`,
      '@/components/experience-scope':`export const useExperienceScope=()=>window.qa.scope;`,
      '@/components/salon-language-preferences':`export const LanguageNotifications=()=>null;`,
      '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`,
      '@/components/loading-feedback':`export const PageLoadingSkeleton=()=> <p data-global-loading>Validating access</p>;`,
    };
    b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:null);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:process.cwd()}));
    b.onLoad({filter:/\.[jt]sx?$/},async args=>{
      if(args.path.includes('node_modules'))return;const text=await fs.readFile(args.path,'utf8');if(!/^\s*["']use server["']/.test(text))return;
      return{loader:'js',contents:[...text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>'export const '+m[1]+'=()=>{throw Error("No server command in fixture")};').join('\n')};
    });
  }}]});
  const js=bundle.outputFiles[0].text;await fs.writeFile(path.join(dir,'fixture.js'),js);
  server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/fixture.js'?'text/javascript;charset=utf-8':'text/html;charset=utf-8');res.end(req.url==='/fixture.js'?js:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>[data-notification-id]{min-height:90px}body{margin:0}header{min-height:50px}</style><div id="root"></div><script src="/fixture.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
});
test.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function open(t,query=''){
  const page=await browser.newPage({viewport:{width:390,height:700}}),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.clock.install({time:new Date('2026-11-13T18:00:00Z')});await page.goto(origin+'/notifications'+query);await page.waitForFunction(()=>window.qa?.ready);
  await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();
  t.after(async()=>{assert.deepEqual(errors,[]);await page.close()});return page;
}
async function reply(page,index,items,cursor=null,status=200){await page.evaluate(data=>qa.reply(data.index,data.items,data.cursor,data.status),{index,items,cursor,status});}
const tab=(page,name)=>page.getByRole('button',{name,exact:true});

test('cold actual client shows working All/Unread header with one held GET and no invented empty seed',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);
  assert.equal(await page.getByText('No notifications yet.',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>qa.cached('all')),undefined);
  assert.equal(await tab(page,'Mark all viewed').isDisabled(),true);
  await page.locator('header').evaluate(el=>window.header=el);
  await tab(page,'Unread').click();await page.waitForFunction(()=>qa.reads.length===2);
  assert.match(await page.evaluate(()=>qa.reads[1].url),/filter=unread/);
  await reply(page,0,[item(1,'Old All response')]);assert.equal(await page.getByText('Old All response',{exact:true}).count(),0);
  await reply(page,1,[item(2,'Unread result')]);await page.getByText('Unread result',{exact:true}).waitFor();
  assert.equal(await page.locator('header').evaluate(el=>el===window.header),true);
  assert.equal(await page.evaluate(()=>qa.refreshes),0);
});

test('repeated active tab leaves its only pending read alive; fresh tab cache is reused for 15 seconds',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);await tab(page,'All').click();assert.equal(await page.evaluate(()=>qa.reads.length),1);
  await reply(page,0,[item(1)]);await page.getByText('Update 1',{exact:true}).waitFor();
  await tab(page,'Unread').click();await page.waitForFunction(()=>qa.reads.length===2);await reply(page,1,[item(2)]);await page.getByText('Update 2',{exact:true}).waitFor();
  await tab(page,'All').click();await page.getByText('Update 1',{exact:true}).waitFor();assert.equal(await page.getByText('Update 2',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>qa.reads.length),2);
  await page.evaluate(()=>qa.remount());await page.getByText('Update 1',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.reads.length),2);
  await page.clock.fastForward(15_001);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>qa.reads.length===3);
  assert.equal(await page.getByText('Update 1',{exact:true}).isVisible(),true);
});

test('legacy accepted server seed avoids immediate duplicate GET and reset cannot restore that seed/actions',async t=>{
  const page=await open(t,'?seed=1');await page.getByText('Server seed',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>qa.reads.length),0);
  await page.evaluate(()=>qa.reset());assert.equal(await page.getByText('Server seed',{exact:true}).count(),0);assert.equal(await page.getByText('Private pending action',{exact:true}).count(),0);
  await page.evaluate(()=>{qa.hide();qa.show()});await page.waitForFunction(()=>qa.reads.length===1);
  assert.equal(await page.getByText('Server seed',{exact:true}).count(),0);assert.equal(await page.getByText('Private pending action',{exact:true}).count(),0);
  await reply(page,0,[item(4,'Verified after reset')]);await page.getByText('Verified after reset',{exact:true}).waitFor();assert.equal(await page.getByText('Private pending action',{exact:true}).count(),0);
});

test('scope change rejects late old response and hides old private action slot before replacement',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);await page.evaluate(()=>qa.switchScope());await page.waitForFunction(()=>qa.reads.length===2);
  assert.equal(await page.getByText('Private pending action',{exact:true}).count(),0);
  await reply(page,0,[item(1,'Old account secret')]);assert.equal(await page.getByText('Old account secret',{exact:true}).count(),0);
  await reply(page,1,[item(2,'New account feed')]);await page.getByText('New account feed',{exact:true}).waitFor();assert.equal(await page.getByText('Private pending action',{exact:true}).count(),0);
});

test('authoritative read denial withdraws feed/actions; failed first read is never a false empty or fresh cache',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);await reply(page,0,[],null,503);await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('No notifications yet.',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>qa.cached('all')),undefined);
  await tab(page,'Retry').click();await page.waitForFunction(()=>qa.reads.length===2);await reply(page,1,[item(3)]);await page.getByText('Update 3',{exact:true}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('kingpos:notifications-refresh')));await page.waitForFunction(()=>qa.reads.length===3);await reply(page,2,[],null,403);
  await page.waitForFunction(()=>!document.body.textContent.includes('Update 3'));assert.equal(await page.getByText('Private pending action',{exact:true}).count(),0);
});

test('pagination cursor, retained older window and reading anchor survive background refresh',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);
  const cursor={at:item(11).createdAt,id:item(11).action.notificationId};
  await reply(page,0,[item(12),item(11)],cursor);await page.getByText('Update 12',{exact:true}).waitFor();
  await tab(page,'Load older notifications').click();await page.waitForFunction(()=>qa.reads.length===2);assert.match(await page.evaluate(()=>qa.reads[1].url),/before=/);assert.match(await page.evaluate(()=>qa.reads[1].url),/id=/);
  await reply(page,1,Array.from({length:10},(_,i)=>item(10-i)));await page.getByText('Update 1',{exact:true}).waitFor();
  await page.evaluate(()=>scrollTo(0,500));const before=await page.getByText('Update 8',{exact:true}).evaluate(el=>el.getBoundingClientRect().top);
  await page.evaluate(()=>window.dispatchEvent(new Event('kingpos:notifications-refresh')));await page.waitForFunction(()=>qa.reads.length===3);
  await reply(page,2,[item(13),item(12),item(11)],cursor);await page.getByText('Update 13',{exact:true}).waitFor();
  assert.equal(await page.getByText('Update 1',{exact:true}).count(),1);const after=await page.getByText('Update 8',{exact:true}).evaluate(el=>el.getBoundingClientRect().top);assert.ok(Math.abs(after-before)<3);
});

test('mark all viewed issues one POST and one refresh GET; individual viewed metadata patches Unread cache',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);await reply(page,0,[item(1)]);await page.getByText('Update 1',{exact:true}).waitFor();
  await tab(page,'Mark all viewed').click();await page.waitForFunction(()=>qa.reads.length===2);assert.equal(await page.evaluate(()=>qa.writes.length),1);assert.deepEqual(await page.evaluate(()=>qa.writes[0].body),{all:true});
  await reply(page,1,[{...item(1),unread:false,status:'read'}]);await tab(page,'Unread').click();await page.waitForFunction(()=>qa.reads.length===3);await reply(page,2,[item(2)]);await page.getByText('Update 2',{exact:true}).waitFor();
  await page.evaluate(id=>window.dispatchEvent(new CustomEvent('kingpos:notifications-viewed',{detail:[id]})),item(2).action.notificationId);
  await page.getByText('No notifications yet.',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>qa.cached('unread').data.items),[]);
});

test('neutral exported frame never reads, seeds, or permits a mark/filter command',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);await page.evaluate(()=>qa.loading());
  assert.equal(await tab(page,'All').isDisabled(),true);assert.equal(await tab(page,'Unread').isDisabled(),true);assert.equal(await tab(page,'Mark all viewed').isDisabled(),true);
  assert.equal(await page.evaluate(()=>qa.reads.length),1);assert.equal(await page.evaluate(()=>qa.writes.length),0);
});

test('missing authenticated scope admits no first read, private seed, action slot or write',async t=>{
  const page=await open(t,'?seed=1&noscope=1');
  assert.equal(await page.getByText('Server seed',{exact:true}).count(),0);assert.equal(await page.getByText('Private pending action',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>qa.reads.length),0);assert.equal(await page.evaluate(()=>qa.writes.length),0);
  assert.equal(await tab(page,'Mark all viewed').isDisabled(),true);assert.equal(await tab(page,'Unread').isDisabled(),true);
});

test('hosted route admits identity before the actual client, with an independent held summary and no SSR feed read',async()=>{
  const mocks={
    '@/components/experience-page':'export const withExperiencePage=Page=>Page;',
    '@/app/notifications/notification-center-client':'export function NotificationCenterClient(){return null;}',
    '@/app/notifications/notification-list':'export function NotificationFeedList(){return null;}',
    '@/components/workspace-language':'export const WorkspaceText=({text})=>text;',
    '@/lib/request-business-context':'export const getRequestBusinessContext=()=>globalThis.__notificationRoute.identity;',
    '@/lib/workspace-pending':'export function getWorkspacePendingSummary(){globalThis.__notificationRoute.summaryCalls++;return globalThis.__notificationRoute.summary;}',
    '@/lib/experience-context':'export const getExperienceContext=context=>({scope:context.scope});',
    '@/lib/notification-center':'export function loadNotificationPage(){throw Error("Duplicate SSR feed reader")}',
    'next/navigation':'export const redirect=href=>{throw Error("REDIRECT:"+href)};',
  };
  const result=await build({entryPoints:['app/(app)/notifications/page.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',plugins:[{name:'held-route-authority',setup(b){
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx'}));
  }}]});
  const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);
  let resolveIdentity,resolveSummary;globalThis.__notificationRoute={identity:new Promise(r=>resolveIdentity=r),summary:new Promise(r=>resolveSummary=r),summaryCalls:0};
  try{
    let ready=false;const pending=mod.exports.default({searchParams:Promise.resolve({filter:'unread'})}).then(value=>{ready=true;return value});
    await new Promise(r=>setImmediate(r));assert.equal(ready,false);assert.equal(globalThis.__notificationRoute.summaryCalls,0);
    resolveIdentity({user:{id:'actor'},scope:'scope-a'});const page=await pending;
    assert.equal(page.props.initialPending,true);assert.equal(page.props.initialFilter,'unread');assert.equal(page.props.initialScope,'scope-a');assert.equal(page.props.initialItems,undefined);
    const slot=page.props.actionContent.props.children;let actionsReady=false;const actions=slot.type(slot.props).then(value=>{actionsReady=true;return value});
    await new Promise(r=>setImmediate(r));assert.equal(actionsReady,false);assert.equal(globalThis.__notificationRoute.summaryCalls,1);
    resolveSummary({previewItems:[{...item(1),source:'staff'}]});assert.equal((await actions).type,'section');
    globalThis.__notificationRoute.identity=Promise.resolve({user:null});
    await assert.rejects(mod.exports.default({searchParams:Promise.resolve({})}),/REDIRECT:\/login\?next=\/notifications/);
    assert.equal(globalThis.__notificationRoute.summaryCalls,1);
    await fs.writeFile(path.join(dir,'read-lifecycle.json'),JSON.stringify({hosted:{identityBeforeClient:true,feedReader:'original authorized client GET after hydration; no server feed read',actionSummary:'independent server Suspense slot'},tradeoff:'The cold feed now begins after client hydration instead of an SSR feed read. These tests verify earlier interactive frame and read counts, not lower total feed latency.',native:'neutral frame only while original composite scoped reader runs; no duplicate GET',cacheFreshMs:15000},null,2));
  }finally{delete globalThis.__notificationRoute;}
});

test('viewed metadata while the first read is held cannot seed a fresh empty feed across filter changes',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kingpos:notifications-viewed',{detail:['external-shell-item']})));
  assert.equal(await page.evaluate(()=>qa.cached('all')),undefined,'pending rows are not an authoritative snapshot');
  await tab(page,'Unread').click();await page.waitForFunction(()=>qa.reads.length===2);await tab(page,'All').click();await page.waitForFunction(()=>qa.reads.length===3);
  assert.equal(await page.getByText('No notifications yet.',{exact:true}).count(),0);
  await reply(page,2,[item(5,'Actual All result')]);await page.getByText('Actual All result',{exact:true}).waitFor();
});

test('a denied scope stays revoked; a separately admitted new source recovers without reopening the old cache',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);await reply(page,0,[],null,409);
  await page.waitForFunction(()=>!qa.available('scope-a'));assert.equal(await page.getByText('Private pending action',{exact:true}).count(),0);
  await page.evaluate(items=>{
    qa.scope={...qa.scope,context:{scope:'scope-b',authenticated:true}};
    qa.props={initialPending:false,initialItems:items,initialCursor:null,initialScope:'scope-b',actionContent:'New accepted action'};
    qa.key++;qa.render();
  },[item(9,'Accepted new source')]);
  await page.getByText('Accepted new source',{exact:true}).waitFor();
  assert.match(await page.locator('#root').innerText(),/New accepted action/);
  assert.equal(await page.evaluate(()=>qa.available('scope-a')),false);assert.equal(await page.evaluate(()=>qa.available('scope-b')),true);
  assert.equal(await page.evaluate(()=>qa.reads.length),1,'a settled new seed must not start an immediate duplicate read');
});

test('polling pauses while Activity is hidden and reveal preserves the actual header while refreshing live data',async t=>{
  const page=await open(t);await page.waitForFunction(()=>qa.reads.length===1);await reply(page,0,[item(1)]);await page.getByText('Update 1',{exact:true}).waitFor();
  await page.locator('header').evaluate(el=>window.header=el);await page.clock.fastForward(30_000);await page.waitForFunction(()=>qa.reads.length===2);
  await reply(page,1,[item(2)]);await page.getByText('Update 2',{exact:true}).waitFor();await page.evaluate(()=>qa.hide());
  await page.clock.fastForward(60_000);assert.equal(await page.evaluate(()=>qa.reads.length),2);
  await page.evaluate(()=>qa.show());await page.waitForFunction(()=>qa.reads.length===3);
  assert.equal(await page.locator('header').evaluate(el=>el===window.header),true);assert.equal(await page.evaluate(()=>qa.refreshes),0);
  assert.equal(await page.getByText('Update 2',{exact:true}).isVisible(),true);
});
