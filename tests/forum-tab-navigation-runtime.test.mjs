import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

// Exercise the real page boundary, policies, Forum and React Activity together.
// Only navigation/context/action transports and unrelated advertising are mocked.
// Native History changes update the Next hooks, as they do in the actual app.
const artifacts = path.resolve('artifacts/forum-tab-navigation-runtime');
const browserPath = [process.env.TEST_BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
let browser, server, origin;

test.before(async () => {
  assert(browserPath, 'A local Chrome/Edge executable is required; set TEST_BROWSER_PATH.');
  await fs.mkdir(artifacts, {recursive:true});
  const result = await build({
    stdin:{resolveDir:process.cwd(), loader:'tsx', contents:`
      import React,{Activity,useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {ExperiencePageBoundary} from './components/experience-page-boundary';
      import Forum from './app/(app)/forum/forum';
      const section={id:'30000000-0000-4000-8000-000000000001',name:'Vận hành tiệm',description:'',position:0,archived:false};
      const topic=(n,title,author='other')=>({id:'30000000-0000-4000-8000-'+String(n).padStart(12,'0'),title,body:'Fixture discussion',author_id:author,author_name:author,author_avatar:null,section_id:section.id,created_at:'2026-11-12T12:00:00Z',updated_at:'2026-11-12T12:00:00Z',reply_count:0,following:false,bookmarked:false,pinned:false,locked:false,deleted_at:null});
      const qa=window.qa={visible:true,revision:'server-1',viewer:'owner-a',checked:Date.now(),validationRevision:1,validateCalls:0,deferred:false,requests:[],reads:[],writes:[],pending:[],navListeners:new Set(),blocked:false};
      qa.latest=[topic(2,'Latest record A'),topic(3,'Blocked author record','blocked-author')];
      qa.following=[topic(4,'Following record A'),topic(5,'Blocked following record','blocked-author')];
      qa.chat=[{id:'101',body:'Current chat record A',author_id:'other',author_name:'Other',created_at:'2026-11-12T12:00:00Z'}];
      qa.blockedChat=[{id:'102',body:'Blocked chat record',author_id:'blocked-author',author_name:'Blocked',created_at:'2026-11-12T12:00:00Z'}];
      const contexts=new Map();
      qa.context=()=>{if(!contexts.has(qa.viewer))contexts.set(qa.viewer,{user_id:qa.viewer,display_name:qa.viewer,can_moderate:false,can_manage:false,restriction:null,sections:[section]});return contexts.get(qa.viewer);};
      const notify=()=>qa.navListeners.forEach(fn=>fn());
      for(const name of ['pushState','replaceState']){const native=history[name].bind(history);history[name]=(...args)=>{native(...args);notify();};}
      addEventListener('popstate',notify);
      qa.subscribe=fn=>{qa.navListeners.add(fn);return()=>qa.navListeners.delete(fn);};
      qa.location=()=>location.pathname+location.search;
      qa.useLocation=()=>useSyncExternalStore(qa.subscribe,qa.location,qa.location);
      qa.router={refresh(){qa.requests.push({href:qa.location(),at:Date.now()});}};
      qa.validate=()=>{qa.validateCalls++;return qa.deferred?new Promise(resolve=>qa.resolveValidation=resolve):Promise.resolve(true);};
      qa.checkedAt=()=>qa.checked;
      qa.getValidationRevision=()=>qa.validationRevision;
      qa.scope=()=>({context:{scope:qa.viewer,authenticated:true},validationRevision:qa.validationRevision,validate:qa.validate,checkedAt:qa.checkedAt,getValidationRevision:qa.getValidationRevision});
      qa.read=input=>{const id=qa.reads.length+1;qa.reads.push({id,input:{...input}});return new Promise(resolve=>qa.pending.push({id,input:{...input},resolve,done:false}));};
      qa.reply=(id,response)=>{const p=qa.pending.find(p=>p.id===id&&!p.done);if(!p)throw Error('Missing pending read '+id);p.done=true;p.resolve(response);};
      qa.replyNext=(mode,data)=>{const p=qa.pending.find(p=>p.input.mode===mode&&!p.done);if(!p)throw Error('Missing pending mode '+mode);qa.reply(p.id,{data});};
      qa.write=async input=>{qa.writes.push(input);if(input.op==='seen'&&qa.deferSeen)return new Promise(resolve=>qa.resolveSeen=resolve);return qa.writeError?{error:qa.writeError}:{data:{ok:true}};};
      const root=createRoot(document.getElementById('root'));
      function Harness(){return <Activity mode={qa.visible?'visible':'hidden'}><ExperiencePageBoundary renderRevision={qa.revision}><Forum initialContext={qa.context()} initialTopics={qa.viewer==='owner-a'?qa.latest:[topic(6,'Latest record B')]}/></ExperiencePageBoundary></Activity>;}
      qa.render=()=>flushSync(()=>root.render(<Harness/>));
      qa.hide=()=>{qa.visible=false;qa.render();};qa.show=()=>{qa.visible=true;qa.render();};
      qa.acknowledge=()=>{qa.revision+='-acknowledged';qa.render();};
      qa.resolve=answer=>{if(answer){qa.checked=Date.now();qa.validationRevision++;qa.render();}const resolve=qa.resolveValidation;qa.resolveValidation=null;resolve(answer);};
      qa.changeViewer=viewer=>{qa.viewer=viewer;qa.checked=Date.now();qa.validationRevision++;qa.revision+='-new-viewer';qa.render();};
      qa.interruptContextUpdate=()=>{
        const schedule=window.queueMicrotask.bind(window),held=[];
        window.queueMicrotask=callback=>held.push(callback);
        try{contexts.set(qa.viewer,{...qa.context(),display_name:'Revised owner A'});qa.render();qa.hide();}
        finally{window.queueMicrotask=schedule;qa.heldContextTasks=held.length;held.forEach(callback=>schedule(callback));}
      };
      qa.render();qa.ready=true;
    `},
    outdir:artifacts, bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'forum-runtime-transports',setup(b){
      const mocks = {
        'next/navigation':`export const usePathname=()=>window.qa.useLocation().split('?')[0];export const useSearchParams=()=>new URLSearchParams(window.qa.useLocation().split('?')[1]||'');export const useRouter=()=>window.qa.router;`,
        'next/link':`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>;}`,
        'next/image':`import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}`,
        '@/components/experience-scope':`export const useExperienceScope=()=>window.qa.scope();`,
        '@/components/loading-feedback':`export const PageLoadingSkeleton=()=> <p role="status" data-global-loading>Getting things ready…</p>;`,
        '@/components/explore-advertising':`export const ForumCampaignSlot=()=>null;`,
        '@/components/workspace-language':`export const WorkspaceText=({text})=>text;`,
        './workspace-language':`export const WorkspaceText=({text})=>text;`,
        './post-safety':`export const notifyUserBlocksChanged=()=>window.dispatchEvent(new Event('reylumi:user-blocks-changed'));`,
        '@/app/post-moderation/block-actions':`export const setUserBlocked=async()=>({error:null});`,
      };
      b.onResolve({filter:/.*/},args=>{
        if(Object.hasOwn(mocks,args.path))return {path:args.path,namespace:'fixture'};
        if(args.path==='./actions'&&/[/\\]forum[/\\]/.test(args.importer))return {path:'forum-actions',namespace:'fixture'};
        return null;
      });
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:args.path==='forum-actions'?`export const readForum=input=>window.qa.read(input);export const writeForum=input=>window.qa.write(input);`:mocks[args.path]}));
    }}],
  });
  const javascript=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const css=result.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
  await fs.writeFile(path.join(artifacts,'fixture.js'),javascript);
  await fs.writeFile(path.join(artifacts,'fixture.css'),css);
  server=createServer((req,res)=>{
    const pathname=new URL(req.url,'http://fixture.invalid').pathname;
    res.setHeader('Content-Type',pathname==='/fixture.js'?'text/javascript':pathname==='/fixture.css'?'text/css':'text/html');
    res.end(pathname==='/fixture.js'?javascript:pathname==='/fixture.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}*{box-sizing:border-box}</style><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:browserPath,headless:true});
});

test.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});

