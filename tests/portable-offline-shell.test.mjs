import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

test('offline shell reloads with cached code and is removed on lock', {
  skip: !process.env.TEST_BROWSER_PATH, timeout:45000,
}, async()=>{
  const worker=readFileSync('public/portable-sw.js','utf8');
  const server=createServer((req,res)=>{
    if(req.url==='/portable-sw.js'){res.setHeader('Content-Type','text/javascript');res.end(worker);return;}
    if(req.url==='/_next/static/test.js'){res.setHeader('Content-Type','text/javascript');res.end('window.shellLoaded=true;');return;}
    if(req.url.startsWith('/pos/customer-display?')){res.setHeader('Content-Type','text/html');res.end('<main data-customer-display-shell>Customer</main><script src="/_next/static/test.js"></script>');return;}
    res.setHeader('Content-Type','text/html');res.end('<main data-portable-pos-shell>Portable</main><script src="/_next/static/test.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try {
    const context=await browser.newContext();const page=await context.newPage();
    const base=`http://127.0.0.1:${server.address().port}`;
    async function waitForAsync(fn) { const until=Date.now()+15000; while(Date.now()<until){if(await page.evaluate(fn))return;await page.waitForTimeout(50);}throw Error('Cache condition timed out'); }
    await page.goto(base+'/pos/portable');
    await page.evaluate(async()=>{
      await navigator.serviceWorker.register('/portable-sw.js',{scope:'/pos/'});
      const registration=await navigator.serviceWorker.ready;
      registration.active.postMessage({kind:'portable-prepare',scope:'salon:key',assets:[],displayPath:'/pos/customer-display?token=test-pair'});
    });
    await waitForAsync(async()=>!!await (await caches.open('kingpos-portable-shell-v1')).match('/pos/__portable-cache-session'));
    assert.ok(await page.evaluate(async()=>!!await(await caches.open('kingpos-portable-shell-v1')).match('/pos/portable')));
    await waitForAsync(async()=>!!await (await caches.open('kingpos-portable-shell-v1')).match('/pos/customer-display?token=test-pair'));
    // Previously a 24-hour expiry silently deleted the entire offline shell.
    await page.evaluate(async()=>{const cache=await caches.open('kingpos-portable-shell-v1');await cache.put('/pos/__portable-cache-session',new Response(JSON.stringify({scope:'salon:key',expiresAt:Date.now()-400*86400000})));});
    await context.setOffline(true);await page.reload();
    await page.waitForFunction(()=>window.shellLoaded===true);
    assert.equal(await page.locator('main').textContent(),'Portable');
    await page.goto(base+'/pos/portable/book');
    assert.equal(page.url(),base+'/pos/portable');
    await page.evaluate(()=>navigator.serviceWorker.controller.postMessage({kind:'portable-lock'}));
    await waitForAsync(async()=>!(await caches.keys()).includes('kingpos-portable-shell-v1'));
    await assert.rejects(page.reload());
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
