import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
test('staff photo is cached, survives offline remount, and is revalidated after reconnect', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH}, async()=>{
  const{build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const repo=resolve('.').replaceAll('\\','/');let requests=0;
  const {outputFiles}=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{StaffAvatar}from'${repo}/app/pos/portable/staff-avatar';function App(){const[on,setOn]=React.useState(true);return <><button onClick={()=>setOn(!on)}>Toggle</button>{on&&<StaffAvatar src="/photo.svg"/>}</>;}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:repo},jsx:'automatic',bundle:true,write:false});
  const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(outputFiles[0].text);}else if(req.url==='/photo.svg'){requests++;res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>');}else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try{const context=await browser.newContext(),page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('img')?.src.startsWith('blob:'));await context.setOffline(true);await page.getByText('Toggle',{exact:true}).click();await page.getByText('Toggle',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('img')?.src.startsWith('blob:')&&document.querySelector('img').naturalWidth===32);const before=requests;await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine);await page.waitForTimeout(500);assert.ok(requests>before);}
  finally{await browser.close();await new Promise(done=>server.close(done));}
});
