import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const out=path.resolve('artifacts/booking-deposit-qa');fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{BookingDepositPanel}from'./app/market/booking-deposit-panel';createRoot(document.getElementById('app')).render(<BookingDepositPanel initial={{enabled:true,installed:true,testMode:true,active:true,subscribed:false,connected:false,mode:'fixed',value:20,checkout:'both'}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:path.join(out,'panel.js'),format:'iife',jsx:'automatic',plugins:[{name:'review-actions',setup(b){b.onResolve({filter:new RegExp("next/navigation$")},a=>({path:a.path,namespace:'navigation'}));b.onLoad({filter:/.*/,namespace:'navigation'},()=>({contents:'export function useRouter(){return {refresh(){}}}'}));b.onResolve({filter:/booking-deposit-actions$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`export async function loadBookingDepositAction(){return {}};export async function saveBookingDepositAction(state){return {state}};export async function installBookingDepositAction(installed){return {state:{installed}}};export async function connectBookingStripeAction(){return {error:'Review only'}};export async function bookingDepositBillingAction(){return {error:'Review only'}};`}));}}]});
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/panel.css"><style>*{box-sizing:border-box}body{margin:0;background:#f7f7f8;font-family:Arial,sans-serif;padding:20px}#app{max-width:900px;margin:20px auto}</style><div id="app"></div><script src="/panel.js"></script></html>');
const server=http.createServer((req,res)=>{const file=path.join(out,req.url==='/'?'index.html':path.basename(req.url));if(!fs.existsSync(file)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const browser=await chromium.launch({executablePath:executable,headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const reports=[];
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'Booking Deposit',exact:true}).waitFor();
  assert.equal(await page.getByRole('switch').isChecked(),true);
  await page.getByLabel('Payment amount',{exact:true}).selectOption('percent');
  await page.getByLabel('Deposit percentage').fill('25');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Booking payment settings saved.'}).waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  await page.screenshot({path:path.join(out,`${width}-settings.png`),fullPage:true});
  await page.getByRole('switch').uncheck();await page.getByRole('button',{name:'Save settings',exact:true}).click();assert.equal(await page.getByRole('switch').isChecked(),false);
  reports.push({width,overflow,savedPercentage:25,toggleOff:true});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({reports,errors},null,2));console.log(JSON.stringify({reports,errors}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}



