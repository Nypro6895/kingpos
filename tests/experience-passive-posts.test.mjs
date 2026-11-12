import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createServer} from 'node:http';
import {build, transformSync} from 'esbuild';
import {chromium} from 'playwright-core';

const artifactDir=path.resolve('artifacts/experience-passive-posts');
const sourcePath=path.resolve(process.env.EXPERIENCE_MUTATIONS_TEST_SOURCE || 'lib/experience-mutations.ts');
const module={exports:{}};
vm.runInNewContext(transformSync(await fs.readFile(sourcePath,'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports});
const classify=module.exports.classifyExperienceResponse;
const empty=()=>new Headers();
const readPaths=['/api/membership/salon-badges','/api/app-local/read'];

test('batched badges and large native resource reads are POST reads, without cache mutation signals',()=>{
  for(const pathname of readPaths){
    assert.equal(classify(pathname,'POST',new Headers({'Content-Type':'application/json'}),empty()),'none',pathname);
    assert.equal(classify(pathname,'GET',empty(),empty()),'none',pathname);
  }
});

test('explicit server data or scope changes retain priority even on passive read transports',()=>{
  for(const pathname of readPaths)for(const hint of ['data','scope']){
    const response=new Headers({'x-reylumi-experience-change':hint});
    assert.equal(classify(pathname,'POST',empty(),response),hint);
    assert.equal(classify(pathname,'GET',empty(),response),hint);
  }
});

test('Server Action revalidation still invalidates and read-only actions still remain passive',()=>{
  for(const pathname of [...readPaths,'/settings']){
    const action=new Headers({'Next-Action':'fixture-action'});
    for(const value of ['1','2'])assert.equal(classify(pathname,'POST',action,new Headers({'x-action-revalidated':value})),'data');
    assert.equal(classify(pathname,'POST',action,empty()),'none');
    assert.equal(classify(pathname,'POST',action,new Headers({'x-action-revalidated':'0'})),'none');
  }
});

test('actual command and settings writes keep their mutation semantics for every write method',()=>{
  for(const pathname of ['/api/app-local/command','/api/notifications','/api/market/orders','/api/customer-visits/request']){
    for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(classify(pathname,method,empty(),empty()),'data',`${method} ${pathname}`);
    for(const method of ['GET','HEAD','OPTIONS'])assert.equal(classify(pathname,method,empty(),empty()),'none',`${method} ${pathname}`);
  }
  // Only the exact audited POST endpoints are exempt; other methods or a new
  // nested handler must not silently inherit a read-only classification.
  for(const pathname of readPaths){
    for(const method of ['PUT','PATCH','DELETE'])assert.equal(classify(pathname,method,empty(),empty()),'data');
    assert.equal(classify(pathname+'/write','POST',empty(),empty()),'data');
  }
});

test('existing passive delivery and search endpoints and authentication behavior are preserved',()=>{
  for(const pathname of ['/api/explore/search','/api/explore/feed','/api/explore/area','/api/explore/advertising','/api/public-booking/inspiration-times','/api/pos/windows-download','/api/campaigns/delivery']){
    assert.equal(classify(pathname,'POST',empty(),empty()),'none',pathname);
  }
  assert.equal(classify('/api/auth/logout','POST',empty(),empty()),'none');
  assert.equal(classify('/api/auth/session','GET',empty(),empty()),'none');
});

test('actual session fetch observer does not emit mutation events for reads, while writes and explicit hints still invalidate',{timeout:30_000},async()=>{
  await fs.mkdir(artifactDir,{recursive:true});
  const output=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';
    import{SessionExpiryPrompt}from'./components/session-expiry-prompt';
    window.qa={events:[],invalidations:[],requests:[],replyStatus:200,replyHeaders:{}};
    window.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);qa.requests.push(url.pathname);return new Response(JSON.stringify({badges:[]}),{status:qa.replyStatus,headers:qa.replyHeaders});};
    for(const name of ['reylumi:experience-mutation','reylumi:experience-scope-changed'])window.addEventListener(name,event=>qa.events.push({name,detail:event.detail}));
    function Fixture(){useEffect(()=>{qa.ready=true;},[]);return <SessionExpiryPrompt authenticated={false}/>;}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'fixture-transport',setup(b){
    b.onResolve({filter:/experience-mutations$/},()=>({path:sourcePath}));
    b.onResolve({filter:/(workspace-language|experience-scope|reset-experience-cache|experience-resource-cache|login-form)$/},args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:
      args.path==='workspace-language'?`export const WorkspaceText=({text})=>text;`:
      args.path==='experience-scope'?`export const useExperienceScope=()=>({context:{scope:'qa-guest'}});`:
      args.path==='reset-experience-cache'?`export const resetExperienceCaches=()=>{};`:
      args.path==='experience-resource-cache'?`export const invalidateExperienceResources=detail=>window.qa.invalidations.push(detail);`:
      `export const LoginForm=()=>null;`
    }));
  }}]});
  const javascript=output.outputFiles[0].text;
  await fs.writeFile(path.join(artifactDir,'observer-fixture.js'),javascript);
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');
    res.end(req.url==='/fixture.js'?javascript:'<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.stack));
    await page.goto(`http://127.0.0.1:${server.address().port}/settings`);
    await page.waitForFunction(()=>qa.ready);
    await page.evaluate(async paths=>{for(let i=0;i<12;i++)for(const pathname of paths)await fetch(pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});},readPaths);
    let state=await page.evaluate(()=>({events:qa.events,invalidations:qa.invalidations,requests:qa.requests}));
    assert.equal(state.requests.length,24,'All batched read requests should complete');
    assert.deepEqual(state.events,[],'Read completions must not force experience/context revalidation');
    assert.deepEqual(state.invalidations,[],'Reads must not evict their own retained resources');

    await page.evaluate(()=>fetch('/api/app-local/command',{method:'POST',body:'{}'}));
    state=await page.evaluate(()=>({events:qa.events,invalidations:qa.invalidations}));
    assert.equal(state.events.length,1);
    assert.equal(state.events[0].name,'reylumi:experience-mutation');
    assert.equal(state.invalidations[0].scope,'qa-guest');

    for(const hint of ['data','scope']){
      await page.evaluate(async hint=>{qa.replyHeaders={'x-reylumi-experience-change':hint};await fetch('/api/membership/salon-badges',{method:'POST',body:'{}'});},hint);
    }
    state=await page.evaluate(()=>({events:qa.events,invalidations:qa.invalidations}));
    assert.deepEqual(state.events.map(event=>event.name),['reylumi:experience-mutation','reylumi:experience-mutation','reylumi:experience-scope-changed']);
    assert.equal(state.invalidations.length,3);
    await page.evaluate(async()=>{qa.replyStatus=503;qa.replyHeaders={};await fetch('/api/app-local/command',{method:'POST',body:'{}'});});
    assert.equal(await page.evaluate(()=>qa.events.length),3,'A failed command cannot announce a committed write');
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