const nav=page=>page.getByRole('navigation',{name:'Chuyên mục diễn đàn'});
const tab=(page,name)=>nav(page).getByRole('button',{name,exact:true});
const topic=(page,name)=>page.getByRole('button',{name,exact:true});
async function pageFor(t,href='/forum'){
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(5_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.stack));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.clock.install({time:new Date('2026-11-12T18:00:00Z')});
  await page.goto(origin+href);
  if(href==='/forum')await topic(page,'Latest record A').waitFor();
  else await nav(page).waitFor();
  await page.evaluate(()=>{qa.header=document.querySelector('[aria-label="Forum header"]');qa.tabs=document.querySelector('[aria-label="Chuyên mục diễn đàn"]');});
  t.after(async()=>{assert.deepEqual(errors,[],'The real Forum and boundary must not throw');await page.close();});
  return page;
}
async function flush(page){await page.evaluate(()=>new Promise(resolve=>queueMicrotask(resolve)));}
async function assertChrome(page){
  assert.equal(await page.locator('header[aria-label="Forum header"]').isVisible(),true,'Forum header remains visible during a held read');
  assert.equal(await nav(page).isVisible(),true,'Tabs remain usable during a held read');
  assert.equal(await page.locator('[data-global-loading]').count(),0,'Local tabs cannot trigger the whole-page loading boundary');
  assert.equal(await page.evaluate(()=>qa.header===document.querySelector('[aria-label="Forum header"]')&&qa.tabs===document.querySelector('[aria-label="Chuyên mục diễn đàn"]')&&qa.header.isConnected),true,'Header and tab DOM nodes retain their identity');
  assert.equal(await page.evaluate(()=>qa.requests.length),0,'Local tab navigation must not issue router.refresh');
}
async function pending(page,mode){await page.waitForFunction(mode=>qa.pending.some(p=>p.input.mode===mode&&!p.done),mode);return page.evaluate(mode=>qa.pending.filter(p=>p.input.mode===mode&&!p.done).at(-1).id,mode);}
async function resolve(page,id,kind){await page.evaluate(({id,kind})=>qa.reply(id,{data:qa[kind]}),{id,kind});await flush(page);}
async function acknowledgeAction(page){
  await page.locator('[data-global-loading]').waitFor({state:'visible'});
  await page.evaluate(()=>qa.acknowledge());await flush(page);
  await page.getByLabel('Title',{exact:true}).waitFor({state:'visible'});
}

