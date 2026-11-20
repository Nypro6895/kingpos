import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {chromium} from 'playwright-core';

const bridge=readFileSync(new URL('../app/src/main/assets/NativeBridge.js',import.meta.url),'utf8');
const guard=readFileSync(new URL('../app/src/qa/assets/QaNetworkGuard.js',import.meta.url),'utf8');

for(const [port,backendPort] of [['3117','55421'],['3119','55521']]) test(`QA WebSockets use only configured app port ${port} and backend ${backendPort}`,()=>{
  const context={window:{WebSocket:class{constructor(value){this.url=String(value)}}},URL,location:{href:`http://localhost:${port}/settings`},DOMException};
  vm.runInNewContext(guard.replace("const qaAppPort = '3117';",`const qaAppPort = '${port}';`).replace("const qaBackendPort = '55421';",`const qaBackendPort = '${backendPort}';`),context);
  assert.equal(new context.window.WebSocket(`ws://localhost:${port}/_next/webpack-hmr`).url,`ws://localhost:${port}/_next/webpack-hmr`);
  assert.equal(new context.window.WebSocket(`ws://127.0.0.1:${backendPort}/realtime/v1/websocket?apikey=synthetic&vsn=1.0.0`).url,`ws://127.0.0.1:${backendPort}/realtime/v1/websocket?apikey=synthetic&vsn=1.0.0`);
  for(const value of ['wss://example.invalid','ws://localhost:3118',`ws://localhost:${port==='3117'?'3119':'3117'}/_next/webpack-hmr`,`ws://127.0.0.1:${backendPort==='55421'?'55521':'55421'}/realtime/v1/websocket`,'ws://127.0.0.1:3117','ws://user@localhost:3117/_next/webpack-hmr',
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
  test(`Native Back resolves nested Gift roles and preserves cancel guards at ${origin}`,async()=>{
    const browser=await chromium.launch(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH,headless:true}:{channel:'chrome',headless:true});
    try{
      const page=await browser.newPage();
      await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`
        <details open data-dismissible-popover><summary>More</summary>Menu</details>
        <dialog><section role="dialog"><input value="Gift draft"><button aria-label="Close transfer gift card">×</button></section></dialog>
        <script>window.reylumiAndroid={postMessage(){}};window.busy=true;window.cancels=0;window.closeClicks=0;
        const d=document.querySelector('dialog');d.addEventListener('cancel',e=>{window.cancels++;if(window.busy)e.preventDefault()});
        document.querySelector('button').onclick=()=>window.closeClicks++;d.showModal();</script>`}));
      await page.goto(origin+'/gift-cards');
      await page.addScriptTag({content:bridge.replace("const trustedOrigin = 'https://reylumi.com';",`const trustedOrigin = '${origin}';`)});
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
      assert.equal(await page.locator('dialog').evaluate(e=>e.open),true);
      assert.equal(await page.evaluate(()=>window.cancels),1);
      assert.equal(await page.locator('input').inputValue(),'Gift draft');
      await page.evaluate(()=>{window.busy=false;window.__reylumiAndroidBack()});
      assert.equal(await page.locator('dialog').evaluate(e=>e.open),false);
      assert.equal(await page.evaluate(()=>window.cancels),2);
      assert.equal(await page.evaluate(()=>window.closeClicks),0);
      assert.equal(await page.locator('details').evaluate(e=>e.open),true);
    }finally{await browser.close()}
  });
  test(`Legacy custom dialogs retain authored Escape and block history through dirty or unknown overlays at ${origin}`,async()=>{
    const browser=await chromium.launch(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH,headless:true}:{channel:'chrome',headless:true});
    try{
      const page=await browser.newPage();
      await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<details open data-dismissible-popover><summary>More</summary>Menu</details>
        <aside role="dialog"><input value="Unchanged"><button>Submit payment</button></aside>
        <script>window.reylumiAndroid={postMessage(){}};window.clicked=0;window.escaped=0;window.dirty=true;
        document.querySelector('button').onclick=()=>window.clicked++;
        window.authoredEscape=e=>{if(e.key!=='Escape')return;window.escaped++;if(window.dirty)e.preventDefault();else document.querySelector('aside')?.remove()};
        document.addEventListener('keydown',window.authoredEscape);</script>`}));
      await page.goto(origin+'/settings');
      await page.addScriptTag({content:bridge.replace("const trustedOrigin = 'https://reylumi.com';",`const trustedOrigin = '${origin}';`)});
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
      assert.deepEqual(await page.evaluate(()=>[window.clicked,window.escaped]),[0,1]);
      assert.equal(await page.locator('input').inputValue(),'Unchanged');
      assert.equal(await page.locator('details').evaluate(e=>e.open),true);
      await page.evaluate(()=>{window.dirty=false;window.__reylumiAndroidBack()});
      assert.equal(await page.locator('aside').count(),0);
      assert.deepEqual(await page.evaluate(()=>[window.clicked,window.escaped]),[0,2]);
      assert.equal(await page.locator('details').evaluate(e=>e.open),true);
      await page.evaluate(()=>{
        document.removeEventListener('keydown',window.authoredEscape);
        const unknown=document.createElement('aside');unknown.setAttribute('role','dialog');unknown.innerHTML='<input value="Unknown draft"><button>Submit payment</button>';
        unknown.querySelector('button').onclick=()=>window.clicked++;document.body.append(unknown);
        history.pushState({},'',location.pathname+'?draft=retained');window.historyBeforeBack=location.href;
        if(!window.__reylumiAndroidBack())history.back();
      });
      assert.equal(await page.locator('aside input').inputValue(),'Unknown draft');
      assert.equal(await page.evaluate(()=>location.href===window.historyBeforeBack),true);
      assert.deepEqual(await page.evaluate(()=>[window.clicked,window.escaped]),[0,2]);
      assert.equal(await page.locator('details').evaluate(e=>e.open),true);
      await page.locator('aside').evaluate(e=>e.remove());
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),false);
    }finally{await browser.close()}
  });
}
