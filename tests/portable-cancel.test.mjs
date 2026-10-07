import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('rejected ticket cancellation: confirmation, persistence, no replay, isolation and uncertain upload guard', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:60000}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const root=resolve('.').replaceAll('\\','/');
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import*as ops from '${root}/lib/portable-operations';import{PortableSyncIndicator}from'${root}/app/pos/portable/portable-sync-indicator';window.ops=ops;createRoot(document.getElementById('root')).render(<PortableSyncIndicator scope="test"/>);`},jsx:'automatic',bundle:true,write:false,platform:'browser'});
 const requests=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/api/pos/connection'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({available:true}));return;}
  if(req.url==='/api/pos/portable/operations'){
   let body='';for await(const chunk of req)body+=chunk;const op=JSON.parse(body);requests.push(op.id);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(op.payload.reject?{kind:'blocked',message:'Assigned staff must be checked in and working.'}:{kind:'ok',data:{ticketId:op.id}}));return;
  }
  res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  const id=await page.evaluate(async()=>{const op=await window.ops.savePortableOperation('test','receipt',{reject:true,localDraftKey:'cart',customerName:'Test customer',lines:[{total:50}]});await window.ops.syncPortableOperations('test');return op.id;});
  await page.getByRole('button',{name:'Not synced',exact:true}).click();await page.getByRole('button',{name:'Cancel ticket',exact:true}).click();
  await page.getByRole('button',{name:'Keep ticket',exact:true}).click();
  assert.equal(await page.evaluate(async()=> (await window.ops.listPortableOperations('test'))[0].state),'attention');
  await page.getByRole('button',{name:'Not synced',exact:true}).click();await page.getByRole('button',{name:'Cancel ticket',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel ticket',exact:true}).click();
  await page.waitForFunction(async()=> (await window.ops.listPortableOperations('test'))[0].state==='cancelled');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.reload();await page.evaluate(()=>window.ops.syncPortableOperations('test'));
  await page.evaluate(id=>window.ops.retryPortableOperation('test',id),id);
  assert.deepEqual(requests,[id]);
  await assert.rejects(page.evaluate(id=>window.ops.cancelPortableOperation('other',id),id));
  assert.ok(await page.evaluate(()=>window.ops.portableCheckpoint('test','cart')));
  await page.context().setOffline(true);
  const pending=await page.evaluate(()=>window.ops.savePortableOperation('test','receipt',{lines:[{total:60}]}));
  await assert.rejects(page.evaluate(id=>window.ops.cancelPortableOperation('test',id),pending.id));
  await page.context().setOffline(false);await page.evaluate(()=>window.ops.syncPortableOperations('test'));
  await assert.rejects(page.evaluate(id=>window.ops.cancelPortableOperation('test',id),pending.id));
  assert.deepEqual(requests,[id,pending.id]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