test('held cold Following and Chat reads keep the same header/tabs and never display another tab payload',async t=>{
  const page=await pageFor(t);
  await tab(page,'Following').click();await flush(page);await assertChrome(page);
  const following=await pending(page,'following');
  assert.equal(await topic(page,'Latest record A').count(),0,'Cold Following cannot display Latest records');
  await resolve(page,following,'following');await topic(page,'Following record A').waitFor();
  await tab(page,'Chat').click();await flush(page);await assertChrome(page);
  const chat=await pending(page,'chat');
  assert.equal(await topic(page,'Following record A').count(),0);
  await page.screenshot({path:path.join(artifacts,'cold-chat-header-visible.png')});
  await resolve(page,chat,'chat');await page.getByText('Current chat record A',{exact:true}).waitFor();
  await assertChrome(page);
});

for (const scenario of [{name:'Following',mode:'following',payload:'following',record:'Following record A'},
  {name:'Chat',mode:'chat',payload:'chat',record:'Current chat record A'}]) {
  test(`clicking an already active cold ${scenario.name} tab cannot cancel its only pending read`,async t=>{
    const page=await pageFor(t);
    await tab(page,scenario.name).click();const read=await pending(page,scenario.mode);
    await tab(page,scenario.name).click();await flush(page);await assertChrome(page);
    assert.equal(await page.evaluate(mode=>qa.reads.filter(r=>r.input.mode===mode).length,scenario.mode),1,'Selecting the active tab must not restart the transport');
    await resolve(page,read,scenario.payload);
    if(scenario.mode==='chat')await page.getByText(scenario.record,{exact:true}).waitFor();
    else await topic(page,scenario.record).waitFor();
    assert.equal(await page.getByRole('status').filter({hasText:/^Loading…$/}).count(),0,'The accepted response must end content loading');
    await assertChrome(page);
  });
}

