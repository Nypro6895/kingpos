import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = engine === 'chromium' && !existsSync(browserPath);
let compiled;
async function fixture() {
  compiled ??= build({ stdin: { contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{AppLocalSessionExpiryPrompt}from'./components/app-local-session-expiry-prompt';
    import{createAppLocalShellHttpFetch}from'./lib/app-local-shell-http-client';
    window.hosted=[];window.visits=[];window.signInFailure=false;window.logoutFailure=false;window.contextFailure=false;window.scope='owner';window.commands=0;window.contexts=0;window.logoutResets=0;window.nativeLogout=false;window.contextEvents=0;
    const interval=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===60000){window.minuteCheck=fn;return 0;}return interval(fn,ms,...args);};
    window.addEventListener('reylumi:app-local-context',()=>window.contextEvents++);
    window.addEventListener('reylumi:app-local-reset',event=>{if(event.detail?.reason==='logout')window.logoutResets++;});
    window.fixtureHost={isNative:true,
      context:async()=>{window.contexts++;if(window.holdContext)await new Promise(resolve=>window.finishContext=resolve);if(window.contextFailure)throw Object.assign(Error('Unavailable'),{status:503});return{context:{authenticated:false,scope:'guest'},offline:false};},
      openOnline:async path=>{window.hosted.push(path);if(window.holdSignIn)await new Promise((resolve,reject)=>window.failSignIn=()=>reject(Error('Old sign-in unavailable')));if(window.signInFailure)throw Error('Unavailable');},
      command:async()=>{window.commands++;if(window.logoutFailure)throw Object.assign(Error('Unavailable'),{status:503});if(window.holdLogout)await new Promise(resolve=>window.finishLogout=resolve);if(window.nativeLogout){window.scope=undefined;window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{reason:'logout'}}));}return{status:200,headers:{},body:window.logoutBody??JSON.stringify({redirectTo:'/login?message=You have been logged out.'}),...(window.nativeLogout?{signedOut:true}:{})};}};
    const transport=createAppLocalShellHttpFetch({scope:()=>window.scope,host:()=>window.fixtureHost,fetch:window.fetch,location:'https://reylumi.com'});
    window.logout=()=>transport('/api/auth/logout',{method:'POST'});
    function App(){const[state,setState]=useState({authenticated:false,scope:'guest',enabled:true}),[path,setPath]=useState('/explore');window.authority=setState;
      window.choosePath=setPath;
      const browse=()=>{window.visits.push('/explore');setPath('/explore');};
      return <><main data-public-page={path} data-private-visible={state.authenticated===true}>Public page {path}</main><AppLocalSessionExpiryPrompt {...state} onContinueAsGuest={browse}/></>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': process.cwd() }, plugins: [{ name: 'session-authority-boundaries', setup(b) {
    if(process.env.TEST_SESSION_BASELINE)b.onLoad({filter:/[\\/](?:components[\\/]app-local-session-expiry-prompt\.tsx|lib[\\/]app-local-shell-http-client\.ts)$/},args=>({contents:execFileSync('git',['show',process.env.TEST_SESSION_BASELINE+':'+args.path.slice(process.cwd().length+1).replaceAll('\\','/')],{encoding:'utf8'}),loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:process.cwd()}));
    for (const [filter,path] of [[/(?:^|\/)app-local-host$/,'host'],[/(?:^|\/)workspace-language$/,'language'],[/(?:^|\/)experience-trace$/,'trace'],[/(?:^|\/)app-local-command-client$/,'commands']]) b.onResolve({filter},()=>({path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:{
      host:'export const getAppLocalHost=()=>window.fixtureHost;',
      language:'export function WorkspaceText({text}){return text;}',
      trace:'export const nextExperienceTraceOperation=()=>0;export const recordExperienceTrace=()=>{};',
      commands:'export const getAppLocalCommandScope=()=>window.scope;',
    }[path]}));
  } }] });
  const built=await compiled,server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<div id="root"></div><script src="/app.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();
  const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({executablePath:browserPath,headless:true}));
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(2500);
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/explore');await page.waitForFunction(()=>typeof window.authority==='function');
  return{page,async close(){await browser.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);}};
}
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function expire(page){await page.evaluate(()=>window.authority({authenticated:true,scope:'owner',enabled:true}));await settle(page);await page.evaluate(()=>window.authority({authenticated:false,scope:'guest',enabled:true}));await page.locator('dialog[open]').waitFor();}

