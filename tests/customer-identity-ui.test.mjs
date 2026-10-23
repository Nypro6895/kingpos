import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';

test('phone check-in shows masked choices, reuses selection and clears it when input changes',async()=>{
  const browserPath=process.env.TEST_BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  assert.ok(browserPath,'A local browser is required for this test');
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PhoneRelayCheckin} from './app/check-in/[entry]/phone-checkin';
    createRoot(document.getElementById('root')).render(<PhoneRelayCheckin entry="entry" salonName="King Nails" services={[{id:'service',name:'Manicure'}]} />);`,resolveDir:process.cwd(),loader:'tsx'},
    bundle:true,write:false,outdir:'artifacts/customer-identity-20261023/ui-fixture',format:'iife',jsx:'automatic',plugins:[{name:'fixture',setup(b){
      b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'fixture'}));
      b.onResolve({filter:/^\.\/actions$/},args=>args.importer.replaceAll('\\','/').includes('/app/check-in/')?{path:'actions',namespace:'fixture'}:null);
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='router'?`export const useRouter=()=>({replace:path=>window.destination=path});`:
        `export async function phoneRelayCheckin(input){window.calls??=[];window.calls.push(input);await new Promise(r=>setTimeout(r,30));if(input.identityChoice||input.newCustomer)return {pass:'confirmed'};return {error:'Choose your profile',candidates:[{id:'existing',label:'Nene',phoneHint:'••• 2876',reason:'Possible phone typo'}]};}`}));
    }}]});
  const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text ?? ''}body{font:16px Arial;margin:16px}label{display:block;margin:12px 0}input{box-sizing:border-box;max-width:100%;padding:10px}button{padding:12px;margin:4px;max-width:100%}section{display:grid}p{overflow-wrap:anywhere}</style><div id="root"></div><script>${bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}</script>`;
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:browserPath,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel('Name',{exact:true}).fill('ne');
    await page.getByLabel('Phone',{exact:true}).fill('9713722876');
    await page.getByLabel('Manicure').check();
    await page.getByRole('button',{name:'Check in',exact:true}).click();
    await page.getByRole('button',{name:/Nene/}).waitFor();
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true);
    mkdirSync('artifacts/customer-identity-20261023',{recursive:true});
    await page.screenshot({path:'artifacts/customer-identity-20261023/checkin-mobile.png',fullPage:true});
    await page.getByRole('button',{name:/Nene/}).click();
    await page.waitForFunction(()=>window.destination==='/visit/confirmed');
    assert.equal((await page.evaluate(()=>window.calls)).at(-1).identityChoice,'existing');
    await page.getByLabel('Name',{exact:true}).fill('Mary');
    assert.equal(await page.getByRole('button',{name:/Nene/}).count(),0);
    await page.getByRole('button',{name:'Check in',exact:true}).click();
    await page.getByRole('button',{name:/None of these/}).click();
    await page.waitForFunction(()=>window.calls.at(-1).newCustomer===true);
    assert.equal((await page.evaluate(()=>window.calls)).at(-1).identityChoice,undefined);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
