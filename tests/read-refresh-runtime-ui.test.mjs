import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

test('read owners share wake freshness, queue real changes during a read, and detach on Activity hide', { timeout: 60_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';
    import{useExperienceResource}from'./lib/use-experience-resource';
    import{useLiveExperienceRefresh}from'./lib/use-live-experience-refresh';
    import{usePosResourceRefresh}from'./lib/pos-workspace-sync';
    import{experienceResourceCache}from'./lib/experience-resource-cache';
    window.cache=experienceResourceCache;window.calls=[];window.posCalls=[];window.initialCalls=[];
    window.finishes=[];window.rejects=[];window.posFinishes=[];window.posRejects=[];window.emitBurst=()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('reylumi:foreground'))};
    let visible='visible',online=true;Object.defineProperty(document,'visibilityState',{get:()=>visible,configurable:true});Object.defineProperty(navigator,'onLine',{get:()=>online,configurable:true});
    window.setVisible=value=>{visible=value;document.dispatchEvent(new Event('visibilitychange'))};window.setOnline=value=>{online=value;window.dispatchEvent(new Event(value?'online':'offline'))};
    const resources=['tickets','staff'];const seedAt=Date.now();
    function Resource(){const result=useExperienceResource({scope:'account-a',key:'today',tags:resources,initialData:{value:'seed'},initialUpdatedAt:seedAt,freshForMs:10000,
      fetcher:()=>new Promise((resolve,reject)=>{window.calls.push('GET');window.finishes.push(value=>resolve({data:{value}}));window.rejects.push(reject)})});
      useLiveExperienceRefresh('salon',resources,result.refresh,true,{automaticRefresh:result.ensureFresh});window.manual=result.refresh;
      return <output>{result.data?.value??'hidden'}</output>}
    function Pos(){usePosResourceRefresh('salon','booking',ids=>new Promise((resolve,reject)=>{window.posCalls.push(ids??'full');window.posFinishes.push(resolve);window.posRejects.push(reject)}),{initialReconcile:false,snapshotAt:seedAt,freshForMs:10000});return null}
    function Initial(){usePosResourceRefresh('initial-salon','staff',async()=>{window.initialCalls.push('GET')});return null}
    function App(){const[shown,setShown]=useState(true);window.show=setShown;return <><button onClick={()=>setShown(value=>!value)}>Toggle</button><Activity mode={shown?'visible':'hidden'}><Resource/><Pos/><Initial/></Activity></>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: 'bundle.js', bundle: true, write: false, jsx: 'automatic', format: 'iife', banner: { js: 'let testNow=Date.now();Date.now=()=>testNow;window.advance=ms=>testNow+=ms;' }, alias: { '@': process.cwd() }, plugins: [{ name: 'local-realtime', setup(build) {
    build.onResolve({ filter: /supabase\/browser$/ }, () => ({ path: 'realtime', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
      const channels=new Map();window.emitChange=(salonId,resource,ids)=>channels.get('pos-staff:'+salonId)?.({payload:{salonId,resource,ids}});
      window.reconnect=salonId=>window.statuses.get('pos-staff:'+salonId)?.('SUBSCRIBED');window.statuses=new Map();
      export function createSupabaseBrowserClient(){return{channel(name){let receive;return{on(_type,{event},callback){if(event==='workspace_changed')receive=callback;return this},subscribe(callback){channels.set(name,receive);window.statuses.set(name,callback);callback('SUBSCRIBED');return this}}},removeChannel(){}}}
    ` }));
  } }] });
  const js = result.outputFiles[0].text;
  const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html'); response.end(request.url === '/bundle.js' ? js : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const engine = process.env.TEST_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
  const browser = await engine.launch(engine === webkit ? { headless: true } : { args: ['--no-proxy-server'], executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome', headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.initialCalls?.length === 1);
    await page.evaluate(() => window.emitBurst()); await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length, window.initialCalls.length]), [0, 0, 1], 'fresh foreground does not force duplicate reads');
    await page.evaluate(() => { window.advance(11000); window.emitBurst(); });
    await page.waitForFunction(() => window.calls.length === 1 && window.posCalls.length === 1);
    await page.evaluate(() => { window.emitBurst(); window.emitChange('salon','staff'); window.emitChange('salon','booking',['11111111-1111-4111-8111-111111111111']); window.emitChange('salon','booking',['22222222-2222-4222-8222-222222222222']); });
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length]), [1, 1]);
    await page.evaluate(() => { window.finishes[0]('current'); window.posFinishes[0](); });
    await page.waitForFunction(() => window.calls.length === 2 && window.posCalls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.posCalls[1]), ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'], 'data-change IDs arriving during a full read survive as one follow-up');
    await page.evaluate(() => { window.finishes[1]('newer'); window.posFinishes[1](); });
    await page.getByText('newer', { exact: true }).waitFor();
    await page.evaluate(() => window.emitBurst()); await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length]), [2, 2]);
    await page.evaluate(() => { window.setOnline(false); window.advance(11000); window.emitChange('salon','tickets'); window.emitChange('salon','booking'); window.emitBurst(); });
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length]), [2, 2], 'offline hints do not start GETs');
    await page.evaluate(() => window.setOnline(true));
    await page.waitForFunction(() => window.calls.length === 3 && window.posCalls.length === 3);
    await page.evaluate(() => { window.finishes[2]('online'); window.posFinishes[2](); }); await page.getByText('online', { exact: true }).waitFor();
    await page.evaluate(() => { window.setVisible('hidden'); window.advance(11000); window.emitChange('salon','tickets'); window.emitChange('salon','booking'); window.emitBurst(); });
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length]), [3, 3], 'hidden hints wait for the visible route');
    await page.evaluate(() => window.setVisible('visible'));
    await page.waitForFunction(() => window.calls.length === 4 && window.posCalls.length === 4);
    await page.evaluate(() => { window.finishes[3]('visible'); window.posFinishes[3](); }); await page.getByText('visible', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Toggle' }).click();
    await page.evaluate(() => window.emitBurst()); await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length]), [4, 4], 'Activity cleanup detaches operational reads');
    const initialBeforeReturn = await page.evaluate(() => window.initialCalls.length);
    await page.getByRole('button', { name: 'Toggle' }).click(); await page.getByText('visible', { exact: true }).waitFor();
    await page.evaluate(() => window.emitBurst()); await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length, window.initialCalls.length]), [4, 4, initialBeforeReturn], 'returning fresh does not repeat initial reconciliation');
    await page.evaluate(() => { void window.manual(); });
    await page.waitForFunction(() => window.calls.length === 5);
    await page.evaluate(() => window.finishes[4]('manual')); await page.getByText('manual', { exact: true }).waitFor();
    await page.evaluate(() => { window.emitChange('salon','booking',['11111111-1111-4111-8111-111111111111']); window.reconnect('salon'); });
    await page.waitForFunction(() => window.calls.length === 6 && window.posCalls.length === 5);
    assert.equal(await page.evaluate(() => window.posCalls[4]), 'full', 'reconnect forces a full repair even with a fresh snapshot and batched IDs');
    await page.evaluate(() => { window.finishes[5]('reconnected'); window.posFinishes[4](); }); await page.getByText('reconnected', { exact: true }).waitFor();
    await page.evaluate(() => { window.advance(11000); window.emitBurst(); });
    await page.waitForFunction(() => window.calls.length === 7 && window.posCalls.length === 6);
    await page.evaluate(() => { window.rejects[6](new Error('weak network')); window.posRejects[5](new Error('weak network')); });
    await page.waitForTimeout(50);
    await page.evaluate(() => { window.emitBurst(); window.emitBurst(); }); await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length]), [7, 6], 'a failed automatic read has a cooldown instead of a wake retry loop');
    assert.equal(await page.locator('output').textContent(), 'reconnected', 'temporary failure preserves the last authorized view');
    await page.evaluate(() => { window.advance(3100); window.emitBurst(); });
    await page.waitForFunction(() => window.calls.length === 8 && window.posCalls.length === 7);
    await page.evaluate(() => { window.finishes[7]('recovered'); window.posFinishes[6](); }); await page.getByText('recovered', { exact: true }).waitFor();
    await page.evaluate(() => { window.emitChange('salon','staff'); window.emitChange('salon','booking',['11111111-1111-4111-8111-111111111111']); });
    await page.waitForFunction(() => window.calls.length === 9 && window.posCalls.length === 8);
    await page.evaluate(() => { window.emitChange('salon','staff'); window.emitChange('salon','booking',['22222222-2222-4222-8222-222222222222']); });
    await page.getByRole('button', { name: 'Toggle' }).click();
    await page.getByRole('button', { name: 'Toggle' }).click();
    await page.evaluate(() => window.emitBurst()); await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [window.calls.length, window.posCalls.length]), [9, 8], 'Activity reentry joins a still-running GET');
    await page.evaluate(() => { window.finishes[8]('crossing'); window.posFinishes[7](); });
    await page.waitForFunction(() => window.calls.length === 10 && window.posCalls.length === 9);
    assert.deepEqual(await page.evaluate(() => window.posCalls[8]), ['22222222-2222-4222-8222-222222222222'], 'a known mutation queued before hiding survives the return');
    await page.evaluate(() => { window.finishes[9]('returned'); window.posFinishes[8](); }); await page.getByText('returned', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
