import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

test('customer list automatically drains batches and exposes retry after failure',async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AutomaticCustomerMerge} from './app/customers/automatic-customer-merge';createRoot(document.getElementById('root')).render(<AutomaticCustomerMerge salonId="salon"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/^\.\/actions$/},()=>({path:'actions',namespace:'fixture'}));
    b.onResolve({filter:/^@\/components\/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='language'?`export function WorkspaceText({text}){return text}`:`export async function automaticallyConsolidateCustomers(){window.calls=(window.calls||0)+1;return window.calls===1?{merged:100,error:null}:window.calls===2?{merged:0,error:'Automatic customer merge could not finish. Please retry.'}:{merged:1,error:null}}`}));
  }}]});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:'Retry'}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls),2);
    await page.getByRole('button',{name:'Retry'}).click();
    await page.waitForFunction(()=>window.calls===3 && !document.querySelector('[role=status]'));
    assert.equal(await page.evaluate(()=>window.calls),3);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
