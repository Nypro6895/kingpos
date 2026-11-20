import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

/** Keeps the SQL suite's original real discover/program/owner/setup callbacks.
 * No synthetic marketing records substitute for those database-backed reads.
 */
export async function checkRewardFeedRpcUI({discover,program,owner,setup,output='artifacts/reward-experience-v4/feed-rpc-ui'}={}) {
 if(typeof discover!=='function'||typeof program!=='function')throw Error('Real RPC UI acceptance requires discover and program callbacks.');
 fs.mkdirSync(output,{recursive:true});
 const result=await build({entryPoints:['tests/helpers/reward-local-discovery-ui.tsx'],bundle:true,write:false,outdir:'bundle',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'rpc-fixture-adapters',setup(b){
  b.onResolve({filter:/^next\/(link|image)$/},args=>({path:args.path.slice(5),namespace:'adapter'}));
  b.onResolve({filter:/^@\/components\/(experience-scope|explore-social)$/},args=>({path:args.path.split('/').at(-1),namespace:'adapter'}));
  b.onLoad({filter:/.*/,namespace:'adapter'},args=>({contents:args.path==='link'?`import React from 'react';export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}`:args.path==='image'?`import React from 'react';export default function Image({unoptimized,priority,fill,...props}){return <img {...props}/>} `:args.path==='experience-scope'?`export function useExperienceScope(){return null}`:`const states={};export function useExploreSocial(){return {states}};export function useSalonSocial(){return {}}`,loader:'jsx',resolveDir:process.cwd()}));
 }}]});
 const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text,css=result.outputFiles.find(file=>file.path.endsWith('.css')).text;
 const counts={discover:0,program:0,owner:0,setup:0,concurrentSave:0};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
   if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(js);}
   if(url.pathname==='/bundle.css'){res.setHeader('content-type','text/css');return res.end(css);}
   if(url.pathname.startsWith('/images/rewards/')){const asset=path.join('public',url.pathname);if(fs.existsSync(asset)){res.setHeader('content-type','image/webp');return res.end(fs.readFileSync(asset));}res.statusCode=404;return res.end();}
   if(url.pathname==='/api/rewards/discover'){counts.discover++;res.setHeader('content-type','application/json');return res.end(JSON.stringify(await discover(url.searchParams)));}
   if(url.pathname==='/api/rewards/program'){counts.program++;res.setHeader('content-type','application/json');return res.end(JSON.stringify(await program(url.searchParams.get('salonId'))));}
   if(url.pathname==='/api/rewards/owner-discovery'){if(!owner){res.statusCode=404;return res.end();}counts.owner++;res.setHeader('content-type','application/json');return res.end(JSON.stringify(await owner()));}
   if(url.pathname==='/fixture/owner'){
    if(!setup){res.statusCode=404;return res.end();}let raw='';for await(const chunk of req)raw+=chunk;const{op,args}=JSON.parse(raw);counts.setup++;res.setHeader('content-type','application/json');try{return res.end(JSON.stringify(await setup(op,args)));}catch(error){res.statusCode=400;return res.end(JSON.stringify({error:error.message}));}
   }
   if(url.pathname==='/fixture/concurrent-save'){
    assert.ok(setup);const loaded=await setup('load',{});counts.concurrentSave++;res.setHeader('content-type','application/json');return res.end(JSON.stringify(await setup('save',{program:{...loaded.program,welcomePoints:21},expectedVersion:loaded.version})));
   }
   if(url.pathname!=='/'&&!url.pathname.startsWith('/explore/salons/')){res.statusCode=404;return res.end();}
   res.setHeader('content-type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>*{box-sizing:border-box}body{margin:0}button,a{font-family:inherit}a{text-decoration:none}</style><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],checks=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(origin);const post=page.locator('[data-reward-discovery]');await post.waitFor();assert.equal(await post.count(),1);assert.equal(await page.locator('dialog[open]').count(),0);assert.ok(counts.discover>=1&&counts.program>=1);const id=(await post.getByRole('link').first().getAttribute('href')).split('/').at(-1);
  assert.equal(await post.getByRole('button',{name:/Service spend|Welcome points|Before & After|All rewards/}).count(),0);
  await post.getByRole('button',{name:'How rewards work',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert.ok(counts.program>=2);assert.match(await dialog.innerText(),/Chicago, IL/);assert.equal(await dialog.locator('details').getAttribute('open'),null);await dialog.getByText('Reward conditions',{exact:true}).click();assert.match(await dialog.innerText(),/remainder does not carry forward/);assert.match(await dialog.innerText(),/another guest.*fully paid/s);await page.screenshot({path:path.join(output,'real-rpc-details.png'),fullPage:true});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}checks.push('actual discover and current-program RPC callbacks render one post and fresh conditions at mobile/desktop sizes');
  await page.goto(origin+'/explore/salons/'+id);await page.getByRole('region',{name:'Salon rewards',exact:true}).waitFor();await page.screenshot({path:path.join(output,'real-rpc-salon.png'),fullPage:true});checks.push('salon continuity uses the same real anonymous public-program callback');
  if(owner){await page.goto(origin+'?mode=owner');await page.getByRole('region',{name:/Reward visibility|Grow with rewards/}).getByRole('link').first().waitFor();assert.ok(counts.owner>=1);checks.push('real owner-discovery callback renders current visibility guidance');}
  if(setup){
   await page.goto(origin+'?mode=setup-real');await page.getByRole('button',{name:'Activate local rewards',exact:true}).waitFor();await page.getByText('Ready for local discovery after you confirm.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.rewardSetupStats.saves),0);await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'real-rpc-owner-preview.png'),fullPage:true});await page.getByRole('button',{name:'Activate local rewards',exact:true}).click();await page.getByText('Saved · visible in local reward discovery.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.rewardSetupStats.saves),1);
   const concurrent=await page.request.post(origin+'/fixture/concurrent-save');assert.equal(concurrent.status(),200);await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('alert').filter({hasText:'changed in another session'}).waitFor();await page.getByRole('button',{name:'Reload latest settings (replace this draft)',exact:true}).click();await page.getByText('Customize earning rules',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="One-time welcome points"]')?.value==='21');assert.equal(counts.concurrentSave,1);checks.push('real versioned owner load/preview/activation and concurrent-save conflict with explicit reload remain covered');
  }
  assert.deepEqual(errors,[]);const accepted={passed:true,backend:'real supplied isolated PostgreSQL RPC callbacks; Next/scope/social component adapters',checks,callbackCounts:counts,runtimeErrors:errors};fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(accepted,null,2)+'\n');console.log('Real RPC Reward component acceptance passed: '+checks.length+' groups.');return accepted;
 }catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,callbackCounts:counts,runtimeErrors:errors},null,2));throw error;}
 finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