test('normalizing query order on an already active Following tab preserves its pending read',async t=>{
  const page=await pageFor(t,'/forum?view=following&tracking=1');
  const read=await pending(page,'following');
  await tab(page,'Following').click();await flush(page);await assertChrome(page);
  assert.equal(new URL(page.url()).searchParams.get('tracking'),'1','Unrelated query state remains intact');
  assert.equal(new URL(page.url()).searchParams.get('view'),'following');
  assert.equal(await page.evaluate(()=>qa.reads.filter(r=>r.input.mode==='following').length),1,'URL normalization must not restart or invalidate the active read');
  await resolve(page,read,'following');await topic(page,'Following record A').waitFor();
  assert.equal(await page.getByRole('status').filter({hasText:/^Loading…$/}).count(),0);
  await assertChrome(page);
});

test('accepted Latest and Following lists reuse their own fresh 30-second snapshots',async t=>{
  const page=await pageFor(t);
  await tab(page,'Following').click();await resolve(page,await pending(page,'following'),'following');await topic(page,'Following record A').waitFor();
  const calls=await page.evaluate(()=>qa.reads.length);
  await tab(page,'Mới nhất').click();await flush(page);await topic(page,'Latest record A').waitFor();
  assert.equal(await topic(page,'Following record A').count(),0);
  await tab(page,'Following').click();await flush(page);await topic(page,'Following record A').waitFor();
  assert.equal(await topic(page,'Latest record A').count(),0);
  assert.equal(await page.evaluate(()=>qa.reads.length),calls,'A warm list does not restart its reader');
  await page.clock.fastForward(29_000);
  await tab(page,'Mới nhất').click();await flush(page);await topic(page,'Latest record A').waitFor();
  await tab(page,'Following').click();await flush(page);await topic(page,'Following record A').waitFor();
  assert.equal(await page.evaluate(()=>qa.reads.length),calls,'The snapshot remains fresh before 30 seconds');
  await assertChrome(page);
});

test('a confirmed seen write updates unread metadata in cached Following without reloading its list',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{qa.following[0].unread_replies=3;qa.deferSeen=true;});
  await tab(page,'Following').click();await resolve(page,await pending(page,'following'),'following');
  await page.getByText('3 trả lời mới',{exact:true}).waitFor();
  await topic(page,'Following record A').click();const detail=await pending(page,'topic');
  await page.evaluate(id=>qa.reply(id,{data:{topic:qa.following[0],replies:[]}}),detail);
  await page.waitForFunction(()=>typeof qa.resolveSeen==='function');
  await page.evaluate(()=>qa.resolveSeen({data:{ok:true}}));await flush(page);
  await tab(page,'Following').click();await topic(page,'Following record A').waitFor();
  assert.equal(await page.getByText('3 trả lời mới',{exact:true}).count(),0,'An acknowledged seen operation must reconcile cached unread badges');
  assert.equal(await page.evaluate(()=>qa.reads.filter(r=>r.input.mode==='following').length),1,'Metadata reconciliation must preserve the warm list');
  await assertChrome(page);
});

test('expired list snapshots start a scoped read while retaining the same chrome',async t=>{
  const page=await pageFor(t);
  await tab(page,'Following').click();await resolve(page,await pending(page,'following'),'following');await topic(page,'Following record A').waitFor();
  await page.clock.fastForward(30_001);
  await tab(page,'Mới nhất').click();const feed=await pending(page,'feed');await assertChrome(page);
  await resolve(page,feed,'latest');await topic(page,'Latest record A').waitFor();
  await tab(page,'Following').click();const following=await pending(page,'following');await assertChrome(page);
  await page.evaluate(id=>qa.reply(id,{data:[{...qa.following[0],title:'Following refreshed record'}]}),following);
  await topic(page,'Following refreshed record').waitFor();
  assert.equal(await topic(page,'Latest record A').count(),0);
});

