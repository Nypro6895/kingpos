import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('Gift paid returns load the wallet after status and preserve bearer receipts when wallet access fails',async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {CustomerGiftCards} from './components/gift-card/customer-gift-cards';
  import {defaultGiftDesign} from './types/gift-card';
  const scenario=new URLSearchParams(location.search).get('scenario');
  const card={id:'qa-card',salonId:'qa-salon',salonName:'Synthetic return salon',balance:10000,last4:'1234',status:'active',design:defaultGiftDesign('Synthetic return salon'),generation:1};
  window.calls=[];
  const statusReady=new Promise(resolve=>window.releaseStatus=resolve);
  const transport=async(op)=>{
   window.calls.push(op+':start');
   if(op==='status'){
    await statusReady;window.calls.push('status:done');
    return scenario==='guest'?{card,token:'synthetic-bearer-token',code:'TESTCARD1234',pin:'1234',message:'Your synthetic gift receipt is ready.'}:{message:'Gift card is in your wallet.'};
   }
   if(op==='list'){
    if(scenario==='guest')throw Error('Sign in to use your wallet.');
    if(scenario==='failure')throw Error('Your wallet could not be loaded.');
    window.calls.push('list:done');return{cards:scenario==='empty'?[]:[card]};
   }
   throw Error('Unexpected financial mutation '+op);
  };
  createRoot(document.getElementById('root')).render(<CustomerGiftCards transport={transport}/>);
 `},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
 const js=bundle.outputFiles[0].text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?js:'<!doctype html><div id="root"></div><script src="/fixture.js"></script>')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH,headless:true}:{channel:'chrome',headless:true});
 try{
  for(const scenario of ['paid','guest','failure','empty']){
   const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.goto(origin+'/?order=synthetic-order&scenario='+scenario);
    await page.waitForFunction(()=>window.calls.includes('status:start'));
    assert.deepEqual(await page.evaluate(()=>window.calls),['status:start'],'wallet must wait for status fulfillment');
    await page.evaluate(()=>window.releaseStatus());
    if(scenario==='paid'){
     await page.getByText('•••• 1234 · active',{exact:true}).waitFor({timeout:3000});
     assert.equal(await page.getByText('No cards yet.',{exact:false}).count(),0);
    }else if(scenario==='guest'){
     await page.getByText('PIN: 1234',{exact:true}).waitFor({timeout:3000});
     await page.getByRole('alert').filter({hasText:'Sign in to use your wallet.'}).waitFor({timeout:3000});
     assert.equal(await page.getByText('Your synthetic gift receipt is ready.',{exact:true}).count(),1);
     assert.equal(await page.getByText('No cards yet.',{exact:false}).count(),0);
    }else if(scenario==='failure'){
     await page.getByRole('alert').filter({hasText:'Your wallet could not be loaded.'}).waitFor({timeout:3000});
     assert.equal(await page.getByText('Gift card is in your wallet.',{exact:true}).count(),1);
     assert.equal(await page.getByText('No cards yet.',{exact:false}).count(),0);
    }else{
     await page.getByText('No cards yet.',{exact:false}).waitFor({timeout:3000});
    }
    const calls=await page.evaluate(()=>window.calls);
    assert.ok(calls.indexOf('status:done')<calls.indexOf('list:start'));
    assert.ok(calls.every(call=>/^(status|list):/.test(call)),'opening a receipt must not initiate buy, claim or transfer');
    assert.deepEqual(errors,[]);
   }finally{await page.close()}
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
});
