import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
test('text report preserves reason after failure, uses the same request on retry, confirms receipt and returns focus',async()=>{
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SocialTextReportButton}from'./components/social-text-report-button';window.calls=[];window.mode='error';createRoot(document.getElementById('root')).render(<SocialTextReportButton target={{kind:'comment',id:'20000000-0000-4000-8000-000000000001'}}/>);`},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(b){
  const mocks={
   '@/app/post-moderation/text-report-actions':`export async function reportSocialText(input){window.calls.push(input);await new Promise(r=>setTimeout(r,60));return window.mode==='error'?{error:'Please retry.'}:{error:null,supportHref:'/support/20000000-0000-4000-8000-000000000004'};}`,
   '@/components/overlay-dismissal':`export const useOverlayPortalHost=()=>document.body;export const useNativeDialogNavigation=()=>{};export const useCloseOnNavigation=()=>{};`,
   '@/components/workspace-language':`export const WorkspaceText=({text})=>text;`,
   'next/link':`import React from'react';export default function Link(p){return React.createElement('a',p);}`
  };b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
 }}]});
 const executablePath=[process.env.TEST_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));
 assert(executablePath,'Browser required for report acceptance fixture');
 const browser=await chromium.launch({executablePath,headless:true});try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  // An actual secure origin provides crypto.randomUUID without network requests.
  await page.route('https://report-fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('https://report-fixture.test/');await page.addScriptTag({content:result.outputFiles[0].text});
  await page.getByRole('button',{name:'Report',exact:true}).click();
  await page.getByRole('textbox',{name:'Reason'}).fill('Harassment in this comment');
  await page.getByRole('button',{name:'Send report'}).click();
  await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('textbox',{name:'Reason'}).inputValue(),'Harassment in this comment');
  await page.evaluate(()=>{window.mode='success'});await page.getByRole('button',{name:'Send report'}).click();
  await page.getByRole('status').waitFor();assert.equal(await page.getByRole('link').getAttribute('href'),'/support/20000000-0000-4000-8000-000000000004');
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,2);assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(calls[0].target.kind,'comment');
  await page.getByRole('button',{name:'Close',exact:true}).click();assert(await page.getByRole('button',{name:'Report',exact:true}).evaluate(e=>document.activeElement===e));
 }finally {await browser.close();}
});
