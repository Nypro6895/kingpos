import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {chromium} from 'playwright-core';

const bridge=readFileSync(new URL('../app/src/main/assets/NativeBridge.js',import.meta.url),'utf8');
const guard=readFileSync(new URL('../app/src/qa/assets/QaNetworkGuard.js',import.meta.url),'utf8');

test('QA document WebSockets allow exact HMR and backend realtime paths and reject other endpoints',()=>{
  const context={window:{WebSocket:class{constructor(value){this.url=String(value)}}},URL,location:{href:'http://localhost:3117/settings'},DOMException};
  vm.runInNewContext(guard,context);
  assert.equal(new context.window.WebSocket('ws://localhost:3117/_next/webpack-hmr').url,'ws://localhost:3117/_next/webpack-hmr');
  assert.equal(new context.window.WebSocket('ws://127.0.0.1:55421/realtime/v1/websocket?apikey=synthetic&vsn=1.0.0').url,'ws://127.0.0.1:55421/realtime/v1/websocket?apikey=synthetic&vsn=1.0.0');
  for(const value of ['wss://example.invalid','ws://localhost:3118','ws://127.0.0.1:3117','ws://user@localhost:3117/_next/webpack-hmr',
    'ws://localhost:3117/other','ws://127.0.0.1:55421/other','wss://127.0.0.1:55421/realtime/v1/websocket',
    'ws://localhost:55421/realtime/v1/websocket','ws://127.0.0.1:55421/realtime/v1/websocket#fragment'])
    assert.throws(()=>new context.window.WebSocket(value),/Local QA blocks/);
});

for(const origin of ['https://reylumi.com','http://localhost:3117']){
  test(`Native Back respects pending and foreground dialog before More at ${origin}`,async()=>{
    const browser=await chromium.launch(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH,headless:true}:{channel:'chrome',headless:true});
    try{
      const page=await browser.newPage();
      await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`
        <details open data-dismissible-popover><summary>More</summary>Menu</details>
        <dialog><input value="Draft"></dialog>
        <script>window.reylumiAndroid={postMessage(){}};window.busy=true;
        const dialog=document.querySelector('dialog');dialog.addEventListener('cancel',e=>{if(window.busy)e.preventDefault()});dialog.showModal();</script>`}));
      await page.goto(origin+'/settings');
      await page.addScriptTag({content:bridge.replace("const trustedOrigin = 'https://reylumi.com';",`const trustedOrigin = '${origin}';`)});
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
      assert.equal(await page.locator('dialog').evaluate(e=>e.open),true);
      assert.equal(await page.locator('details').evaluate(e=>e.open),true);
      assert.equal(await page.locator('input').inputValue(),'Draft');
      await page.evaluate(()=>{window.busy=false;window.__reylumiAndroidBack()});
      assert.equal(await page.locator('dialog').evaluate(e=>e.open),false);
      assert.equal(await page.locator('details').evaluate(e=>e.open),true);
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
      assert.equal(await page.locator('details').evaluate(e=>e.open),false);
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),false);
      await page.goto('https://untrusted.invalid/settings');
      await page.addScriptTag({content:bridge});
      assert.equal(await page.evaluate(()=>typeof window.__reylumiAndroidBack),'undefined');
    }finally{await browser.close()}
  });
}
