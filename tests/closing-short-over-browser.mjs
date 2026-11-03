import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const out=path.resolve('artifacts/closing-short-over/browser');await fs.mkdir(out,{recursive:true});
const item={item_key:'closing:2026-11-01:test',kind:'closing',business_date:'2026-11-01',occurred_at:'2026-11-02T06:00:00Z',label:'Daily Report 2026-11-01 · Short $10.00',detail:'Compare the service total with the Daily Report.',target_href:'/reports?date=2026-11-01#daily-closing',ignored:false,difference:-10,collected:101,expected:111,facts:{expectedService:111,actualService:101,serviceDifference:-10}};
const data={salonId:'salon',viewerId:'owner',timezone:'America/Chicago',today:'2026-11-02',total:1,items:[item]};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{OwnerAttentionPanel}from'./app/staff/today/owner-attention-panel';const data=${JSON.stringify(data)};createRoot(document.getElementById('root')).render(<OwnerAttentionPanel salonId="salon"/>);`;
const mocks={
 'next/link':`export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
 'next/navigation':`export const useRouter=()=>({refresh(){}});`,
 '@/components/workspace-language':`export const WorkspaceText=({text})=>text;`
};
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',outfile:path.join(out,'preview.js'),jsx:'automatic',loader:{'.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
let ignored=false;const writes=[];
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/owner-attention')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());writes.push(body);ignored=true;res.end('{"ok":true}');return;}
  res.end(JSON.stringify({...data,total:ignored?0:1,items:ignored?[]:[item]}));return;
 }
 if(req.url==='/preview.js'||req.url==='/preview.css'){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(out,req.url.slice(1))));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preview.css"><style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#262322;font-family:Arial,sans-serif}#root{max-width:520px;padding:20px;margin:auto}button,a{min-height:44px}h1{font-size:22px}</style><div id="root"></div><script src="/preview.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 for(const width of [320,390,430,768]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByText('1 to review',{exact:true}).waitFor();
  assert.match(await page.locator('body').innerText(),/Short \$10\.00/);assert.equal(await page.getByRole('link',{name:'View details',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Review later',exact:true}).count(),0);
  await page.screenshot({path:path.join(out,`closing-collapsed-${width}.png`),fullPage:true});
  const toggle=page.getByRole('button',{name:/Yesterday's closing/});assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await page.getByText('Collected',{exact:true}).waitFor();assert.match(await page.locator('body').innerText(),/\$101\.00/);assert.match(await page.locator('body').innerText(),/\$111\.00/);
  assert.equal(await page.getByRole('link',{name:'Tickets',exact:true}).getAttribute('href'),'/pos-tickets?date=2026-11-01');
  assert.equal(await page.getByRole('link',{name:'Daily Report',exact:true}).getAttribute('href'),'/reports?date=2026-11-01#daily-closing');
  assert.equal(await page.getByText('Shop Money',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Confirm day reviewed'}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`closing-${width}.png`),fullPage:true});
  assert.equal(writes.length,0);
  assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage();await page.goto(base);await page.getByRole('button',{name:'Ignore',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('button')?.disabled);
 assert.equal(writes.length,1);assert.equal(writes[0].op,'ignore');await page.goto(`${base}/staff/today`);await page.getByText('0 to review',{exact:true}).waitFor();
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({widths:[320,390,430,768],overflow:false,errors:[],inlineNotification:true,expandCollapse:true,noClosingDetailLink:true,ignoreOnlyWritesMetadata:true,dateLinks:true},null,2));
 console.log('PASS: inline closing notification at four widths; two direct date links; no detail or review-later links; Ignore hides alert.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
