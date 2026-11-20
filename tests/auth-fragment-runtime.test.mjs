import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('login auth-fragment cleanup uses replaceState, preserves next and history state, and leaves unrelated hashes intact',async()=>{
 const bundled=await build({entryPoints:['lib/auth-fragment.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'authFragment'});
 const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Auth fragment fixture</title>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.TEST_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage();
  const next='/welcome/phone?next='+encodeURIComponent('/explore/salons/00000000-0000-4000-8000-000000000001#salon-rewards');
  const search='?'+new URLSearchParams({next});
  const base='http://127.0.0.1:'+server.address().port;
  for(const[hash,cleared]of [['#access_token=fixture-access&refresh_token=fixture-refresh&token_type=bearer&type=signup',true],['#refresh_token=fixture-refresh',true],['#access_token=',true],['#salon-rewards',false],['#booking',false],['#error=access_denied&error_description=Link%20expired',false]]){
   await page.goto(base+'/login'+search+hash);
   await page.addScriptTag({content:bundled.outputFiles[0].text});
   const result=await page.evaluate(()=>{
    const state={__NA:true,tree:['fixture-route'],custom:{retained:true}};
    history.replaceState(state,'',location.href);
    const length=history.length;
    const cleaned=authFragment.clearImplicitAuthFragment(location,history);
    return {cleaned,pathname:location.pathname,search:location.search,hash:location.hash,state:history.state,lengthUnchanged:history.length===length,next:new URLSearchParams(location.search).get('next')};
   });
   assert.equal(result.cleaned,cleared);assert.equal(result.pathname,'/login');assert.equal(result.search,search);assert.equal(result.next,next);
   assert.equal(result.hash,cleared?'':hash);assert.equal(result.lengthUnchanged,true);
   assert.deepEqual(result.state,{__NA:true,tree:['fixture-route'],custom:{retained:true}});
  }
 }finally{
  if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 }
});
