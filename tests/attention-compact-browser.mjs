import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const out=path.resolve('artifacts/attention-compact/browser');await fs.mkdir(out,{recursive:true});
const values={ticket_number:'T00052',status:'closed',service_total:35,discount_amount:5,tax_rate:0,tip_amount:0,recorded_payment_total:30,notes:'',lines:[{id:'line',service_name:'Nail Fill',staff_name:'Nene',service_total:35}],payments:[]};
const item={item_key:'discount:created',kind:'discount',business_date:'2026-11-01',occurred_at:'2026-11-01T19:37:00Z',label:'Ticket T00052 discount',detail:'Customer discount: — → $5.00',target_href:'/pos-tickets/t52',ignored:false,facts:{eventAction:'created',actor:'Nee',source:'POS',createdBy:'Nee',customerName:'Anna',before:{status:'open'},after:values}};
const edited={...item,item_key:'discount:edited',facts:{...item.facts,eventAction:'updated',source:'Owner',before:values,after:{...values,discount_amount:10,tip_amount:3,notes:'Customer courtesy',lines:[{...values.lines[0],staff_name:'Kim'}]}}};
const data={salonId:'salon',viewerId:'owner',today:'2026-11-01',timezone:'America/Chicago',total:3,items:[item,edited,{...item,item_key:'closing:1',kind:'closing',label:'Closing Oct 31 needs review',detail:'Review collections',facts:{}}]};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{OwnerAttentionPanel}from'./app/staff/today/owner-attention-panel';import{AttentionDetail,AttentionList}from'./app/staff/today/attention-detail';const data=${JSON.stringify(data)},q=new URLSearchParams(location.search),item=data.items.find(r=>r.item_key===q.get('item'));createRoot(document.getElementById('root')).render(<main>{item?<AttentionDetail data={data} item={item}/>:q.has('list')?<AttentionList data={data}/>:<OwnerAttentionPanel salonId="salon"/>}</main>);`;
const mocks={'next/link':`export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,'next/navigation':`export const useRouter=()=>({refresh(){}});`,'@/components/workspace-language':`export const WorkspaceText=({text})=><>{text}</>;`};
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',outfile:path.join(out,'fixture.js'),jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'local-css'},plugins:[{name:'ui-fixture',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const reviewed=new Set(),writes=[];
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/owner-attention')){res.setHeader('content-type','application/json');if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());writes.push(body);reviewed.add(body.item);res.end('{"ok":true}');return;}const items=data.items.filter(r=>!reviewed.has(r.item_key));res.end(JSON.stringify({...data,items,total:items.length}));return;}
 const name=req.url.split('?')[0].slice(1);if(['fixture.js','fixture.css'].includes(name)){res.setHeader('content-type',name.endsWith('css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(out,name)));return;}
 res.setHeader('content-type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#18181b;background:#fff}main{padding:20px 16px;max-width:760px;margin:auto}h1,h2,h3,p{margin:0}a{color:inherit}button{cursor:pointer}dl{margin:0}h1{font-size:22px;margin-bottom:12px}</style><div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),results=[];
try{
 for(const width of [320,390,430,768,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const view of ['today','list','created','edited']){
   await page.goto(origin+(view==='list'?'/?list':view==='created'?'/?item=discount:created':view==='edited'?'/?item=discount:edited':''));
   await page.getByText(view==='created'?'Discount · Ticket T52':view==='edited'?'Discount edited · Ticket T52':view==='list'?'Financial attention · 3':'3 to review',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${view} ${width}`);
   assert.equal(await page.getByRole('columnheader').count(),0);
   if(view==='created'){assert.equal(await page.getByText('Changes',{exact:true}).count(),0);assert.equal(await page.getByText('Additional details',{exact:true}).count(),0);assert.match(await page.locator('body').innerText(),/Nail Fill[\s\S]*Nene/);}
   if(view==='edited'){const text=await page.locator('body').innerText();for(const expected of ['Changes','$5.00 → $10.00','Nene → Kim','Customer courtesy','Ticket total'])assert.ok(text.includes(expected),expected);}
   if(width===390 || width===1280)await page.screenshot({path:path.join(out,`${view}-${width}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);results.push({width,views:4,overflow:false,errors});await page.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(origin+'/?item=discount:edited');await page.getByRole('button',{name:'Mark reviewed',exact:true}).click();
 await page.goto(origin);await page.getByText('2 to review',{exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].item,'discount:edited');assert.equal(writes[0].op,'ignore');
 await page.getByRole('link',{name:/Discount · Ticket T52/}).click();await page.getByRole('heading',{name:'Discount · Ticket T52',exact:true}).waitFor();
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({results,singleReviewWrite:true,reviewSurvivesReload:true,wholeRowNavigation:true},null,2));console.log('PASS: 20 browser views, 5 widths, focused changes, no overflow, whole-row navigation, one review write and reload');
}finally{await browser.close();await new Promise(r=>server.close(r));}
