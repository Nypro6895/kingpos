import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
test('saved ticket switch keeps customer ownership, supports Cancel/Save/Reset, and preserves work on storage failure; touch service keyboard', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH, timeout:60000}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const root=resolve('.').replaceAll('\\','/');
 const bundle=await build({stdin:{contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{PortableDraftControls}from'${root}/app/pos/portable/portable-draft-controls';
 import{CustomServiceDialog}from'${root}/app/pos/custom-service-dialog';
 const key='kingpos:parked-tickets:v1:test';
 localStorage.setItem(key,JSON.stringify([{id:'saved-a',at:1,label:'Guest A',value:{name:'Guest A',visit:'visit-a'}}]));
 const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(window.failSave)throw Error('disk full');return original.call(this,k,v);};
 function App(){const[value,setValue]=useState({name:'Guest B',visit:'visit-b'});const[custom,setCustom]=useState(false);const[service,setService]=useState('');return <><p data-current>{value.name}</p><p data-service>{service}</p><PortableDraftControls scope="test" active={!!value.name} activity={value.name} value={value} label={value.name} reset={async()=>{setValue({name:'',visit:''});return true;}} restore={v=>{if(window.failRestore)return false;setValue(v);return true;}} onSavedChange={values=>{window.savedVisits=values.map(v=>v.visit);}}/><button onClick={()=>setCustom(true)}>Custom services</button>{custom&&<CustomServiceDialog onCancel={()=>setCustom(false)} onDone={name=>{setService(name);setCustom(false);}}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:root},jsx:'automatic',bundle:true,write:false,platform:'browser'});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const open=async label=>{await page.getByRole('button',{name:/^Saved tickets/}).click();await page.getByRole('button',{name:new RegExp('^'+label)}).click();await page.getByRole('dialog',{name:'Open saved ticket',exact:true}).waitFor();};
 await open('Guest A');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('[data-current]').innerText(),'Guest B');
 await open('Guest A');await page.evaluate(()=>window.failSave=true);await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-current]').innerText(),'Guest B');
 await page.evaluate(()=>window.failSave=false);await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-current]').textContent==='Guest A');await page.waitForFunction(()=>JSON.stringify(window.savedVisits)==='["visit-b"]');
 await open('Guest B');await page.getByRole('button',{name:'Reset',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-current]').textContent==='Guest B');await page.waitForFunction(()=>window.savedVisits.length===0);
 await page.getByRole('button',{name:'Save for later',exact:true}).click();await page.waitForFunction(()=>window.savedVisits[0]==='visit-b');assert.equal(await page.locator('[data-current]').innerText(),'');
 await page.getByRole('button',{name:'Custom services',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Custom service',exact:true});assert.equal(await dialog.getByRole('button',{name:'Done',exact:true}).isEnabled(),false);
 for(const key of ['N','a','i','l','Space','a','r','t'])await dialog.getByRole('button',{name:key,exact:true}).click();
 assert.equal(await page.getByLabel('Service name',{exact:true}).inputValue(),'Nail art');await dialog.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await page.locator('[data-service]').innerText(),'Nail art');
 await page.getByRole('button',{name:'Custom services',exact:true}).click();await page.getByLabel('Service name',{exact:true}).fill('Discard me');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('[data-service]').innerText(),'Nail art');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
