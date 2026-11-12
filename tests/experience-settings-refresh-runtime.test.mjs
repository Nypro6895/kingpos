import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

// Real React Activity + the product boundary and route policies. Only Next's
// navigation transport and the authenticated-context provider are replaced.
// No backend, real account, or external network is used by this fixture.
const artifactDir = path.resolve('artifacts/settings-refresh-runtime');
const boundarySource = path.resolve(process.env.EXPERIENCE_BOUNDARY_TEST_SOURCE || 'components/experience-page-boundary.tsx');
const settingContentSource = path.resolve(process.env.SETTING_CONTENT_TEST_SOURCE || 'app/settings/setting-content.tsx');
let browser, server, origin;

test.before(async () => {
  await fs.mkdir(artifactDir, {recursive:true});
  const fixture = await build({
    stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
      import React, {Activity, useLayoutEffect, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {ExperiencePageBoundary} from 'test-boundary';
      import {SettingContent} from 'test-setting-content';
      const qa = window.qa = {
        visible:true, revision:'server-1', serverScope:'owner-a',
        sectionActive:true, sensitive:new URLSearchParams(location.search).get('section')==='login-security',
        checked:Date.now(), requests:[], validateCalls:0, deferred:false, answer:true,
        scope:{context:{scope:'owner-a', authenticated:true}, validationRevision:1},
      };
      const root=createRoot(document.getElementById('root'));
      qa.router={refresh(){qa.requests.push({href:location.pathname+location.search,at:Date.now()});}};
      qa.validate=()=>{
        qa.validateCalls++;
        if(qa.deferred)return new Promise(resolve=>{qa.resolveValidation=resolve;});
        if(qa.answer){qa.checked=Date.now();qa.scope={...qa.scope,validationRevision:qa.scope.validationRevision+1};qa.render();}
        return Promise.resolve(qa.answer);
      };
      qa.checkedAt=()=>qa.checked;
      qa.getValidationRevision=()=>qa.scope.validationRevision;
      Object.assign(qa.scope,{validate:qa.validate,checkedAt:qa.checkedAt,getValidationRevision:qa.getValidationRevision});
      function Editor({serverScope}){
        const [draft,setDraft]=useState('initial');
        useLayoutEffect(()=>{qa.mounts=(qa.mounts||0)+1;return()=>{qa.cleanups=(qa.cleanups||0)+1;};},[]);
        return <section aria-label="Settings editor" data-server-scope={serverScope}>
          <label>Setting draft<input value={draft} onChange={e=>setDraft(e.target.value)}/></label>
          <p>Server record for {serverScope}</p>
        </section>;
      }
      function Harness(){return <Activity mode={qa.visible?'visible':'hidden'}>
        <ExperiencePageBoundary renderRevision={qa.revision}><SettingContent active={qa.sectionActive} resetOnHide={qa.sensitive}><Editor serverScope={qa.serverScope}/></SettingContent></ExperiencePageBoundary>
      </Activity>;}
      qa.render=()=>flushSync(()=>root.render(<Harness/>));
      qa.navigate=href=>{history.pushState(null,'',href);qa.render();};
      qa.hide=()=>{qa.visible=false;qa.render();};
      qa.show=()=>{qa.visible=true;qa.render();};
      qa.section=active=>{qa.sectionActive=active;qa.render();};
      qa.server=(revision,scope=qa.serverScope)=>{qa.revision=revision;qa.serverScope=scope;qa.render();};
      qa.setScope=scope=>{qa.scope={...qa.scope,context:{...qa.scope.context,scope}};qa.render();};
      qa.resolve=answer=>{
        if(answer){qa.checked=Date.now();qa.scope={...qa.scope,validationRevision:qa.scope.validationRevision+1};qa.render();}
        const resolve=qa.resolveValidation;qa.resolveValidation=null;resolve(answer);
      };
      qa.render();qa.ready=true;
    `},
    bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
    plugins:[{name:'fixture-transport',setup(b){
      b.onResolve({filter:/^test-boundary$/},()=>({path:boundarySource}));
      b.onResolve({filter:/^test-setting-content$/},()=>({path:settingContentSource}));
      b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
      b.onResolve({filter:/experience-scope$/},()=>({path:'scope',namespace:'fixture'}));
      b.onResolve({filter:/loading-feedback$/},()=>({path:'loading',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:
        args.path==='navigation'?`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>window.qa.router;`:
        args.path==='scope'?`export const useExperienceScope=()=>window.qa.scope;`:
        `export const PageLoadingSkeleton=()=> <p role="status" data-loading>Loading protected Settings</p>;`
      }));
    }}],
  });
  const javascript=fixture.outputFiles[0].text;
  await fs.writeFile(path.join(artifactDir,'fixture.js'),javascript);
  server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');
    res.end(req.url==='/fixture.js'?javascript:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
});

test.after(async()=>{
  await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
});

async function pageFor(t,href='/settings?section=salon-one-booking'){
  const page=await browser.newPage({viewport:{width:412,height:860}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.stack));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.clock.install({time:new Date('2026-11-11T18:00:00Z')});
  await page.goto(origin+href);
  await page.waitForFunction(()=>window.qa?.ready);
  await page.getByLabel('Setting draft').waitFor({state:'visible'});
  t.after(async()=>{
    assert.deepEqual(errors,[],'The product boundary must not throw in the browser');
    await page.close();
  });
  return page;
}

async function flush(page){await page.evaluate(()=>new Promise(resolve=>queueMicrotask(resolve)));}
async function stats(page){return page.evaluate(()=>({refreshes:qa.requests.length,validateCalls:qa.validateCalls}));}
const editor=page=>page.getByRole('region',{name:'Settings editor'});
const errorBanner=page=>page.getByText('The page could not update. Check your connection and try again.',{exact:true});

test('changing mounted Settings sections retains drafts without starting whole-page refreshes',async t=>{
  const page=await pageFor(t);
  await page.getByLabel('Setting draft').fill('Preserved booking draft');
  for(const href of ['/settings?section=salon-one','/settings?section=salon-one-online','/settings','/settings?section=notifications']){
    await page.evaluate(href=>qa.navigate(href),href);await flush(page);
    assert.equal(await editor(page).isVisible(),true,'Local section navigation remains usable');
  }
  assert.equal((await stats(page)).refreshes,0,'Section state already loads its own data; do not refresh the RSC page');
  await page.evaluate(()=>{qa.section(false);qa.section(true);});await flush(page);
  assert.equal(await page.getByLabel('Setting draft').inputValue(),'Preserved booking draft');
  await page.clock.fastForward(13_000);await flush(page);
  assert.equal(await errorBanner(page).count(),0,'No abandoned section timer may show a connection error');
});

test('a retained Settings reveal validates stale authorization before showing data and refreshes once',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{qa.checked=Date.now()-40_000;qa.deferred=true;qa.hide();qa.show();});
  assert.equal(await editor(page).isVisible(),false,'A stale protected view must be hidden before paint');
  assert.equal((await stats(page)).validateCalls,1);
  assert.equal((await stats(page)).refreshes,0,'Do not refresh private data before authorization succeeds');
  await page.evaluate(()=>qa.resolve(true));await flush(page);
  assert.equal((await stats(page)).refreshes,1);
  await page.evaluate(()=>qa.server('server-2'));await flush(page);
  assert.equal(await editor(page).isVisible(),true);
  await page.clock.fastForward(13_000);await flush(page);
  assert.equal(await errorBanner(page).count(),0,'An applied server revision acknowledges the refresh');
});

test('leaving a section abandons its pending refresh and its timeout cannot affect the new section',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{qa.hide();qa.show();});await flush(page);
  assert.equal((await stats(page)).refreshes,1,'The actual Activity reveal should revalidate Settings');
  await page.evaluate(()=>qa.navigate('/settings?section=salon-one-online'));await flush(page);
  await page.clock.fastForward(13_000);await flush(page);
  assert.equal(await errorBanner(page).count(),0,'An old route request cannot report failure on the next section');
  assert.equal(await editor(page).isVisible(),true);
  await page.evaluate(()=>{qa.hide();qa.show();});await flush(page);
  assert.equal((await stats(page)).refreshes,2,'The old pending flag must not suppress a later genuine refresh');
  await page.evaluate(()=>qa.server('server-2'));await flush(page);
});

test('hiding the retained page cancels its pending timeout and the next reveal can refresh again',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{qa.hide();qa.show();});await flush(page);
  assert.equal((await stats(page)).refreshes,1);
  await page.evaluate(()=>qa.hide());
  await page.clock.fastForward(13_000);await flush(page);
  assert.equal(await errorBanner(page).count(),0,'A hidden Activity must not accumulate an expired refresh error');
  await page.evaluate(()=>qa.show());await flush(page);
  assert.equal((await stats(page)).refreshes,2,'Hiding must release the pending request flag');
  await page.evaluate(()=>qa.server('server-after-reveal'));await flush(page);
  assert.equal(await editor(page).isVisible(),true);
});

test('an actual refresh timeout remains actionable and retry clears on a new server revision',async t=>{
  const page=await pageFor(t);
  await page.evaluate(()=>{qa.hide();qa.show();});await flush(page);
  assert.equal((await stats(page)).refreshes,1);
  await page.clock.fastForward(12_001);await flush(page);
  await errorBanner(page).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  assert.equal((await stats(page)).refreshes,2);
  await page.evaluate(()=>qa.server('server-retried'));await flush(page);
  assert.equal(await errorBanner(page).count(),0);
  assert.equal(await editor(page).isVisible(),true);
});

test('changing identity scope resets local drafts and accepts the current scoped server revision',async t=>{
  const page=await pageFor(t);
  await page.getByLabel('Setting draft').fill('Private draft of owner A');
  await page.evaluate(()=>{qa.hide();qa.show();});await flush(page);
  await page.evaluate(()=>qa.setScope('owner-b'));await flush(page);
  await page.evaluate(()=>qa.server('server-scope-b','owner-b'));await flush(page);
  assert.equal(await editor(page).isVisible(),true);
  assert.equal(await editor(page).getAttribute('data-server-scope'),'owner-b');
  assert.equal(await page.getByLabel('Setting draft').inputValue(),'initial','Private drafts must not cross identity scopes');
  await page.clock.fastForward(13_000);await flush(page);
  assert.equal(await errorBanner(page).count(),0,'A prior identity refresh must not fail the new identity view');
});

test('Login & security resets retained forms on re-entry and keeps failed authorization hidden',async t=>{
  const page=await pageFor(t,'/settings?section=login-security');
  await page.getByLabel('Setting draft').fill('Sensitive security draft');
  await page.evaluate(()=>{qa.section(false);qa.section(true);});await flush(page);
  assert.equal(await page.getByLabel('Setting draft').inputValue(),'initial','Leaving a security section must discard its action state');
  await page.getByLabel('Setting draft').fill('Sensitive security draft');
  await page.evaluate(()=>{qa.checked=Date.now()-40_000;qa.deferred=true;qa.hide();qa.show();});
  assert.equal(await editor(page).isVisible(),false,'A retained security form cannot reappear before validation');
  assert.equal((await stats(page)).validateCalls,1,'Sensitive policy must not bypass protected context validation');
  await page.evaluate(()=>qa.resolve(false));await flush(page);
  assert.equal(await editor(page).isVisible(),false,'A rejected context check must not expose the retained security form');
  assert.equal((await stats(page)).refreshes,0,'No server refresh may start using a rejected context');
  await page.evaluate(()=>{qa.answer=true;qa.deferred=false;qa.hide();qa.show();});await flush(page);
  assert.equal((await stats(page)).validateCalls,2);
  assert.equal((await stats(page)).refreshes,1);
  await page.evaluate(()=>qa.server('server-security-2'));await flush(page);
  assert.equal(await editor(page).isVisible(),true);
  assert.equal(await page.getByLabel('Setting draft').inputValue(),'initial','Sensitive action state resets across real Activity hide/re-entry');
});