test('cold guest and unavailable authority never manufacture a session expiry', {skip,timeout:15000},async()=>{
  const f=await fixture();try{assert.equal(await f.page.locator('dialog[open]').count(),0);await f.page.evaluate(()=>window.authority({authenticated:true,scope:'owner',enabled:true}));await settle(f.page);await f.page.evaluate(()=>window.authority({authenticated:null,scope:undefined,enabled:true}));await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);}finally{await f.close();}
});
test('confirmed expiry offers public Explore without reviving private authority and can expire after a later sign-in', {skip,timeout:15000},async()=>{
  const f=await fixture();try{await expire(f.page);assert.equal(await f.page.locator('[data-private-visible="true"]').count(),0);await f.page.getByRole('button',{name:'Continue as guest',exact:true}).click();await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);assert.deepEqual(await f.page.evaluate(()=>window.visits),['/explore']);await f.page.evaluate(()=>window.authority({authenticated:false,scope:'other-guest',enabled:true}));await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);await expire(f.page);}finally{await f.close();}
});
test('cancel follows the public guest path; opening Help clears the expired-session latch', {skip,timeout:15000},async()=>{
  const f=await fixture();try{await expire(f.page);await f.page.locator('dialog').evaluate(el=>el.dispatchEvent(new Event('cancel',{cancelable:true})));await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);assert.deepEqual(await f.page.evaluate(()=>window.visits),['/explore']);await expire(f.page);await f.page.evaluate(()=>window.authority({authenticated:null,scope:undefined,enabled:false}));await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);await f.page.evaluate(()=>window.authority({authenticated:false,scope:'guest',enabled:true}));await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);}finally{await f.close();}
});
test('confirmed intentional logout clears prior session state; an unavailable logout does not invent a signed-out account', {skip,timeout:15000},async()=>{
  const f=await fixture();try{await f.page.evaluate(()=>window.authority({authenticated:true,scope:'owner',enabled:true}));await settle(f.page);await f.page.evaluate(async()=>{window.logoutFailure=true;await window.logout().catch(()=>{});});await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);await f.page.evaluate(async()=>{window.logoutFailure=false;await window.logout();window.authority({authenticated:false,scope:'guest',enabled:true});});await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);}finally{await f.close();}
});
test('sign-in uses the existing HTTPS handoff, retries its own failure and closes only on a confirmed new login', {skip,timeout:15000},async()=>{
  const f=await fixture();try{await expire(f.page);await f.page.evaluate(()=>window.signInFailure=true);await f.page.getByRole('button',{name:'Sign in',exact:true}).click();await f.page.getByRole('alert').waitFor();assert.equal(await f.page.locator('dialog[open]').count(),1);await f.page.evaluate(()=>window.signInFailure=false);await f.page.getByRole('button',{name:'Sign in',exact:true}).click();await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),1);assert.deepEqual(await f.page.evaluate(()=>window.hosted),['/login?next=%2Fexplore','/login?next=%2Fexplore']);await f.page.evaluate(()=>window.authority({authenticated:true,scope:'new-owner',enabled:true}));await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);}finally{await f.close();}
});
test('native acknowledged logout survives its scope withdrawal, returns the known guest destination once and preserves unknown response bodies', {skip,timeout:15000},async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>{window.authority({authenticated:true,scope:'owner',enabled:true});window.nativeLogout=true;window.holdLogout=true;window.logoutResult=undefined;window.logoutPromise=window.logout().then(async response=>window.logoutResult=await response.json());});
    await f.page.waitForFunction(()=>typeof window.finishLogout==='function');
    assert.equal(await f.page.evaluate(()=>window.logoutResult),undefined);
    assert.equal(await f.page.evaluate(()=>window.logoutResets),0);
    await f.page.evaluate(async()=>{window.finishLogout();await window.logoutPromise;window.authority({authenticated:false,scope:'guest',enabled:true});});await settle(f.page);
    assert.deepEqual(await f.page.evaluate(()=>window.logoutResult),{redirectTo:'/explore'});
    assert.equal(await f.page.evaluate(()=>window.commands),1);assert.equal(await f.page.evaluate(()=>window.logoutResets),1);assert.equal(await f.page.evaluate(()=>window.contexts),0);assert.equal(await f.page.locator('dialog[open]').count(),0);
    await f.page.evaluate(async()=>{window.scope='new-owner';window.holdLogout=false;window.nativeLogout=false;window.logoutBody=JSON.stringify({redirectTo:'/login?other=1',notice:'keep'});window.logoutResult=await(await window.logout()).json();});
    assert.deepEqual(await f.page.evaluate(()=>window.logoutResult),{redirectTo:'/login?other=1',notice:'keep'});
  }finally{await f.close();}
});
test('unavailable periodic auth does not expire the account and a late reply cannot reopen expiry after intentional logout', {skip,timeout:15000},async()=>{
  const f=await fixture();try{
    await f.page.evaluate(()=>window.authority({authenticated:true,scope:'owner',enabled:true}));await f.page.waitForFunction(()=>typeof window.minuteCheck==='function');
    await f.page.evaluate(async()=>{window.contextFailure=true;await window.minuteCheck();});await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);
    await f.page.evaluate(()=>{window.contextFailure=false;window.holdContext=true;window.minuteCheck();});await f.page.waitForFunction(()=>typeof window.finishContext==='function');
    await f.page.evaluate(()=>{window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{reason:'logout'}}));window.authority({authenticated:false,scope:'guest',enabled:true});});await settle(f.page);
    await f.page.evaluate(()=>window.finishContext());await settle(f.page);
    assert.equal(await f.page.locator('dialog[open]').count(),0);assert.equal(await f.page.evaluate(()=>window.contextEvents),0);assert.equal(await f.page.locator('[data-private-visible="true"]').count(),0);
  }finally{await f.close();}
});
test('failed sign-in from before Continue as guest cannot overwrite a later session prompt', {skip,timeout:15000},async()=>{
  const f=await fixture();try{
    await expire(f.page);await f.page.evaluate(()=>window.holdSignIn=true);await f.page.getByRole('button',{name:'Sign in',exact:true}).click();await f.page.waitForFunction(()=>typeof window.failSignIn==='function');
    await f.page.getByRole('button',{name:'Continue as guest',exact:true}).click();await settle(f.page);assert.equal(await f.page.locator('dialog[open]').count(),0);
    await expire(f.page);await f.page.evaluate(()=>window.failSignIn());await settle(f.page);
    assert.equal(await f.page.getByRole('alert').count(),0);assert.equal(await f.page.getByRole('button',{name:'Sign in',exact:true}).isEnabled(),true);assert.deepEqual(await f.page.evaluate(()=>window.visits),['/explore']);
  }finally{await f.close();}
});
