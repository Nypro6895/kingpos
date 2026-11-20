import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import {chromium} from 'playwright-core';
import {adjustments,fixturePlugin,ownerTicket,portableTicket,props} from './helpers/ticket-correction-history-fixture.mjs';

const out='artifacts/history-notification-clarity/raw-ticket-history-browser';fs.mkdirSync(out,{recursive:true});
const all=adjustments(),data={
 initial:[{...ownerTicket(),adjustments:all.slice(0,2)},await portableTicket(all.slice(0,2))],
 changes:[{...ownerTicket(),adjustments:all},await portableTicket(all)],
};
const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{DailyPosTicketCard}from'./app/pos-tickets/closed-ticket-correction-form';
const data=${JSON.stringify(data)},props=${JSON.stringify(props)};
const mode=new URLSearchParams(location.search).get('mode')||'changes';
createRoot(document.getElementById('root')).render(<main><h1>Ticket history · Local fixture</h1>{data[mode].map((ticket,index)=><section data-lane={index?'portable':'owner'} key={index}><h2>{index?'Portable ticket':'Owner ticket'}</h2><DailyPosTicketCard {...props} ticket={ticket} actions={{correctClosedTicket:async()=>{}}}/></section>)}</main>);`;
const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',outfile:'fixture.js',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents},plugins:[fixturePlugin]});
const compiler=await compile('@import "tailwindcss";',{base:process.cwd(),onDependency(){}});
const style=compiler.build(fs.readFileSync('app/pos-tickets/closed-ticket-correction-form.tsx','utf8').split(/[\s"'`<>={}]+/))+bundle.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n');
const script=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const server=createServer((req,res)=>{
 const isScript=req.url==='/fixture.js';res.setHeader('Content-Type',isScript?'text/javascript':'text/html; charset=utf-8');
 res.end(isScript?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style+'body{margin:0;background:#fff;color:#222;font:14px Arial,sans-serif}main{max-width:960px;margin:auto;padding:12px}h1{font-size:18px;margin-bottom:16px}h2{font-size:14px;margin:12px 0}section{margin-bottom:20px}</style><div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const checks=[];
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const width of [320,390,1280])for(const mode of ['initial','changes']){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);await page.locator('[data-lane="portable"]').waitFor();
  for(const lane of ['owner','portable']){
   const card=page.locator(`[data-lane="${lane}"]`),text=await card.innerText();assert.match(text,/Manicure/);assert.match(text,/\$60\.00/);assert.match(text,/\$10\.00/);
   assert.ok(!text.includes('should be hidden'));assert.ok(!text.includes('00000000-0000-4000-8000-'));
   if(mode==='initial'){assert.ok(!text.includes('Edited'));assert.ok(!text.includes('Correction History'));}
   else{assert.match(text,/Edited · 2/);await card.locator('details>summary').first().click();const expanded=await card.innerText();assert.match(expanded,/After-submit price correction/);assert.match(expanded,/Legacy correction retained/);assert.match(expanded,/\$50\.00/);}
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'read-view overflow '+width);
  if(width<500){
   const card=page.locator('[data-lane="owner"]');await card.getByRole('button',{name:'Edit',exact:true}).click();
   await card.getByRole('button',{name:'Save',exact:true}).waitFor();const text=await card.innerText();assert.ok(!text.includes('should be hidden'));
   assert.equal(text.includes('Correction History'),false);assert.equal(text.includes('After-submit price correction'),mode==='changes');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'edit-view overflow '+width);
  }
  await page.screenshot({path:`${out}/${mode}-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);
  checks.push({width,mode,ownerAndPortable:true,correctHistoryVisibility:true,currentServiceAndTipPreserved:true,noTechnicalIds:true,overflow:false,editViewChecked:width<500});await page.close();
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify({passed:true,layer:'Actual DailyPosTicketCard; Portable uses actual normalization and mapping; isolated mocked save; no hosted data.',checks},null,2));console.log(JSON.stringify({passed:true,checks}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