test('History Back/Forward preserves the compose draft through the existing action refresh boundary',async t=>{
  const page=await pageFor(t);
  await tab(page,'Tạo bài viết').click();await acknowledgeAction(page);await page.getByLabel('Title',{exact:true}).fill('Owner A unsaved draft');
  await page.getByLabel('Content',{exact:true}).fill('Private draft text for owner A');
  await page.getByRole('button',{name:'Back',exact:true}).click();await topic(page,'Latest record A').waitFor();
  await page.goBack();await acknowledgeAction(page);
  assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Owner A unsaved draft');
  await page.goForward();await topic(page,'Latest record A').waitFor();
  await tab(page,'Tạo bài viết').click();await acknowledgeAction(page);
  assert.equal(await page.getByPlaceholder('Your experience could help another salon owner…').inputValue(),'Private draft text for owner A');
  assert.equal(await page.evaluate(()=>qa.requests.length),3,'Only explicit compose entries use the preserved action boundary');
});

test('late Following responses cannot overwrite the selected Chat payload',async t=>{
  const page=await pageFor(t);
  await tab(page,'Following').click();const following=await pending(page,'following');
  await tab(page,'Chat').click();const chat=await pending(page,'chat');await assertChrome(page);
  await resolve(page,chat,'chat');await page.getByText('Current chat record A',{exact:true}).waitFor();
  await resolve(page,following,'following');
  assert.equal(await tab(page,'Chat').getAttribute('aria-current'),'page');
  assert.equal(await topic(page,'Following record A').count(),0);
  assert.equal(await page.getByText('Current chat record A',{exact:true}).isVisible(),true);
  await assertChrome(page);
});

test('privacy invalidation discards warm lists and rejects delayed pre-block Chat responses',async t=>{
  const page=await pageFor(t);
  await tab(page,'Following').click();await resolve(page,await pending(page,'following'),'following');await topic(page,'Blocked following record').waitFor();
  await tab(page,'Chat').click();const beforeBlock=await pending(page,'chat');
  await page.evaluate(()=>{qa.blocked=true;window.dispatchEvent(new Event('reylumi:user-blocks-changed'));});
  await page.waitForFunction(id=>qa.pending.some(p=>p.input.mode==='chat'&&!p.done&&p.id!==id),beforeBlock);
  const afterBlock=await pending(page,'chat');
  await resolve(page,beforeBlock,'blockedChat');
  assert.equal(await page.getByText('Blocked chat record',{exact:true}).count(),0,'Pre-block response cannot restore hidden content');
  await resolve(page,afterBlock,'chat');await page.getByText('Current chat record A',{exact:true}).waitFor();
  await tab(page,'Following').click();await flush(page);
  assert.equal(await topic(page,'Blocked following record').count(),0,'Warm Following cache is invalidated by privacy changes');
  const following=await pending(page,'following');await page.evaluate(id=>qa.reply(id,{data:[]}),following);await flush(page);
  await tab(page,'Mới nhất').click();await flush(page);
  assert.equal(await topic(page,'Blocked author record').count(),0,'Initial feed cache is invalidated as well');
  await pending(page,'feed');await assertChrome(page);
});

test('a privacy change while Activity is hidden invalidates its warm list before reveal',async t=>{
  const page=await pageFor(t);
  await tab(page,'Following').click();await resolve(page,await pending(page,'following'),'following');await topic(page,'Blocked following record').waitFor();
  await page.evaluate(()=>{
    qa.hide();qa.blocked=true;
    localStorage.setItem('reylumi:block-change','changed-while-forum-hidden');
    window.dispatchEvent(new Event('reylumi:user-blocks-changed'));
  });
  await page.evaluate(()=>qa.show());await flush(page);
  assert.equal(await topic(page,'Blocked following record').count(),0,'A hidden page must observe the persisted privacy marker before reusing its snapshot');
  const read=await pending(page,'following');
  assert.equal(await page.evaluate(()=>qa.reads.filter(r=>r.input.mode==='following').length),2,'Reveal starts exactly one new read after the original accepted snapshot');
  await page.evaluate(id=>qa.reply(id,{data:[qa.following[0]]}),read);
  await topic(page,'Following record A').waitFor();await assertChrome(page);
});

