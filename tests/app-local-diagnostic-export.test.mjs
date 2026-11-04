import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

let browser, server, origin;
const evidence='artifacts/quality-combined-release-20261103/help-diagnostic-export';
before(async()=>{
  const bundle=await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from'react';import{createRoot}from'react-dom/client';import{AppLocalHelp}from'./components/app-local-help';
const q=new URLSearchParams(location.search);window.h={calls:0,network:0,mode:q.get('mode')||'sync'};
window.fetch=()=>{h.network++;throw Error('Network forbidden')};window.XMLHttpRequest=class{constructor(){h.network++;throw Error('Network forbidden')}};
if(q.has('cap'))window.__reylumiExportDiagnostics=()=>{h.calls++;if(h.mode==='throw')throw Error('Private native detail');if(h.mode==='reject')return Promise.reject(Error('Private native detail'));if(h.mode==='pending')return new Promise((resolve,reject)=>{h.finish=resolve;h.fail=reject;});};
createRoot(document.getElementById('root')).render(<AppLocalHelp support={!q.has('catalog')} language={q.get('lang')==='vi'?'vi':'en'} navigate={()=>{}}/>);
`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'fixture.js',plugins:[{name:'help-local-state-boundaries',setup(b){
    b.onResolve({filter:/use-remembered-experience$|experience-state$|experience-persistent-cache$/},({path})=>({path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('use-remembered-experience')?'export const useRememberedExperience=()=>{};':path.endsWith('experience-state')?'export const clearExperienceState=()=>{};':'export const getExperienceDeviceGeneration=()=>"fixture-device";',loader:'js'}));
  }}]});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}else{res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:0}*{box-sizing:border-box}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});fs.mkdirSync(evidence,{recursive:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function fixture(t,query=''){
  const page=await browser.newPage({viewport:{width:428,height:926}});t.after(()=>page.close());page.setDefaultTimeout(4000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));await page.goto(origin+'/?'+query);await page.locator('main').waitFor();return page;
}
test('diagnostic export needs native capability and appears once in Help home or public support',async t=>{
  for(const query of ['', 'catalog=1']){
    const page=await fixture(t,query);assert.equal(await page.getByRole('button',{name:'Save diagnostic report',exact:true}).count(),0);
    assert.deepEqual(await page.evaluate(()=>[h.calls,h.network]),[0,0]);
  }
  const page=await fixture(t,'cap=1&catalog=1'),button=page.getByRole('button',{name:'Save diagnostic report',exact:true});assert.equal(await button.count(),1);assert.deepEqual(await page.evaluate(()=>[h.calls,h.network]),[0,0]);await button.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/help-home-en-428.png'});
});
test('one user click calls the existing export once; pending duplicates are blocked and EN/VI controls fit',async t=>{
  const measurements=[];
  for(const [lang,label,opening,prompt]of [['en','Save diagnostic report','Opening save options…','Choose where to save the report.'],['vi','Lưu báo cáo chẩn đoán','Đang mở tùy chọn lưu…','Chọn nơi lưu báo cáo.']]){
    const page=await fixture(t,'cap=1&mode=pending&lang='+lang),button=page.getByRole('button',{name:label,exact:true});await button.waitFor();
    assert.deepEqual(await page.evaluate(()=>[h.calls,h.network]),[0,0],'No automatic export on mount');
    await button.evaluate(node=>{node.click();node.click();});await page.getByRole('button',{name:opening,exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:opening,exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>h.calls),1);
    await page.evaluate(()=>h.finish());await page.getByRole('status').filter({hasText:prompt}).waitFor();assert.equal(await button.isEnabled(),true);
    assert.deepEqual(await page.evaluate(()=>[h.calls,h.network]),[1,0]);
    for(const width of [320,428]){
      await page.setViewportSize({width,height:926});const fit=await button.evaluate(node=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,button:node.getBoundingClientRect().toJSON()}));
      assert.ok(fit.scrollWidth<=width+1);assert.ok(fit.button.height>=44);assert.ok(fit.button.right<=width+1);measurements.push({lang,...fit});
    }
    await page.screenshot({path:evidence+'/support-'+lang+'-428.png',fullPage:true});
  }
  fs.writeFileSync(evidence+'/browser-checks.json',JSON.stringify({passed:true,actualComponents:['AppLocalHelp','AppLocalDiagnosticExport'],noAutomaticExport:true,onePendingExport:true,noNetwork:true,measurements,scope:'Synthetic native capability with real component/Help CSS; Chromium, not actual iPhone share sheet'},null,2));
});
test('sync and async native errors stay generic, stop pending and retry only on another user click',async t=>{
  const page=await fixture(t,'cap=1&mode=throw'),button=page.getByRole('button',{name:'Save diagnostic report',exact:true});
  await button.click();await page.getByRole('alert').filter({hasText:'Could not open the diagnostic report. Try again.'}).waitFor();assert.equal(await button.isEnabled(),true);
  assert.doesNotMatch(await page.locator('body').innerText(),/Private native detail/);assert.equal(await page.evaluate(()=>h.calls),1);
  await page.evaluate(()=>h.mode='reject');await button.click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>h.calls),2);assert.equal(await button.isEnabled(),true);
  await page.evaluate(()=>h.mode='sync');await button.click();await page.getByRole('status').filter({hasText:'Choose where to save the report.'}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
  assert.deepEqual(await page.evaluate(()=>[h.calls,h.network]),[3,0]);
});
