import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const artifact=path.resolve('artifacts/admin-exact-text-r2-ui-20261118');
const mocks={
 'next/navigation':`export const useRouter=()=>({refresh(){window.exactTextFixture.refreshes++;}});`,
 'next/link':`import React from'react';export default function Link(p){return React.createElement('a',p);}`,
 'next/image':`import React from'react';export default function Image(p){return React.createElement('img',p);}`,
 '@/lib/admin-support-client':`export const openAdminSupport=()=>{};`,
 '@/app/support/actions':`export const reopenContentReportReview=async()=>{};`,
 '../dashboard/actions':`export const dashboardCaseAction=async form=>{window.exactTextFixture.caseCalls.push(Object.fromEntries(form));return{ok:true,message:'Support case resolved.'};};`,
 './exact-text-actions':`export const loadExactTextModerationAction=id=>window.exactTextFixture.load(id);export const setExactTextVisibilityAction=input=>window.exactTextFixture.perform(input);`,
 './report-evidence':`export const ReportEvidence=()=>null;`,
};

test('approved r2 actual report UI: decisions, scopes, version/retry recovery and compact responsive presentation',async t=>{
 mkdirSync(artifact,{recursive:true});
 const bundle=await build({entryPoints:['tests/fixtures/admin-exact-text-r2-entry.tsx'],bundle:true,write:false,outdir:'fixture',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-admin-transport',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
 assert(executablePath,'Installed browser required; no browser download permitted');
 const browser=await chromium.launch({executablePath,headless:true});
 const errors=[],blocked=[];
 async function scenario(name,run){await t.test(name,async()=>{const page=await browser.newPage({viewport:{width:1080,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(route.request().url()==='https://exact-text-fixture.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial,sans-serif;background:#f5f8fa;margin:0;padding:24px}main{max-width:820px;margin:auto}button,textarea{font:inherit}@media(max-width:760px){body{padding:12px}}</style><main><div id="root"></div></main>'});blocked.push(route.request().url());return route.abort();});try{await page.goto('https://exact-text-fixture.test/');await page.addStyleTag({content:css});await page.addScriptTag({content:js});await page.getByRole('region',{name:'Reported text evidence'}).waitFor();await run(page);}finally{await page.close();}});}
 const panel=page=>page.getByRole('region',{name:'Reported text evidence'});
 const reason=page=>panel(page).getByRole('textbox',{name:'Decision reason'});
 const calls=page=>page.evaluate(()=>window.exactTextFixture.calls);
 const primary=page=>panel(page).locator('button[type="submit"]');
 try{
  await scenario('visible → hide → scoped restore, required reason, folded history and mobile/desktop touch targets',async page=>{
   assert.equal(await page.locator('details[open]').count(),0);
   assert.equal(await primary(page).count(),1);assert.equal(await primary(page).textContent(),'Hide comment');
   await primary(page).click();assert.equal((await calls(page)).length,0,'native required field prevents empty decision');
   for(const width of [1080,390]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
    for(const locator of [primary(page),panel(page).getByRole('button',{name:'Refresh content'}),panel(page).locator('summary'),page.getByText('Case handling',{exact:true}).first()])assert((await locator.boundingBox()).height>=44);
    await page.screenshot({path:path.join(artifact,`r2-visible-${width}.png`),fullPage:true});
   }
   assert(!(await panel(page).innerText()).includes('version-one-not-for-display'));
   await reason(page).fill('Harassment in the exact reported text.');await primary(page).click();await panel(page).getByRole('status').waitFor();
   assert.equal(await primary(page).textContent(),'Restore comment');assert.equal(await reason(page).inputValue(),'');
   assert.equal((await calls(page))[0].action,'hide');assert.equal(await page.evaluate(()=>window.exactTextFixture.caseCalls.length),0);
   await page.screenshot({path:path.join(artifact,'r2-hidden-390.png'),fullPage:true});
   await reason(page).fill('Appeal reviewed; this case’s hide can be released.');await primary(page).click();await panel(page).getByText('Currently visible to eligible viewers.').waitFor();
   assert.deepEqual((await calls(page)).map(c=>c.action),['hide','restore']);
   assert.equal(await page.evaluate(()=>window.exactTextFixture.refreshes),2);
   await panel(page).locator('summary').click();assert(await panel(page).getByText('This case’s hide released',{exact:true}).isVisible());
  });
  await scenario('stale/confirmed failure retains reason and requires refresh before new version and request',async page=>{
   await page.evaluate(()=>{window.exactTextFixture.mode='stale';});await reason(page).fill('Keep my reviewed reason.');await primary(page).click();await panel(page).getByRole('alert').waitFor();
   assert.equal(await reason(page).inputValue(),'Keep my reviewed reason.');assert(await primary(page).isDisabled());
   await page.evaluate(()=>{window.exactTextFixture.mode='success';window.exactTextFixture.loadState={...window.exactTextFixture.state,evidenceVersion:'version-after-refresh',revision:2};});
   await panel(page).getByRole('button',{name:'Refresh content'}).click();await primary(page).waitFor();await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
   await primary(page).click();await panel(page).getByRole('status').waitFor();const seen=await calls(page);
   assert.equal(seen.length,2);assert.notEqual(seen[0].requestId,seen[1].requestId);assert.equal(seen[1].expectedVersion,'version-after-refresh');assert.equal(seen[1].reason,seen[0].reason);
  });
  for(const mode of ['unknown','throw'])await scenario(`${mode} transport retains identical intent through refresh and one retry`,async page=>{
   await page.evaluate(mode=>{window.exactTextFixture.mode=mode;},mode);await reason(page).fill('Frozen reason on uncertain outcome.');await primary(page).click();await panel(page).getByRole('alert').waitFor();
   assert(await reason(page).getAttribute('readonly')!==null);assert.equal(await primary(page).textContent(),'Confirm previous decision');
   await page.evaluate(()=>{window.exactTextFixture.loadState={...window.exactTextFixture.state,evidenceVersion:'changed-while-unknown',revision:3,canHide:false,canRestore:false};});
   await panel(page).getByRole('button',{name:'Refresh content'}).click();await page.waitForFunction(()=>window.exactTextFixture.loads.length===1);assert.equal(await primary(page).textContent(),'Confirm previous decision');
   await page.evaluate(()=>{window.exactTextFixture.mode='success';});await primary(page).click();await panel(page).getByRole('status').waitFor();const seen=await calls(page);
   assert.equal(seen.length,2);assert.deepEqual(seen[1],seen[0],'same UUID, action, body/version, reason and case on unknown retry');
  });
  await scenario('pending click is fenced; case/actor switch drops old intent and late result',async page=>{
   await page.evaluate(()=>{window.exactTextFixture.mode='deferred';});await reason(page).fill('Only one in-flight decision.');await primary(page).click();await page.waitForFunction(()=>window.exactTextFixture.calls.length===1);
   await panel(page).locator('form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});assert.equal((await calls(page)).length,1);
   await page.evaluate(()=>window.exactTextFixture.render({reportId:'70000000-0000-4000-8000-000000000021',membershipId:'70000000-0000-4000-8000-000000000022'}));
   await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');assert.equal(await reason(page).inputValue(),'');
   await page.evaluate(()=>window.exactTextFixture.resolveDecision?.());await page.waitForTimeout(30);assert.equal(await reason(page).inputValue(),'');assert.equal(await primary(page).textContent(),'Hide comment');assert.equal(await page.evaluate(()=>window.exactTextFixture.refreshes),0);
  });
  await scenario('late action cannot replace newer verified private/unavailable evidence',async page=>{
   await page.evaluate(()=>{window.exactTextFixture.mode='deferred';});await reason(page).fill('Keep this pending reason.');await primary(page).click();await page.waitForFunction(()=>window.exactTextFixture.calls.length===1);
   await page.evaluate(()=>window.exactTextFixture.render({state:{...window.exactTextFixture.state,status:'unavailable',availabilityVerified:true,body:null,evidenceVersion:null,revision:2,canHide:false,canRestore:false,moderationStatus:'unavailable',blockedReason:'The source is now private.'}}));
   await panel(page).getByText(/The reported text is unavailable/).waitFor();await page.evaluate(()=>window.exactTextFixture.resolveDecision?.());await page.waitForFunction(()=>!document.querySelector('textarea')?.disabled);
   assert.equal(await primary(page).count(),0);assert(!(await panel(page).innerText()).includes('Synthetic reported comment'));assert(!(await panel(page).innerText()).includes('Previously recorded synthetic text.'));assert.equal(await reason(page).inputValue(),'Keep this pending reason.');assert.equal(await page.evaluate(()=>window.exactTextFixture.refreshes),0);
  });
  await scenario('late refresh cannot restore quote or controls after read/update capability revocation',async page=>{
   await page.evaluate(()=>{window.exactTextFixture.deferLoad=true;});await panel(page).getByRole('button',{name:'Refresh content'}).click();await page.waitForFunction(()=>window.exactTextFixture.loads.length===1);
   await page.evaluate(()=>window.exactTextFixture.render({permissions:[]}));await panel(page).getByText('Content decisions are unavailable for your role.').waitFor();await page.evaluate(()=>window.exactTextFixture.resolveLoad?.());await page.waitForFunction(()=>document.querySelector('button[type=button]')?.textContent==='Refresh content');
   assert.equal(await primary(page).count(),0);assert(!(await panel(page).innerText()).includes('Synthetic reported comment'));assert(!(await panel(page).innerText()).includes('Previously recorded synthetic text.'));
  });
  await scenario('read-only roles, verified unavailable and unconfirmed recorded fallback never offer live decisions',async page=>{
   await page.evaluate(()=>window.exactTextFixture.render({permissions:['admin.reports.read']}));await panel(page).getByText('Content decisions are unavailable for your role.').waitFor();assert.equal(await primary(page).count(),0);
   for(const blockedReason of ['The author withdrew this content.','The parent post is private.','Another safety hold prevents restoration.']){
    await page.evaluate(blockedReason=>window.exactTextFixture.render({state:{...window.exactTextFixture.state,canHide:false,canRestore:false,moderationStatus:'hidden',blockedReason},permissions:['admin.reports.read','admin.reports.update']}),blockedReason);
    await panel(page).getByText(blockedReason,{exact:true}).waitFor();assert.equal(await primary(page).count(),0);
   }
   await page.evaluate(()=>window.exactTextFixture.render({state:{...window.exactTextFixture.state,status:'unavailable',availabilityVerified:true,body:null,canHide:false,canRestore:false,moderationStatus:'unavailable'}}));
   await panel(page).getByText(/The reported text is unavailable/).waitFor();assert(!(await panel(page).innerText()).includes('Previously recorded synthetic text.'));assert.equal(await primary(page).count(),0);
   await page.evaluate(()=>window.exactTextFixture.render({state:{...window.exactTextFixture.state,status:'unavailable',availabilityVerified:false,body:null,canHide:false,canRestore:false,moderationStatus:'unavailable'}}));
   await panel(page).getByText('Recorded text · current availability not confirmed',{exact:true}).waitFor();assert(await panel(page).getByText('Previously recorded synthetic text.',{exact:true}).isVisible());assert.equal(await primary(page).count(),0);
   assert.equal((await calls(page)).length,0);
  });
  await scenario('multiple cases: release only this hide, never promise visible; other-case-only can add own hide',async page=>{
   await page.evaluate(()=>window.exactTextFixture.render({state:{...window.exactTextFixture.state,moderationStatus:'hidden',canHide:false,canRestore:true,heldByThisCase:true,otherHoldCount:1}}));
   await panel(page).getByRole('button',{name:'Release this hide',exact:true}).waitFor();await reason(page).fill('Release this case after appeal.');await primary(page).click();
   await panel(page).getByRole('status').waitFor();assert((await panel(page).getByRole('status').innerText()).includes('Another restriction keeps the content hidden.'));assert.equal(await primary(page).textContent(),'Hide for this case');
   assert.equal((await calls(page))[0].action,'restore');assert(!(await panel(page).innerText()).includes('Currently visible to eligible viewers.'));
  });
  await scenario('case resolution stays collapsed and calls only existing Support action',async page=>{
   await page.getByText('Case handling',{exact:true}).first().click();
   const record=page.getByRole('button',{name:'Record resolution',exact:true});assert(await record.isVisible());assert((await record.boundingBox()).height>=44);assert.equal(await record.evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
   await record.click();await page.getByRole('textbox',{name:'Resolution visible to the customer'}).fill('We reviewed the report and recorded the outcome.');await page.getByRole('textbox',{name:'Internal reason',exact:true}).fill('Support handling only.');await page.getByRole('button',{name:'Resolve case',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.exactTextFixture.caseCalls.length),0);await page.getByRole('button',{name:'Confirm action',exact:true}).click();await page.waitForFunction(()=>window.exactTextFixture.caseCalls.length===1);
   assert.equal(await page.evaluate(()=>window.exactTextFixture.caseCalls[0].operation),'resolve');assert.equal((await calls(page)).length,0);assert.equal(await primary(page).textContent(),'Hide comment');
   await page.evaluate(()=>window.exactTextFixture.render({social:false}));await page.getByRole('region',{name:'Reported text evidence'}).waitFor({state:'detached'});assert.equal(await page.getByText('Case handling',{exact:true}).count(),1,'ordinary report retains original unfolded handling');
  });
  assert.deepEqual(errors,[],'no browser runtime errors');assert.deepEqual(blocked,[],'fixture attempts no network/provider/media requests');
  writeFileSync(path.join(artifact,'browser-acceptance.json'),JSON.stringify({schemaVersion:1,capturedAt:new Date().toISOString(),source:'Actual ReportCaseView/SocialContentDecision bundled from worktree',transport:'All server/Support bindings mocked; requests restricted to in-memory secure-origin HTML',runtime:'Installed Chromium desktop/mobile viewport emulation',scenarios:10,browserErrors:errors,unexpectedRequests:blocked,screenshots:['r2-visible-1080.png','r2-visible-390.png','r2-hidden-390.png'],limitations:['Not hosted Next Server Action, RLS, Safari/native/device or production acceptance.','Reason and unknown request identity are retained within the mounted case/actor session, not persisted across a hard page reload.']},null,2));
 }finally{await browser.close();}
});