test('unavailable privacy-marker storage conservatively rereads a retained list on reveal',async t=>{
  const page=await pageFor(t);
  await tab(page,'Following').click();await resolve(page,await pending(page,'following'),'following');await topic(page,'Blocked following record').waitFor();
  await page.evaluate(()=>{
    qa.hide();
    const original=Storage.prototype.getItem;
    Storage.prototype.getItem=function(key){if(key==='reylumi:block-change')throw new DOMException('Storage is unavailable','SecurityError');return original.call(this,key);};
  });
  await page.evaluate(()=>qa.show());await flush(page);
  assert.equal(await topic(page,'Blocked following record').count(),0,'An unreadable marker cannot authorize reuse of an old privacy snapshot');
  const read=await pending(page,'following');
  assert.equal(await page.evaluate(()=>qa.reads.filter(r=>r.input.mode==='following').length),2);
  await page.evaluate(id=>qa.reply(id,{data:[qa.following[0]]}),read);
  await topic(page,'Following record A').waitFor();await assertChrome(page);
});

test('a failed authorized read clears accepted payloads and cannot reuse an old list snapshot',async t=>{
  const page=await pageFor(t);
  await tab(page,'Following').click();await resolve(page,await pending(page,'following'),'following');await topic(page,'Following record A').waitFor();
  await tab(page,'Chat').click();const chat=await pending(page,'chat');
  await page.evaluate(id=>qa.reply(id,{error:'Forum access changed. Verify your account.'}),chat);
  await page.getByRole('alert').filter({hasText:'Forum access changed.'}).waitFor();
  assert.equal(await page.getByText('Current chat record A',{exact:true}).count(),0);
  await tab(page,'Following').click();await flush(page);
  assert.equal(await topic(page,'Following record A').count(),0,'An error cannot leave a previously authorized cache available');
  await pending(page,'following');await assertChrome(page);
});

test('Retry loading after a failed write forces a named read even while the current list is fresh',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{qa.writeError='The bookmark could not be saved.';});
  await page.getByLabel('Content actions').first().click();
  await page.getByRole('button',{name:'Lưu bài viết',exact:true}).first().click();
  await page.getByRole('alert').filter({hasText:'The bookmark could not be saved.'}).waitFor();
  assert.equal(await page.evaluate(()=>qa.reads.length),0,'A failed write leaves the existing fresh list available');
  assert.equal(await topic(page,'Latest record A').isVisible(),true);
  await page.getByRole('button',{name:'Retry loading',exact:true}).click();
  const retry=await pending(page,'feed');await assertChrome(page);
  await page.evaluate(id=>qa.reply(id,{data:[{...qa.latest[0],title:'Latest record after retry'}]}),retry);
  await topic(page,'Latest record after retry').waitFor();
  assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(await page.evaluate(()=>qa.writes.length),1,'Retry loading refreshes data without repeating the failed write');
});

test('a same-scope server context update interrupted by Activity hiding is adopted on reveal',async t=>{
  const page=await pageFor(t);
  await page.getByText('owner-a',{exact:true}).waitFor({state:'attached'});
  await page.evaluate(()=>qa.interruptContextUpdate());await flush(page);
  assert.ok(await page.evaluate(()=>qa.heldContextTasks)>0,'The update must actually be held before its queued reconciliation runs');
  assert.equal(await page.locator('section[aria-label="Owner forum"]').isVisible(),false);
  await page.evaluate(()=>qa.show());
  await page.getByText('Revised owner A',{exact:true}).waitFor({state:'attached'});
  assert.equal(await page.getByText('owner-a',{exact:true}).count(),0,'A cancelled reconciliation cannot permanently mark old context as updated');
  await pending(page,'feed');await assertChrome(page);
});

