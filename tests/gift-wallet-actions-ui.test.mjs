import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('Compact Wallet focused actions preserve transfer consent, rotation and retry recovery',async t=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {CustomerGiftCards} from './components/gift-card/customer-gift-cards';
  import {defaultGiftDesign} from './types/gift-card';
  const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
  const card={id:'qa-card',salonId:'qa-salon',salonName:'Synthetic wallet salon',balance:10000,last4:'AA91',status:'active',design:defaultGiftDesign('Synthetic wallet salon'),generation:1};
  let generation=1,walletTransfers=0,publicTransfers=0,lost=false,shared=0;const replay=new Map();
  window.calls=[];window.effects=[];window.writes=[];window.offset=0;const realNow=Date.now;Date.now=()=>realNow()+window.offset;
  const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){window.writes.push({key,value});return originalSet.call(this,key,value);};
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.effects.push({kind:'share',...data});shared++;if(scenario==='cancel'&&shared===1)throw new DOMException('Synthetic cancellation','AbortError');if(scenario==='shareFailure'&&shared===1)throw Error('Synthetic share failure');}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.effects.push({kind:'clipboard',value})}});
  HTMLAnchorElement.prototype.click=function(){window.effects.push({kind:'anchor',href:this.href,download:this.download});};
  const result=()=>({card:{...card,generation,last4:'AA91',pendingTransfer:generation===2},token:String(generation).repeat(64),code:'AABBCCDDEEFF0011',pin:'11223344'});
  window.fetch=async(url,options)=>{
   const call=JSON.parse(options.body);window.calls.push(call);const {scope,op,args}=call;let data={};
   if(scope==='wallet'&&op==='list')data={cards:generation<3?[{...card,generation,pendingTransfer:generation===2}]:scenario==='reclaimed'?[{...card,generation:generation+1}]:[]};
   else if(scope==='wallet'&&op==='present'){
    if(scenario==='useDelayed')await new Promise(resolve=>window.releasePresent=resolve);
    data={code:'ABCDEF0123456789',pin:'ABCD1234',token:'p'.repeat(64),message:'One checkout only. Code expires in 2 minutes.',card};
   }else if(scope==='wallet'&&op==='history')data={ledger:[{id:'ledger-1',kind:'issue',delta:10000,at:'2026-11-13T12:00:00Z'}]};
   else if(op==='transfer'){
    const key=scope+':'+args.requestId;
    if(replay.has(key))data=replay.get(key);
    else{generation++;data=result();replay.set(key,data);if(scope==='wallet')walletTransfers++;else publicTransfers++;}
    window.counts={walletTransfers,publicTransfers};
    if(!lost&&((scenario==='walletLost'||scenario==='malformedInitial')&&scope==='wallet'||scenario==='publicLost'&&scope==='public')){
     lost=true;if(scenario==='malformedInitial')data={};else throw Error('Synthetic lost response');
    }
   }else throw Error('Unexpected operation '+scope+':'+op);
   return {ok:true,json:async()=>data};
  };
  createRoot(document.getElementById('root')).render(<CustomerGiftCards/>);
 `},bundle:true,write:false,format:'iife',outfile:'fixture.js',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
 const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':req.url==='/fixture.css'?'text/css':'text/html');res.end(req.url==='/fixture.js'?js:req.url==='/fixture.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH,headless:true}:{channel:'chrome',headless:true});
 const errors=[];
 async function open(scenario='normal',width=390){const page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/?scenario='+scenario);await page.getByRole('button',{name:'Transfer',exact:true}).waitFor();return page;}
 async function transfer(page){await page.getByRole('button',{name:'Transfer',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Transfer gift card',exact:true});await dialog.waitFor();return dialog;}
 const mutations=page=>page.evaluate(()=>window.calls.filter(call=>call.op==='transfer'));
 try{
  await t.test('320/390 cards and focused sheets fit; opening/canceling never transfers',async()=>{
   for(const width of [320,390]){const page=await open('normal',width);try{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const thumbnail=await page.locator('.gw-card .gw-art').boundingBox();for(const element of await page.locator('.gw-card .gc-element').all()){const box=await element.boundingBox();assert.ok(box.x>=thumbnail.x-1&&box.y>=thumbnail.y-1&&box.x+box.width<=thumbnail.x+thumbnail.width+1&&box.y+box.height<=thumbnail.y+thumbnail.height+1,'legacy text and logo must scale into the thumbnail');}
    for(const button of await page.locator('.gw-card button').all())assert.ok((await button.boundingBox()).height>=44);
    const opener=page.getByRole('button',{name:'Transfer',exact:true}),dialog=await transfer(page);
    assert.equal(await dialog.getByRole('button',{name:'Close transfer gift card',exact:true}).evaluate(button=>button===document.activeElement),true);
    await dialog.getByRole('button',{name:'Email',exact:true}).click();await dialog.getByRole('textbox',{name:'Recipient email',exact:true}).fill('bad');
    await dialog.getByRole('button',{name:'Create transfer & email',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.deepEqual(await mutations(page),[]);
    assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
    for(const button of await dialog.getByRole('button').all())assert.ok((await button.boundingBox()).height>=44);
    await dialog.getByRole('button',{name:'Keep my card',exact:true}).click();assert.equal(await opener.evaluate(button=>button===document.activeElement),true);assert.deepEqual(await mutations(page),[]);
    await page.getByRole('button',{name:'History',exact:true}).click();const history=page.getByRole('dialog',{name:'Card history',exact:true});await history.getByText('issue',{exact:false}).waitFor();
    await history.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await page.getByRole('button',{name:'History',exact:true}).evaluate(button=>button===document.activeElement),true);
   }finally{await page.close();}}
  });
  await t.test('Use keeps temporary code/PIN semantics and conservative expiry without public bearer QR',async()=>{
   const page=await open('useDelayed');try{await page.getByRole('button',{name:'Use at salon',exact:true}).click();await page.waitForFunction(()=>typeof window.releasePresent==='function');await page.evaluate(()=>{window.offset=121000;window.releasePresent();});
    const use=page.getByRole('dialog',{name:'Show at checkout',exact:true});await use.getByText('Checkout code expired.',{exact:false}).waitFor();assert.equal(await use.locator('svg').count(),0);assert.equal(await use.getByText('PIN: ABCD1234',{exact:true}).count(),0);assert.deepEqual(await mutations(page),[]);
    await use.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Use at salon',exact:true}).click();await page.waitForFunction(()=>window.calls.filter(call=>call.op==='present').length===2);await page.evaluate(()=>window.releasePresent());
    await use.getByText('PIN: ABCD1234',{exact:true}).waitFor();await use.getByText('One checkout only. Code expires in 2 minutes.',{exact:true}).waitFor();
   }finally{await page.close();}
  });
  await t.test('Share cancellation retains latest code and local entry; retry rotates only the public export',async()=>{
   const page=await open('cancel');try{let dialog=await transfer(page);await dialog.getByRole('button',{name:'Create transfer & share',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Sharing canceled'}).waitFor();await dialog.getByRole('img',{name:'Current gift transfer',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.counts),{walletTransfers:1,publicTransfers:1});assert.deepEqual((await mutations(page)).map(call=>call.scope),['wallet','public']);
    await dialog.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await page.getByText('No cards yet.',{exact:false}).count(),0);await page.getByRole('button',{name:'Continue transfer',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Transfer',exact:true}).count(),0,'Continue transfer replaces the duplicate secondary action');
    await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='Continue transfer');
    assert.equal(await page.getByRole('button',{name:'Continue transfer',exact:true}).evaluate(button=>button===document.activeElement),true);
    await page.getByRole('button',{name:'Continue transfer',exact:true}).click();dialog=page.getByRole('dialog',{name:'Transfer gift card',exact:true});await dialog.getByRole('img',{name:'Current gift transfer',exact:true}).waitFor();assert.equal((await mutations(page)).length,2);
    await dialog.getByRole('button',{name:'Create transfer & share',exact:true}).click();await dialog.getByText('Share completed.',{exact:false}).waitFor();assert.deepEqual(await page.evaluate(()=>window.counts),{walletTransfers:1,publicTransfers:2});
    const calls=await mutations(page);assert.equal(calls[1].token,'2'.repeat(64));assert.equal(calls[2].token,'3'.repeat(64));assert.notEqual(calls[1].args.requestId,calls[2].args.requestId);
    assert.deepEqual(await page.evaluate(()=>window.writes),[],'bearer credentials must stay out of storage');
   }finally{await page.close();}
  });
  await t.test('Uncertain wallet/public responses replay stable IDs and malformed initial response is recoverable',async()=>{
   for(const scenario of ['walletLost','publicLost','malformedInitial']){const page=await open(scenario);try{const dialog=await transfer(page);await dialog.getByRole('button',{name:'Create transfer & share',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByRole('img',{name:'Current gift transfer',exact:true}).count(),0);await dialog.getByRole('button',{name:'Create transfer & share',exact:true}).click();await dialog.getByText('Share completed.',{exact:false}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.counts),{walletTransfers:1,publicTransfers:1});const scope=scenario==='publicLost'?'public':'wallet';const attempts=(await mutations(page)).filter(call=>call.scope===scope);assert.equal(attempts.length,2);assert.equal(attempts[0].args.requestId,attempts[1].args.requestId);assert.equal(attempts[0].token,attempts[1].token);
   }finally{await page.close();}}
  });
  await t.test('Failed share keeps recoverable code; Save/Email are explicit exports with mocked native effects',async()=>{
   for(const method of ['share','save','email']){const page=await open(method==='share'?'shareFailure':'normal');try{const dialog=await transfer(page);if(method==='save')await dialog.getByRole('button',{name:'Save image',exact:true}).click();if(method==='email'){await dialog.getByRole('button',{name:'Email',exact:true}).click();await dialog.getByRole('textbox',{name:'Recipient email',exact:true}).fill('recipient@example.com');}
    await dialog.getByRole('button',{name:method==='save'?'Create transfer & save image':'Create transfer & '+method,exact:true}).click();
    if(method==='share'){await dialog.getByRole('alert').waitFor();await dialog.getByRole('img',{name:'Current gift transfer',exact:true}).waitFor();}else await dialog.getByText(method==='save'?'New card image saved.':'Email draft opened.',{exact:false}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.counts),{walletTransfers:1,publicTransfers:1});const effects=await page.evaluate(()=>window.effects);if(method==='save')assert.ok(effects.some(effect=>effect.download==='reylumi-gift-card.png'));if(method==='email')assert.ok(effects.some(effect=>effect.href.startsWith('mailto:recipient%40example.com')));
   }finally{await page.close();}}
  });
  await t.test('A card claimed back at a newer generation restores Use instead of stale Continue transfer',async()=>{
   const page=await open('reclaimed');try{const dialog=await transfer(page);await dialog.getByRole('button',{name:'Create transfer & share',exact:true}).click();await dialog.getByText('This card is back in your wallet.',{exact:false}).waitFor();await dialog.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Use at salon',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Continue transfer',exact:true}).count(),0);
   }finally{await page.close();}
  });
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
