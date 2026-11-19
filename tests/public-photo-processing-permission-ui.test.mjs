import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const options={skip:!executablePath,timeout:20000};
const label='I agree to send the photos in this post to OpenAI for this safety check.';
let browser,server,url;
before(async()=>{
  if(!executablePath)return;
  const built=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('.')},stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{PublicPhotoProcessingPermission,usePublicPhotoProcessingPermission}from'./components/public-photo-processing-permission';
function App(){const[scope,S]=React.useState('author-a:salon-a:composer-1:photo-1');const p=usePublicPhotoProcessingPermission(scope);
window.fixture={scope:S,reset:p.reset,read:()=>p.consent,roundtrip(next){flushSync(()=>S(next));flushSync(()=>S(scope));}};
return <><PublicPhotoProcessingPermission accepted={p.accepted} onChange={p.setAccepted}/><button disabled={!p.accepted}>Post photo</button><output>{JSON.stringify(p.consent??null)}</output></>}
createRoot(document.getElementById('root')).render(<App/>);`}});
  const script=built.outputFiles[0].text;
  assert.doesNotMatch(script,/server-only|OPENAI_API_KEY|api\.openai\.com|sharp|public-image-safety|supabase/i);
  server=createServer((_,response)=>{response.setHeader('Content-Type','text/html');response.end('<div id="root"></div><script>'+script.replaceAll('</script','<\/script')+'</script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath,headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function pageFor(t){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);});await page.goto(url);await page.waitForFunction(()=>window.fixture);return page;
}

test('approved notice is accessible, unchecked, decline-safe and linked to Privacy',options,async t=>{
  const page=await pageFor(t),checkbox=page.getByRole('checkbox',{name:label});
  assert.equal(await checkbox.isChecked(),false);assert.equal(await page.getByRole('button',{name:'Post photo'}).isDisabled(),true);
  assert.match(await page.getByRole('region',{name:'Photo safety check'}).textContent(),/processed copies to OpenAI/);
  assert.match(await checkbox.getAttribute('aria-describedby'),/notice.*decline/);
  assert.equal(await page.getByRole('link',{name:'Privacy'}).getAttribute('href'),'/privacy');
  assert.equal(await page.evaluate(()=>sessionStorage.length+localStorage.length),0);
  await checkbox.check();assert.equal(await page.getByRole('button',{name:'Post photo'}).isDisabled(),false);
  assert.deepEqual(await page.evaluate(()=>fixture.read()),{provider:'openai',noticeVersion:'public-photo-openai-20261118-v1',accepted:true});
  await checkbox.uncheck();assert.equal(await page.getByRole('button',{name:'Post photo'}).isDisabled(),true);
  assert.equal(await page.locator('output').textContent(),'null');
});

test('photo, composer, author and salon changes discard the usable choice, including returning to an old scope',options,async t=>{
  const page=await pageFor(t),checkbox=page.getByRole('checkbox',{name:label});
  for(const scope of ['author-a:salon-a:composer-1:photo-2','author-a:salon-a:composer-2:photo-2','author-b:salon-a:composer-2:photo-2','author-b:salon-b:composer-2:photo-2','author-a:salon-a:composer-1:photo-1']){
    await checkbox.check();await page.evaluate(scope=>fixture.scope(scope),scope);
    await page.waitForFunction(()=>document.querySelector('output').textContent==='null');
    assert.equal(await checkbox.isChecked(),false);assert.equal(await page.getByRole('button',{name:'Post photo'}).isDisabled(),true);
  }
  await checkbox.check();await page.evaluate(()=>fixture.reset());await page.waitForFunction(()=>document.querySelector('output').textContent==='null');assert.equal(await checkbox.isChecked(),false);
});

test('committed identity roundtrip before queued effects cannot revive a prior affirmative choice',options,async t=>{
  const page=await pageFor(t),checkbox=page.getByRole('checkbox',{name:label});
  await checkbox.check();await page.evaluate(()=>fixture.roundtrip('other-author:other-salon:other-composer:other-photo'));
  assert.equal(await checkbox.isChecked(),false);assert.equal(await page.locator('output').textContent(),'null');
  assert.equal(await page.getByRole('button',{name:'Post photo'}).isDisabled(),true);
});

test('reloading never restores a draft or account-wide permission',options,async t=>{
  const page=await pageFor(t);await page.getByRole('checkbox',{name:label}).check();
  await page.reload();await page.waitForFunction(()=>window.fixture);
  assert.equal(await page.getByRole('checkbox',{name:label}).isChecked(),false);
  assert.equal(await page.evaluate(()=>sessionStorage.length+localStorage.length),0);
  assert.equal(await page.locator('output').textContent(),'null');
});