test('Chat polling stays bounded while a request is pending and stops off-tab or while Activity is hidden',async t=>{
  const page=await pageFor(t);
  await tab(page,'Chat').click();await resolve(page,await pending(page,'chat'),'chat');
  await page.clock.fastForward(12_001);const poll=await pending(page,'chat');
  assert.equal(await page.evaluate(()=>qa.reads.filter(r=>r.input.mode==='chat').length),2);
  await page.clock.fastForward(36_000);
  assert.equal(await page.evaluate(()=>qa.reads.filter(r=>r.input.mode==='chat').length),2,'A held poll cannot start another request every interval');
  await tab(page,'Mới nhất').click();await flush(page);
  await page.clock.fastForward(24_001);
  assert.equal(await page.evaluate(()=>qa.reads.filter(r=>r.input.mode==='chat').length),2,'Inactive Chat cannot continue polling');
  await resolve(page,poll,'blockedChat');
  assert.equal(await page.getByText('Blocked chat record',{exact:true}).count(),0,'A departed poll cannot paint into another tab');
  await tab(page,'Chat').click();await resolve(page,await pending(page,'chat'),'chat');
  await page.evaluate(()=>qa.hide());await page.clock.fastForward(36_000);
  assert.equal(await page.evaluate(()=>qa.reads.filter(r=>r.input.mode==='chat').length),3,'Hidden Activity cleans up the live Chat interval');
});

test('a late Chat history response cannot repopulate messages after its overlapping poll denies access',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{qa.chat=Array.from({length:41},(_,i)=>({...qa.chat[0],id:String(i+1),body:'Current message '+(i+1)}));});
  await tab(page,'Chat').click();await resolve(page,await pending(page,'chat'),'chat');
  await page.getByRole('button',{name:'Earlier messages',exact:true}).click();
  const history=await pending(page,'chat');
  assert.ok(await page.evaluate(id=>Boolean(qa.reads.find(r=>r.id===id).input.before_id),history));
  await page.clock.fastForward(12_001);const poll=await pending(page,'chat');
  assert.notEqual(poll,history);
  await page.evaluate(id=>qa.reply(id,{error:'Forum access withdrawn.'}),poll);
  await page.getByRole('alert').filter({hasText:'Forum access withdrawn.'}).waitFor();
  await resolve(page,history,'blockedChat');
  assert.equal(await page.getByText('Blocked chat record',{exact:true}).count(),0,'A pre-denial history read cannot restore withdrawn payload');
  assert.equal(await page.getByText('Current message 41',{exact:true}).count(),0);
  await assertChrome(page);
});

test('identity scope changes discard another owner’s draft and accepted list data',async t=>{
  const page=await pageFor(t);
  await tab(page,'Tạo bài viết').click();await acknowledgeAction(page);await page.getByLabel('Title',{exact:true}).fill('Owner A private draft');
  await page.evaluate(()=>qa.changeViewer('owner-b'));await flush(page);
  await acknowledgeAction(page);
  assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'','Identity changes cannot reuse a private draft');
  await tab(page,'Mới nhất').click();await topic(page,'Latest record B').waitFor();
  assert.equal(await topic(page,'Latest record A').count(),0);
  assert.equal(await topic(page,'Blocked author record').count(),0);
});

test('an expired protected Activity remains hidden while authorization is pending or rejected',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{qa.checked=Date.now()-40_000;qa.deferred=true;qa.hide();qa.show();});
  assert.equal(await page.locator('section[aria-label="Owner forum"]').isVisible(),false,'Stale private data is hidden before validation');
  assert.equal(await page.evaluate(()=>qa.validateCalls),1);
  assert.equal(await page.evaluate(()=>qa.requests.length),0,'Do not refresh with unverified authority');
  await page.evaluate(()=>qa.resolve(false));await flush(page);
  assert.equal(await page.locator('section[aria-label="Owner forum"]').isVisible(),false,'Denied authorization must remain closed');
  assert.equal(await page.evaluate(()=>qa.requests.length),0);
});
