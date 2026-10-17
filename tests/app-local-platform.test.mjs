import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

async function moduleAt(file, globals={}) {
  const result=await build({entryPoints:[file],bundle:true,write:false,format:'cjs',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
  const module={exports:{}};
  vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,console,crypto:webcrypto,FormData,Blob,File,atob,btoa,URL,URLSearchParams,AbortController,AbortSignal,DOMException,setTimeout,clearTimeout,Response,Headers,Request,performance,...globals});
  return module.exports;
}
test('command codec preserves original form values and rejects prototype/tag/depth injection',async()=>{
  // FormData/Blob and JSON inputs deliberately share the server's object realm.
  const codec=await moduleAt('lib/app-local-command-codec.ts',{Object});
  const form=new FormData();form.append('amount','0');form.append('amount','24.50');form.append('notes','');form.append('evidence',new File(['hello'],'proof.txt',{type:'text/plain'}));
  const encoded=await codec.encodeAppLocalValue([undefined,0,false,form]);
  const decoded=codec.decodeAppLocalValue(JSON.parse(JSON.stringify(encoded)));
  assert.equal(decoded[0],undefined);assert.equal(decoded[1],0);assert.equal(decoded[2],false);
  assert.deepEqual(decoded[3].getAll('amount'),['0','24.50']);assert.equal(await decoded[3].get('evidence').text(),'hello');
  assert.throws(()=>codec.decodeAppLocalValue(JSON.parse('{"__proto__":{"isOwner":true}}')));
  assert.throws(()=>codec.decodeAppLocalValue({$reylumi:'undefined',extra:true}));
  assert.throws(()=>codec.decodeAppLocalValue(Array.from({length:1},()=>{let value=0;for(let n=0;n<18;n++)value=[value];return value;})));
});
test('native host accepts a freshly validated context epoch, rejects late old reads, and uses UUID fallback',async()=>{
  const metadata={version:1,nonce:'nonce-a',scopeEpoch:0,generation:'11111111-1111-4111-8111-111111111111'}, requests=[];
  const window={__reylumiAppLocalContext:metadata,__reylumiAppLocalTransport:{request:async request=>{requests.push(request);if(request.kind==='context'){const current={...metadata,nonce:'nonce-b',scopeEpoch:1};window.__reylumiAppLocalContext=current;return {host:current,context:{scope:'scope-b'}};}if(request.kind==='read'){window.__reylumiAppLocalContext={...window.__reylumiAppLocalContext,scopeEpoch:2};return {status:200,scope:'scope-b',data:{old:true}};}return null;}}};
  const host=await moduleAt('lib/app-local-host.ts',{window,crypto:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)}});
  const value=await host.getAppLocalHost().context('/pos');assert.equal(value.context.scope,'scope-b');
  assert.match(requests[0].id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  await assert.rejects(()=>host.getAppLocalHost().read('owner.check-in',{}, {scope:'scope-b'}),/account has changed/);
  assert.equal(requests.filter(row=>row.kind==='read').length,1);
});
test('failed web commands are attempted once and never become a cached success',async()=>{
  let attempts=0;const host=await moduleAt('lib/app-local-host.ts',{window:{},fetch:async()=>{attempts++;return Response.json({ok:false,error:'Could not confirm'},{status:503});}});
  await assert.rejects(()=>host.getAppLocalHost().command('action.test',{values:[]},{scope:'scope-a'}),/Could not confirm/);assert.equal(attempts,1);
});
test('only the exact logout acknowledgement may cross a native generation reset',async()=>{
  const initial={version:1,nonce:'before',scopeEpoch:1,generation:'before-generation-111111'},after={version:1,nonce:'after',scopeEpoch:2,generation:'after-generation-222222'};
  for(const sample of[{name:'shell.logout',signedOut:true,match:true,allowed:true},{name:'action.test',signedOut:true,match:true,allowed:false},{name:'shell.logout',signedOut:false,match:true,allowed:false},{name:'shell.logout',signedOut:true,match:false,allowed:false}]){
    const window={__reylumiAppLocalContext:initial,__reylumiAppLocalTransport:{request:async()=>{window.__reylumiAppLocalContext=after;return{signedOut:sample.signedOut,host:sample.match?after:initial,status:200,body:'{}'};}}};
    const module=await moduleAt('lib/app-local-host.ts',{window});
    const operation=module.getAppLocalHost().command(sample.name,{}, {scope:'scope-a'});
    if(sample.allowed)assert.equal((await operation).status,200);else await assert.rejects(operation,/account has changed/);
  }
});

const browserPath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('actual installed package renders full Help and Market before account/data requests complete', {skip:!existsSync(browserPath),timeout:60000},async()=>{
  const directory=path.resolve('ios/Reylumi/LocalAppBundle'),manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  assert.ok(manifest.help.slugs.length>10);
  assert.ok(!manifest.productionReady || manifest.coverage.missing.length===0,'An incomplete ordinary-route inventory cannot activate the primary runtime');
  assert.ok(manifest.coverage.online.length>0,'Reviewed HTTPS/admin exceptions are explicit, rather than reported as bundled pages');
  const held=new Set(),api=[];
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://test');
    if(url.pathname.startsWith('/api/')){api.push(url.pathname);held.add(response);response.on('close',()=>held.delete(response));return;}
    const relative=decodeURIComponent(url.pathname).slice(1),asset=manifest.files.find(file=>file.path===relative),file=asset?.path??manifest.entry;
    if(relative.includes('..')||relative.includes('\\')){response.writeHead(400);response.end();return;}
    response.setHeader('Content-Type',asset?.mime??'text/html');response.end(await readFile(path.join(directory,file)));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:browserPath,headless:true}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    await page.goto(origin+'/help?lang=en',{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'Reylumi Help',exact:true}).waitFor();assert.equal(api.length,0);
    await page.locator('a[href="/help/overview?lang=en"]').first().click();
    await page.getByRole('heading',{name:'Start with Reylumi',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Detailed walkthroughs',exact:true}).waitFor();assert.equal(api.length,0);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path:'/market'}})));
    await page.getByRole('heading',{name:'Market',exact:true}).waitFor();
    await page.getByRole('button',{name:/Vietnamese|Booking|Pay/i}).first().waitFor();
    assert.ok(api.includes('/api/app-local/context'),'The account read remains pending while real Market content is visible');
    const marketNode=await page.locator('[data-app-local-ready]').evaluate(node=>{window.__firstMarket=node.querySelector('main');return !!window.__firstMarket;});assert.ok(marketNode);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path:'/help?lang=en'}})));
    await page.getByRole('heading',{name:'Reylumi Help',exact:true}).waitFor();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path:'/market'}})));
    assert.ok(await page.evaluate(()=>window.__firstMarket?.isConnected),'The actual Market view stays mounted across navigation');
    assert.deepEqual(errors,[]);
    await mkdir('artifacts/app-local-platform-20261016',{recursive:true});await page.screenshot({path:'artifacts/app-local-platform-20261016/installed-market.png'});
    assert.ok((await stat(path.join(directory,'app.css'))).size>30000);
  }finally{await browser.close();for(const response of held)response.destroy();await new Promise(resolve=>server.close(resolve));}
});
